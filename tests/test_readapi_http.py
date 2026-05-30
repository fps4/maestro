"""The stdlib HTTP binding for the read API — routing, the identity handshake (ADR-0019), error model.

Runs a real :class:`ThreadingHTTPServer` on an ephemeral port and drives it over the wire, so the
binding (headers, status codes, ETag) is exercised end to end with no mocks — only the content reader
is a fake.
"""
import json
import threading
import urllib.error
import urllib.request

import pytest

from orchestrator import db
from orchestrator.eventlog import EventLog
from orchestrator.httpserver import make_server
from orchestrator.readapi import ReadAPI
from orchestrator.register import Participant, Product, Register

ARCH = "arch@example.com"
REPO = "acme/widget"

SPEC = ("---\ntitle: Invoice export\nlast_updated: 2026-05-27\nmaestro:\n  feature: invoice-export\n"
        "  kind: functional_spec\n  task: US-0042\n---\n# Invoice export\nthe body")


@pytest.fixture
def base_url(content_reader):
    content_reader.put(REPO, "main", "docs/spec.md", SPEC)
    register = Register(products={
        "maestro": Product(id="maestro", name="maestro", product_type="technical", visibility="public",
                           repos=(REPO,),
                           participants=(Participant(handle="@arch", role="architect", email=ARCH),)),
    })
    # The read API serves from request threads — give it a cross-thread-tolerant connection (as the
    # CLI `serve` does), mirroring production rather than the single-threaded test default.
    events = EventLog(db.connect(":memory:", check_same_thread=False))
    server = make_server(ReadAPI(register, events, content_reader), host="127.0.0.1", port=0)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def _get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read() or "null"), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or "null"), dict(e.headers)


def _as_arch(monkeypatch):
    # no edge → use the dev stub identity (ADR-0019), and make sure we're not in "production"
    monkeypatch.setenv("MAESTRO_DEV_IDENTITY", ARCH)
    monkeypatch.delenv("MAESTRO_ENV", raising=False)


def test_no_identity_is_401(base_url, monkeypatch):
    monkeypatch.delenv("MAESTRO_DEV_IDENTITY", raising=False)
    monkeypatch.delenv("MAESTRO_ENV", raising=False)
    status, body, _ = _get(f"{base_url}/api/products")
    assert status == 401 and body["error"]["code"] == "unauthenticated"


def test_identity_via_edge_header(base_url, monkeypatch):
    monkeypatch.delenv("MAESTRO_DEV_IDENTITY", raising=False)
    status, body, _ = _get(f"{base_url}/api/products", {"X-Maestro-Identity": ARCH})
    assert status == 200 and [p["id"] for p in body] == ["maestro"]


def test_dev_stub_identity(base_url, monkeypatch):
    _as_arch(monkeypatch)
    status, body, _ = _get(f"{base_url}/api/products")
    assert status == 200 and body[0]["role"] == "architect"


def test_specs_index_over_http(base_url, monkeypatch):
    _as_arch(monkeypatch)
    status, body, _ = _get(f"{base_url}/api/products/maestro/specs")
    assert status == 200
    [spec] = body["specs"]
    assert spec["feature"] == "invoice-export" and spec["availability"] == "indexed"


def test_get_spec_and_etag_304(base_url, monkeypatch):
    _as_arch(monkeypatch)
    url = f"{base_url}/api/products/maestro/specs/invoice-export/functional_spec?branch=main"
    status, body, headers = _get(url)
    assert status == 200 and "the body" in body["content"]
    # frontmatter dates (YAML → datetime.date) must serialize as ISO strings, not 500 the response
    assert body["frontmatter"]["last_updated"] == "2026-05-27"
    etag = headers["ETag"]
    # a conditional re-request with the same commit-keyed ETag → 304, no body
    status2, _, _ = _get(url, {"If-None-Match": etag})
    assert status2 == 304


def test_unknown_route_is_404(base_url, monkeypatch):
    _as_arch(monkeypatch)
    status, body, _ = _get(f"{base_url}/api/nonsense")
    assert status == 404 and body["error"]["code"] == "not_found"


def test_unknown_product_is_404(base_url, monkeypatch):
    _as_arch(monkeypatch)
    status, body, _ = _get(f"{base_url}/api/products/ghost/specs")
    assert status == 404 and body["error"]["code"] == "not_found"


