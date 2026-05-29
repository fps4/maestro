"""The stdlib HTTP binding for the write API — POST routing, JSON parsing, the Idempotency-Key header,
and the shared identity / error envelope (workspace-write-api.md).

Runs a real :class:`ThreadingHTTPServer` on an ephemeral port and drives it over the wire, so the
binding (status codes, headers, JSON shape) is exercised end to end with no mocks.
"""
import json
import threading
import urllib.error
import urllib.request

import pytest

from orchestrator import db
from orchestrator.eventlog import EventLog
from orchestrator.httpserver import make_server
from orchestrator.idempotency import IdempotencyStore
from orchestrator.readapi import ReadAPI
from orchestrator.register import Participant, Product, Register
from orchestrator.routing import RoutingResolver
from orchestrator.writeapi import WriteAPI

ARCH = "arch@example.com"
REPO = "acme/widget"


@pytest.fixture
def base_url(content_reader):
    register = Register(products={
        "maestro": Product(id="maestro", name="maestro", product_type="technical", visibility="public",
                           repos=(REPO,),
                           participants=(Participant(handle="@arch", role="architect", email=ARCH),)),
    })
    routing = RoutingResolver.load()
    # Cross-thread-tolerant conn: ThreadingHTTPServer serves from request threads.
    conn = db.connect(":memory:", check_same_thread=False)
    events = EventLog(conn)
    counter = {"n": 0}
    def make_id():
        counter["n"] += 1
        return f"run-{counter['n']}"
    read = ReadAPI(register, events, content_reader)
    write = WriteAPI(register, events, routing, IdempotencyStore(conn), id_factory=make_id)
    server = make_server(read, write, host="127.0.0.1", port=0)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", events
    finally:
        server.shutdown()
        server.server_close()


def _post(url, body, headers=None):
    payload = json.dumps(body).encode("utf-8")
    h = {"Content-Type": "application/json", "Content-Length": str(len(payload))}
    h.update(headers or {})
    req = urllib.request.Request(url, data=payload, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read() or "null"), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or "null"), dict(e.headers)


def _as_arch(monkeypatch):
    monkeypatch.setenv("MAESTRO_DEV_IDENTITY", ARCH)
    monkeypatch.delenv("MAESTRO_ENV", raising=False)


# --- happy path -----------------------------------------------------------------------------------

def test_dispatch_via_http_creates_task_201(base_url, monkeypatch):
    _as_arch(monkeypatch)
    url, events = base_url
    status, body, _ = _post(f"{url}/api/products/maestro/tasks",
                            {"intent": "Add CSV export"})
    assert status == 201
    assert body["task_id"].startswith("run-")
    assert body["stage"] == "intake"
    assert body["ref"]["repo"] == REPO
    assert body["event_seq"] == 1
    assert len(events.read()) == 1
    assert events.read()[0]["type"] == "task.dispatched"


def test_dispatch_via_edge_identity_header(base_url, monkeypatch):
    """Identity from the X-Maestro-Identity edge header (production path); dev stub disabled."""
    monkeypatch.delenv("MAESTRO_DEV_IDENTITY", raising=False)
    url, _ = base_url
    status, body, _ = _post(
        f"{url}/api/products/maestro/tasks",
        {"intent": "Hi"},
        {"X-Maestro-Identity": ARCH},
    )
    assert status == 201 and body["task_id"].startswith("run-")


# --- identity, isolation, role --------------------------------------------------------------------

def test_dispatch_no_identity_is_401(base_url, monkeypatch):
    monkeypatch.delenv("MAESTRO_DEV_IDENTITY", raising=False)
    monkeypatch.delenv("MAESTRO_ENV", raising=False)
    url, _ = base_url
    status, body, _ = _post(f"{url}/api/products/maestro/tasks", {"intent": "x"})
    assert status == 401 and body["error"]["code"] == "unauthenticated"


