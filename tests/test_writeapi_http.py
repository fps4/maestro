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
