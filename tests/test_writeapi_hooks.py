"""The WriteAPI's engine-stream hooks (dispatcher + resumer) — when each fires, when it doesn't.

These tests **do not import LangGraph**: the hooks are plain Callables, and the WriteAPI calls
them after each write authoritatively lands in the log. The integration test that ties the hooks
to a real :class:`LangGraphRuntime` lives in ``tests/test_runtime.py`` (and a future end-to-end
test once #8 + #9 ship); here we pin the contract WriteAPI promises to the runtime.

Contract:

* dispatcher(run_id) is called exactly once after a fresh ``task.dispatched`` event lands.
* resumer(run_id, gate_type, decision) is called exactly once after a fresh ``gate.decided``
  event lands — including on ``reject`` (so the graph reaches END / the checkpointer marks the
  thread done).
* Idempotency **replays** do NOT re-fire either hook (the original call already did).
* Errors raised by a hook propagate; the event is already in the log (ADR-0008 — authoritative),
  so a hook failure is recoverable from the log by a future ops run.
"""
from concurrent.futures import ThreadPoolExecutor

import pytest

from orchestrator.eventlog import EventLog
from orchestrator.idempotency import IdempotencyStore
from orchestrator.register import Participant, Product, Register
from orchestrator.routing import RoutingResolver
from orchestrator.writeapi import WriteAPI

ARCH = "@arch"
REPO = "acme/widget"


# --- fixtures ------------------------------------------------------------------------------------

@pytest.fixture
def write_api_with_hooks(events, register, routing, idempotency):
    """A WriteAPI wired with recorder hooks. Returns ``(api, dispatch_calls, resume_calls)`` so a
    test can assert exactly how many times each fired."""
    dispatch_calls: list[str] = []
    resume_calls: list[tuple] = []
    api = WriteAPI(
        register, events, routing, idempotency,
        id_factory=lambda: f"run-{len(dispatch_calls) + 1}",
        dispatcher=dispatch_calls.append,
        resumer=lambda r, g, d: resume_calls.append((r, g, d)),
    )
    return api, dispatch_calls, resume_calls


# --- dispatcher: fires once after task.dispatched -----------------------------------------------

def test_dispatcher_fires_after_task_dispatched(write_api_with_hooks):
    api, dispatch_calls, _ = write_api_with_hooks
    out = api.dispatch_task(ARCH, "maestro", intent="Add CSV export")
    assert dispatch_calls == [out["task_id"]]


def test_dispatcher_does_not_fire_on_idempotency_replay(write_api_with_hooks):
    """The replay short-circuits to the cached response before the hook is touched. The first
    call already kicked the engine; double-kicking would dispatch a second graph thread on the
    same run_id and corrupt the checkpointer."""
    api, dispatch_calls, _ = write_api_with_hooks
    api.dispatch_task(ARCH, "maestro", intent="same", idempotency_key="k-1")
    api.dispatch_task(ARCH, "maestro", intent="same", idempotency_key="k-1")
    assert len(dispatch_calls) == 1


def test_dispatcher_does_not_fire_when_dispatch_refuses(write_api_with_hooks):
    """A rejected dispatch (empty intent, wrong role, unknown product) must not call the hook —
    no event landed, so no engine stream to start."""
    from orchestrator.readapi import NotFound
    from orchestrator.writeapi import ForbiddenRole, ValidationFailed

    api, dispatch_calls, _ = write_api_with_hooks
    with pytest.raises(ValidationFailed):
        api.dispatch_task(ARCH, "maestro", intent="")
    with pytest.raises(NotFound):
        api.dispatch_task(ARCH, "ghost-product", intent="x")
    # @dev is functional_reviewer — not allowed to dispatch in M1
    with pytest.raises(ForbiddenRole):
        api.dispatch_task("@dev", "maestro", intent="x")
    assert dispatch_calls == []


# --- resumer: fires after gate.decided, on every decision value ---------------------------------

@pytest.fixture
def dispatched_and_gated(write_api_with_hooks, events):
    """A dispatched task with a pending functional gate (seeded spec.drafted)."""
    api, dispatch_calls, resume_calls = write_api_with_hooks
    out = api.dispatch_task(ARCH, "maestro", intent="x")
    opener = events.append(run_id=out["task_id"], actor="spec-agent",
                            type="spec.drafted", target=f"task:{out['task_id']}",
                            payload={"task_id": out["task_id"]})
    # Clear the dispatcher count from setup — tests assert on resume only.
    dispatch_calls.clear()
    return api, out["task_id"], opener["seq"], dispatch_calls, resume_calls