def test_get_task_over_http_200(content_reader, monkeypatch):
    _as_arch(monkeypatch)
    content_reader.put(REPO, "main", "docs/spec.md", SPEC)
    register = Register(products={
        "maestro": Product(id="maestro", name="maestro", product_type="technical", visibility="public",
                           repos=(REPO,),
                           participants=(Participant(handle="@arch", role="architect", email=ARCH),)),
    })
    events = EventLog(db.connect(":memory:", check_same_thread=False))
    # Dispatch a task directly to the log (the write API is exercised separately).
    events.append(run_id="run-http", actor="@arch", type="task.dispatched", target="task:run-http",
                  payload={"task_id": "run-http", "product_id": "maestro", "repo": REPO,
                           "intent": "do the thing"})
    server = make_server(ReadAPI(register, events, content_reader), host="127.0.0.1", port=0)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        url = f"http://127.0.0.1:{server.server_address[1]}/api/products/maestro/tasks/run-http"
        status, body, _ = _get(url)
        assert status == 200
        assert body["task_id"] == "run-http" and body["product_id"] == "maestro"
        assert body["stage"] == "intake" and body["status"] == "active"
        assert body["branch"] is None and body["pr"] is None and body["merged"] is False
        assert body["gates"] == [] and body["comments"] == []
    finally:
        server.shutdown()
        server.server_close()


def test_get_task_includes_comments_over_http(content_reader, monkeypatch):
    """End-to-end: a posted comment surfaces in the per-task response, so the discuss/decide UI
    can render gate + thread in one round-trip."""
    _as_arch(monkeypatch)
    register = Register(products={
        "maestro": Product(id="maestro", name="maestro", product_type="technical", visibility="public",
                           repos=(REPO,),
                           participants=(Participant(handle="@arch", role="architect", email=ARCH),)),
    })
    events = EventLog(db.connect(":memory:", check_same_thread=False))
    events.append(run_id="run-c", actor="@arch", type="task.dispatched", target="task:run-c",
                  payload={"task_id": "run-c", "product_id": "maestro", "repo": REPO,
                           "intent": "do the thing"})
    events.append(run_id="run-c", actor="@arch", type="comment.posted", target="comment:cmt-1",
                  payload={"comment_id": "cmt-1", "task_id": "run-c", "product_id": "maestro",
                           "body": "First note", "anchor": None, "in_reply_to": None,
                           "attributed_to": {"email": ARCH, "role": "architect"}})
    server = make_server(ReadAPI(register, events, content_reader), host="127.0.0.1", port=0)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        url = f"http://127.0.0.1:{server.server_address[1]}/api/products/maestro/tasks/run-c"
        status, body, _ = _get(url)
        assert status == 200
        [c] = body["comments"]
        assert c["comment_id"] == "cmt-1" and c["body"] == "First note"
        assert c["author"] == ARCH and c["anchor"] is None
    finally:
        server.shutdown()
        server.server_close()


# --- US-0033: the artefact endpoint over the wire (302 → presigned URL) --------------------------

from storage import InMemoryArtifactStore  # noqa: E402


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Don't follow the 302 — the presigned Location is a memory:// (or off-host) URL we only assert."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _get_no_redirect(url, headers=None):
    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with opener.open(req, timeout=5) as r:
            return r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers)


@pytest.fixture
def store_base_url(content_reader):
    register = Register(products={
        "maestro": Product(id="maestro", name="maestro", product_type="technical", visibility="public",
                           repos=(REPO,),
                           participants=(Participant(handle="@arch", role="architect", email=ARCH),)),
    })
    events = EventLog(db.connect(":memory:", check_same_thread=False))
    store = InMemoryArtifactStore()
    store.put("maestro", "tasks/t/pr-diff.patch", b"--- a\n+++ b\n", "text/x-diff")
    server = make_server(ReadAPI(register, events, content_reader, store=store),
                         host="127.0.0.1", port=0)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def test_artifact_endpoint_302s_to_presigned_url(store_base_url, monkeypatch):
    _as_arch(monkeypatch)
    status, headers = _get_no_redirect(
        f"{store_base_url}/api/products/maestro/artifacts/tasks/t/pr-diff.patch")
    assert status == 302
    assert headers["Location"].startswith("memory://maestro/tasks/t/pr-diff.patch?expires=")
    # The short-lived redirect must never be cached and re-served stale (AC #7).
    assert headers.get("Cache-Control") == "no-store"


def test_artifact_endpoint_absent_key_is_404(store_base_url, monkeypatch):
    _as_arch(monkeypatch)
    status, _ = _get_no_redirect(
        f"{store_base_url}/api/products/maestro/artifacts/tasks/t/missing.patch")
    assert status == 404


def test_artifact_endpoint_requires_identity(store_base_url, monkeypatch):
    monkeypatch.delenv("MAESTRO_DEV_IDENTITY", raising=False)
    monkeypatch.delenv("MAESTRO_ENV", raising=False)
    status, _ = _get_no_redirect(
        f"{store_base_url}/api/products/maestro/artifacts/tasks/t/pr-diff.patch")
    assert status == 401