def test_dispatch_unknown_product_is_404(base_url, monkeypatch):
    _as_arch(monkeypatch)
    url, _ = base_url
    status, body, _ = _post(f"{url}/api/products/ghost/tasks", {"intent": "x"})
    assert status == 404 and body["error"]["code"] == "not_found"


# --- validation -----------------------------------------------------------------------------------

def test_dispatch_empty_intent_is_422(base_url, monkeypatch):
    _as_arch(monkeypatch)
    url, _ = base_url
    status, body, _ = _post(f"{url}/api/products/maestro/tasks", {"intent": ""})
    assert status == 422 and body["error"]["code"] == "validation_failed"


def test_dispatch_invalid_json_is_400(base_url, monkeypatch):
    """A garbled body is caught before any APIError logic runs — the binding owns this."""
    _as_arch(monkeypatch)
    url, _ = base_url
    req = urllib.request.Request(
        f"{url}/api/products/maestro/tasks",
        data=b"{not json",
        headers={"Content-Type": "application/json", "Content-Length": "9"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5)
        assert False, "expected HTTPError"
    except urllib.error.HTTPError as e:
        assert e.code == 400
        assert json.loads(e.read())["error"]["code"] == "bad_request"


# --- idempotency ----------------------------------------------------------------------------------

def test_dispatch_idempotency_replay_returns_same_response(base_url, monkeypatch):
    """Same Idempotency-Key + same body → the cached response, byte-identical; only one event."""
    _as_arch(monkeypatch)
    url, events = base_url
    s1, b1, _ = _post(f"{url}/api/products/maestro/tasks", {"intent": "same"},
                      {"Idempotency-Key": "k-1"})
    s2, b2, _ = _post(f"{url}/api/products/maestro/tasks", {"intent": "same"},
                      {"Idempotency-Key": "k-1"})
    assert s1 == 201 and s2 == 201
    assert b1 == b2
    assert len(events.read()) == 1


def test_dispatch_idempotency_key_mismatch_is_409(base_url, monkeypatch):
    """Same key + different body → 409 idempotency_mismatch (workspace-write-api.md)."""
    _as_arch(monkeypatch)
    url, _ = base_url
    s1, _, _ = _post(f"{url}/api/products/maestro/tasks", {"intent": "first"},
                     {"Idempotency-Key": "k-2"})
    s2, body, _ = _post(f"{url}/api/products/maestro/tasks", {"intent": "second"},
                        {"Idempotency-Key": "k-2"})
    assert s1 == 201
    assert s2 == 409 and body["error"]["code"] == "idempotency_mismatch"


# --- routing fallbacks ----------------------------------------------------------------------------

def test_post_to_unknown_route_is_404(base_url, monkeypatch):
    _as_arch(monkeypatch)
    url, _ = base_url
    status, body, _ = _post(f"{url}/api/nonsense", {})
    assert status == 404 and body["error"]["code"] == "not_found"


# --- comment endpoint -----------------------------------------------------------------------------

def test_post_comment_over_http_201(base_url, monkeypatch):
    """End-to-end: dispatch a task, then POST a comment to it; assert 201 + a single ``comment.posted``
    event landed."""
    _as_arch(monkeypatch)
    url, events = base_url
    s1, dispatch, _ = _post(f"{url}/api/products/maestro/tasks", {"intent": "real work"})
    assert s1 == 201
    task_id = dispatch["task_id"]

    s2, body, _ = _post(f"{url}/api/products/maestro/tasks/{task_id}/comments",
                        {"body": "First impression"})
    assert s2 == 201
    assert body["comment_id"].startswith("cmt-")
    assert body["attributed_to"]["role"] == "architect"
    assert body["created_at"].endswith("Z")
    assert [e["type"] for e in events.read()] == ["task.dispatched", "comment.posted"]


def test_post_comment_with_anchor_over_http(base_url, monkeypatch):
    _as_arch(monkeypatch)
    url, _ = base_url
    _, dispatch, _ = _post(f"{url}/api/products/maestro/tasks", {"intent": "x"})
    task_id = dispatch["task_id"]
    s, body, _ = _post(
        f"{url}/api/products/maestro/tasks/{task_id}/comments",
        {
            "body": "AC-3 missing the empty case",
            "anchor": {
                "artefact": {"kind": "functional_spec",
                             "ref": {"repo": REPO, "branch": "maestro/us-x",
                                     "path": "docs/spec.md", "commit": "abc"}},
                "locator": {"criterion_id": "AC-3"},
            },
        },
    )
    assert s == 201 and body["comment_id"].startswith("cmt-")


def test_post_comment_idempotency_replay_over_http(base_url, monkeypatch):
    _as_arch(monkeypatch)
    url, events = base_url
    _, dispatch, _ = _post(f"{url}/api/products/maestro/tasks", {"intent": "x"})
    task_id = dispatch["task_id"]
    s1, b1, _ = _post(f"{url}/api/products/maestro/tasks/{task_id}/comments",
                      {"body": "same"}, {"Idempotency-Key": "ck-3"})
    s2, b2, _ = _post(f"{url}/api/products/maestro/tasks/{task_id}/comments",
                      {"body": "same"}, {"Idempotency-Key": "ck-3"})
    assert s1 == 201 and s2 == 201 and b1 == b2
    assert len([e for e in events.read() if e["type"] == "comment.posted"]) == 1


def test_post_comment_unknown_task_is_404(base_url, monkeypatch):
    _as_arch(monkeypatch)
    url, _ = base_url
    s, body, _ = _post(f"{url}/api/products/maestro/tasks/run-ghost/comments",
                       {"body": "echo"})
    assert s == 404 and body["error"]["code"] == "not_found"


def test_post_comment_bad_anchor_is_422(base_url, monkeypatch):
    _as_arch(monkeypatch)
    url, _ = base_url
    _, dispatch, _ = _post(f"{url}/api/products/maestro/tasks", {"intent": "x"})
    task_id = dispatch["task_id"]
    s, body, _ = _post(
        f"{url}/api/products/maestro/tasks/{task_id}/comments",
        {"body": "x",
         "anchor": {"artefact": {"kind": "bogus", "ref": {"repo": REPO}},
                    "locator": {"any": "thing"}}},
    )
    assert s == 422 and body["error"]["code"] == "anchor_unresolved"


# --- gate-decision endpoint -----------------------------------------------------------------------

def _seed_pending_functional_gate(base_url, monkeypatch):
    """Dispatch a task and append a ``spec.drafted`` event to open the functional gate.

    Returns ``(url, task_id, opener_seq, events)`` so each test can decide against a real opener seq
    and assert events at the end."""
    _as_arch(monkeypatch)
    url, events = base_url
    _, dispatch, _ = _post(f"{url}/api/products/maestro/tasks", {"intent": "do thing"})
    task_id = dispatch["task_id"]
    opener = events.append(run_id=task_id, actor="spec-agent", type="spec.drafted",
                           target=f"task:{task_id}",
                           payload={"task_id": task_id, "product_id": "maestro",
                                    "ref": {"repo": REPO, "branch": f"maestro/{task_id}",
                                            "path": "docs/spec.md", "commit": "abc"}})
    return url, task_id, opener["seq"], events


def test_decide_via_http_200_emits_gate_decided(base_url, monkeypatch):
    """End-to-end: open a gate via seed event, POST a decision, assert 200 + the recorded event."""
    url, task_id, opener_seq, events = _seed_pending_functional_gate(base_url, monkeypatch)
    s, body, _ = _post(
        f"{url}/api/products/maestro/tasks/{task_id}/gates/functional/decisions",
        {"decision": "approve", "rationale": "EARS criteria cover the gaps."},
        {"Idempotency-Key": "dk-http-1", "If-Match": str(opener_seq)},
    )
    assert s == 200
    assert body["gate"]["type"] == "functional"
    assert body["gate"]["decision"] == "approve"
    assert body["gate_id"] == f"gate-{opener_seq:04x}"
    assert body["feedback_bundle_id"] is None
    assert [e["type"] for e in events.read()][-1] == "gate.decided"


def test_decide_via_http_request_changes_emits_bundle(base_url, monkeypatch):
    url, task_id, opener_seq, events = _seed_pending_functional_gate(base_url, monkeypatch)
    s, body, _ = _post(
        f"{url}/api/products/maestro/tasks/{task_id}/gates/functional/decisions",
        {"decision": "request_changes", "rationale": "Address AC-3."},
        {"Idempotency-Key": "dk-http-rc", "If-Match": str(opener_seq)},
    )
    assert s == 200 and body["feedback_bundle_id"].startswith("fb-")
    assert "feedback_bundle.created" in [e["type"] for e in events.read()]


def test_decide_via_http_stale_if_match_is_409_gate_state_moved(base_url, monkeypatch):
    url, task_id, opener_seq, _ = _seed_pending_functional_gate(base_url, monkeypatch)
    s, body, _ = _post(
        f"{url}/api/products/maestro/tasks/{task_id}/gates/functional/decisions",
        {"decision": "approve", "rationale": "ok"},
        {"Idempotency-Key": "dk-http-stale", "If-Match": str(opener_seq - 1)},
    )
    assert s == 409 and body["error"]["code"] == "gate_state_moved"


def test_decide_via_http_missing_idempotency_is_422(base_url, monkeypatch):
    url, task_id, opener_seq, _ = _seed_pending_functional_gate(base_url, monkeypatch)
    s, body, _ = _post(
        f"{url}/api/products/maestro/tasks/{task_id}/gates/functional/decisions",
        {"decision": "approve", "rationale": "ok"},
        {"If-Match": str(opener_seq)},
    )
    assert s == 422 and body["error"]["code"] == "validation_failed"


def test_decide_via_http_missing_if_match_is_422(base_url, monkeypatch):
    url, task_id, _, _ = _seed_pending_functional_gate(base_url, monkeypatch)
    s, body, _ = _post(
        f"{url}/api/products/maestro/tasks/{task_id}/gates/functional/decisions",
        {"decision": "approve", "rationale": "ok"},
        {"Idempotency-Key": "dk-http-no-im"},
    )
    assert s == 422 and body["error"]["code"] == "validation_failed"


def test_decide_via_http_already_resolved_is_409(base_url, monkeypatch):
    url, task_id, opener_seq, _ = _seed_pending_functional_gate(base_url, monkeypatch)
    first, _, _ = _post(
        f"{url}/api/products/maestro/tasks/{task_id}/gates/functional/decisions",
        {"decision": "approve", "rationale": "ok"},
        {"Idempotency-Key": "dk-http-2a", "If-Match": str(opener_seq)},
    )
    assert first == 200
    s, body, _ = _post(
        f"{url}/api/products/maestro/tasks/{task_id}/gates/functional/decisions",
        {"decision": "approve", "rationale": "ok-again"},
        {"Idempotency-Key": "dk-http-2b", "If-Match": str(opener_seq)},
    )
    assert s == 409 and body["error"]["code"] == "gate_already_resolved"


def test_decide_via_http_idempotency_replay_byte_identical(base_url, monkeypatch):
    """Same Idempotency-Key + same body → byte-identical 200; only one ``gate.decided`` event."""
    url, task_id, opener_seq, events = _seed_pending_functional_gate(base_url, monkeypatch)
    headers = {"Idempotency-Key": "dk-http-rep", "If-Match": str(opener_seq)}
    s1, b1, _ = _post(
        f"{url}/api/products/maestro/tasks/{task_id}/gates/functional/decisions",
        {"decision": "approve", "rationale": "ok"}, headers,
    )
    s2, b2, _ = _post(
        f"{url}/api/products/maestro/tasks/{task_id}/gates/functional/decisions",
        {"decision": "approve", "rationale": "ok"}, headers,
    )
    assert s1 == 200 and s2 == 200 and b1 == b2
    assert len([e for e in events.read() if e["type"] == "gate.decided"]) == 1