def test_resumer_fires_on_approve(dispatched_and_gated):
    api, task_id, opener_seq, _, resume_calls = dispatched_and_gated
    api.decide_gate(ARCH, "maestro", task_id, "functional",
                    decision="approve",
                    if_match=opener_seq, idempotency_key="dk-a")
    assert resume_calls == [(task_id, "functional", "approve")]


def test_resumer_fires_on_request_changes(dispatched_and_gated):
    api, task_id, opener_seq, _, resume_calls = dispatched_and_gated
    api.decide_gate(ARCH, "maestro", task_id, "functional",
                    decision="request_changes", rationale="fix AC-3",
                    if_match=opener_seq, idempotency_key="dk-rc")
    assert resume_calls == [(task_id, "functional", "request_changes")]


def test_resumer_fires_on_reject_too(dispatched_and_gated):
    """Reject still resumes the graph — the routing rule sends the run to END so the checkpointer
    marks the thread done (and a future supervisor can answer 'is this task fully closed?').
    The projection's cancelled status comes from the event itself, independent of the resume."""
    api, task_id, opener_seq, _, resume_calls = dispatched_and_gated
    api.decide_gate(ARCH, "maestro", task_id, "functional",
                    decision="reject", rationale="out of scope",
                    if_match=opener_seq, idempotency_key="dk-r")
    assert resume_calls == [(task_id, "functional", "reject")]


def test_resumer_does_not_fire_on_idempotency_replay(dispatched_and_gated):
    api, task_id, opener_seq, _, resume_calls = dispatched_and_gated
    headers = {"if_match": opener_seq, "idempotency_key": "dk-rep"}
    api.decide_gate(ARCH, "maestro", task_id, "functional", decision="approve", **headers)
    api.decide_gate(ARCH, "maestro", task_id, "functional", decision="approve", **headers)
    assert len(resume_calls) == 1


def test_resumer_does_not_fire_when_decision_refuses(dispatched_and_gated):
    """403 / 409 / 422 paths must NOT trigger the resumer — no event landed."""
    from orchestrator.writeapi import GateStateMoved, ValidationFailed

    api, task_id, opener_seq, _, resume_calls = dispatched_and_gated
    with pytest.raises(GateStateMoved):
        api.decide_gate(ARCH, "maestro", task_id, "functional",
                        decision="approve", if_match=opener_seq - 1, idempotency_key="dk-1")
    with pytest.raises(ValidationFailed):
        api.decide_gate(ARCH, "maestro", task_id, "functional",
                        decision="invented", if_match=opener_seq, idempotency_key="dk-2")
    assert resume_calls == []


# --- WriteAPI works with no hooks attached (the contract-tests path) ----------------------------

def test_writeapi_runs_with_no_hooks(events, register, routing, idempotency):
    """The dispatcher/resumer are optional — the 153-test pre-existing suite proves this stays
    true. A re-statement here so a future refactor that makes them mandatory breaks loudly."""
    api = WriteAPI(register, events, routing, idempotency,
                   id_factory=lambda: "run-x", dispatcher=None, resumer=None)
    out = api.dispatch_task(ARCH, "maestro", intent="x")
    assert out["task_id"] == "run-x"


# --- async wrappers (the production boot path uses these) ---------------------------------------

def test_async_dispatcher_wrapping_is_drop_in(write_api_with_hooks):
    """The boot path wraps the runtime's sync methods in a thread-pool so the HTTP request can
    return without waiting for the spec agent. Here we prove the wrapping shape is compatible
    with what the WriteAPI calls — a one-arg callable that returns (we don't care what)."""
    pool = ThreadPoolExecutor(max_workers=1)
    seen: list[str] = []

    def slow_dispatch(run_id: str) -> None:
        seen.append(run_id)

    wrapped = lambda r: pool.submit(slow_dispatch, r)         # noqa: E731 — matches make_async_dispatcher

    api_raw, _, _ = write_api_with_hooks
    api = WriteAPI(
        api_raw._register, api_raw._events, api_raw._routing, api_raw._idempotency,
        id_factory=lambda: "run-async",
        dispatcher=wrapped,
    )
    api.dispatch_task(ARCH, "maestro", intent="x")
    # The pool ran the closure; the wrapped dispatcher returned a Future (which the WriteAPI
    # discarded), and the closure was actually invoked.
    pool.shutdown(wait=True)
    assert seen == ["run-async"]
