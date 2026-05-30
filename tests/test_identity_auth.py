"""Dev-stub identity belt-and-braces (US-0024 H7, ADR-0019).

Two layers are covered:
  * ``resolve_identity`` — the per-request rule: the edge header always wins; the dev stub is
    honoured only off-production AND only with an Access JWT or from loopback.
  * an HTTP smoke test — the dispatch endpoint must 401 when the stub is on but the request carries
    no Access JWT and does not come from loopback (the edge-deployment posture, simulated by
    monkeypatching the loopback check).
"""
import json
import threading
import urllib.error
import urllib.request

import pytest

from orchestrator import db, httpserver
from orchestrator.eventlog import EventLog
from orchestrator.httpserver import (
    ACCESS_JWT_HEADER,
    IDENTITY_HEADER,
    make_server,
    resolve_identity,
)
from orchestrator.idempotency import IdempotencyStore
from orchestrator.readapi import ReadAPI
from orchestrator.register import Participant, Product, Register
from orchestrator.routing import RoutingResolver
from orchestrator.writeapi import WriteAPI

ARCH = "arch@example.com"
REPO = "acme/widget"
REMOTE = "203.0.113.7"          # a non-loopback peer (TEST-NET-3)


# --- resolve_identity: the per-request rule ----------------------------------------------------

def test_edge_header_always_wins(monkeypatch):
    monkeypatch.delenv("MAESTRO_DEV_IDENTITY", raising=False)
    headers = {IDENTITY_HEADER: "  " + ARCH + "  "}
    assert resolve_identity(headers, REMOTE) == ARCH


def test_stub_honoured_from_loopback(monkeypatch):
    monkeypatch.setenv("MAESTRO_DEV_IDENTITY", ARCH)
    monkeypatch.delenv("MAESTRO_ENV", raising=False)
    assert resolve_identity({}, "127.0.0.1") == ARCH


def test_stub_honoured_with_access_jwt_from_remote(monkeypatch):
    monkeypatch.setenv("MAESTRO_DEV_IDENTITY", ARCH)
    monkeypatch.delenv("MAESTRO_ENV", raising=False)
    assert resolve_identity({ACCESS_JWT_HEADER: "ey.signed.jwt"}, REMOTE) == ARCH


def test_stub_refused_from_remote_without_jwt(monkeypatch):
    """The H7 gap: a bare URL-knower over the tunnel with no Access assertion gets no identity."""
    monkeypatch.setenv("MAESTRO_DEV_IDENTITY", ARCH)
    monkeypatch.delenv("MAESTRO_ENV", raising=False)
    assert resolve_identity({}, REMOTE) is None


def test_stub_refused_in_production_even_from_loopback(monkeypatch):
    monkeypatch.setenv("MAESTRO_DEV_IDENTITY", ARCH)
    monkeypatch.setenv("MAESTRO_ENV", "production")
    assert resolve_identity({}, "127.0.0.1") is None


def test_no_stub_no_identity(monkeypatch):
    monkeypatch.delenv("MAESTRO_DEV_IDENTITY", raising=False)
    monkeypatch.delenv("MAESTRO_ENV", raising=False)
    assert resolve_identity({}, "127.0.0.1") is None


# --- HTTP smoke test: edge posture + stub on + no JWT → 401 -------------------------------------

@pytest.fixture
def base_url(content_reader):
    register = Register(products={
        "maestro": Product(id="maestro", name="maestro", product_type="technical",
                           visibility="public", repos=(REPO,),
                           participants=(Participant(handle="@arch", role="architect", email=ARCH),)),
    })
    conn = db.connect(":memory:", check_same_thread=False)
    events = EventLog(conn)
    read = ReadAPI(register, events, content_reader)
    write = WriteAPI(register, events, RoutingResolver.load(), IdempotencyStore(conn))
    server = make_server(read, write, host="127.0.0.1", port=0)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
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
            return r.status, json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or "null")


def test_dispatch_with_stub_on_but_no_jwt_is_401(base_url, monkeypatch):
    """Simulate the edge posture: force the loopback check off so the in-process request looks like
    it arrived over the tunnel. Stub on, no Access JWT → 401 (the H7 smoke test)."""
    monkeypatch.setenv("MAESTRO_DEV_IDENTITY", ARCH)
    monkeypatch.delenv("MAESTRO_ENV", raising=False)
    monkeypatch.setattr(httpserver, "_is_loopback", lambda host: False)
    status, body = _post(f"{base_url}/api/products/maestro/tasks", {"intent": "x"})
    assert status == 401 and body["error"]["code"] == "unauthenticated"


def test_dispatch_with_stub_on_and_access_jwt_succeeds(base_url, monkeypatch):
    """Same edge posture, but now with an Access JWT present → the stub is honoured, task created."""
    monkeypatch.setenv("MAESTRO_DEV_IDENTITY", ARCH)
    monkeypatch.delenv("MAESTRO_ENV", raising=False)
    monkeypatch.setattr(httpserver, "_is_loopback", lambda host: False)
    status, body = _post(f"{base_url}/api/products/maestro/tasks", {"intent": "x"},
                         {ACCESS_JWT_HEADER: "ey.signed.jwt"})
    assert status == 201 and body["task_id"].startswith("run-")
