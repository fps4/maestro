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

SPEC = ("---\ntitle: Invoice export\nmaestro:\n  feature: invoice-export\n  kind: functional_spec\n"
        "  task: US-0042\n---\n# Invoice export\nthe body")


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
