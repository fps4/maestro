"""The orchestrator runtime — owns the LangGraph instance + the write API / CI-poller hooks
(ADR-0014).

One process, one runtime, one graph instance per delivery task (``thread_id = task_id``). The
runtime is **the only component** that imports LangGraph; everything upstream (the write API,
the projection, the read API, the CI poller) sees it as opaque callables:

* :meth:`dispatch` — start a graph run after the workspace write API emits ``task.dispatched``.
* :meth:`resume_for_decision` — resume a suspended graph after the gate-decision endpoint emits
  ``gate.decided`` (functional / technical_design / **technical_merge** — M2).
* :meth:`resume_for_dod` — resume a suspended graph after the CI poller emits ``dod.green`` or
  ``dod.red`` (M2 — wired by M2 #4's CI status loop).

That isolation is the point: the engine spine stays LangGraph-free; ADR-0008's "event log is the
truth" invariant is preserved because the spec/design/build nodes call into
:mod:`orchestrator.agents` helpers (and the GitHub adapter for the merge exec) that read/write the
log directly. The graph state is a **rebuildable execution cache** (ADR-0014), not authoritative.

Async-vs-sync: the runtime's entry points are **synchronous** — they invoke the graph and return
when it next interrupts or terminates. The boot path wraps them in a thread pool so the HTTP
request that triggered them doesn't block on a multi-second LLM call (see
:func:`make_async_dispatcher` / :func:`make_async_resumer`). Tests pass the sync forms directly so
they can assert against the event log immediately.
"""
from __future__ import annotations

import threading
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable, Optional

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from orchestrator.graph import build_graph


class LangGraphRuntime:
    """Holds the compiled graph + injected hooks; serialises ``dispatch`` / ``resume`` calls per
    thread-id so two concurrent decision events on the same task don't tangle the checkpointer.

    ``run_spec`` / ``run_design`` / ``run_build`` / ``run_merge`` are the spec / design / build /
    merge dispatcher helpers. Wiring them in here, not on the graph build, lets a test inject
    deterministic no-op closures. The M2 #3 slice stubs build / merge by default (``None``); M2 #4+
    fills them with the real builder agent and the ``GitHubAdapter.merge`` call (ADR-0016
    boundary).
    """

    def __init__(self, *, run_spec: Callable[[str], Any],
                 run_design: Optional[Callable[[str], Any]] = None,
                 run_build:  Optional[Callable[[str], Any]] = None,
                 run_tests:  Optional[Callable[[str], Any]] = None,
                 run_merge:  Optional[Callable[[str], Any]] = None,
                 checkpointer: Optional[BaseCheckpointSaver] = None):
        self._graph = build_graph(
            run_spec=run_spec, run_design=run_design,
            run_build=run_build, run_tests=run_tests, run_merge=run_merge,
            checkpointer=checkpointer or InMemorySaver(),
        )
        # One lock per thread_id; held while LangGraph reads/writes the checkpointer for that run.
        self._locks: dict[str, threading.Lock] = {}
        self._locks_lock = threading.Lock()       # protect the dict above

    # --- the entry points external code calls ---------------------------------------------------

    def dispatch(self, run_id: str) -> None:
        """Start a graph run for a freshly dispatched task. Synchronous; returns when the graph
        interrupts (at the first ``await_*`` node) or terminates."""
        with self._lock_for(run_id):
            self._graph.invoke({"run_id": run_id}, _config(run_id))

    def resume_for_decision(self, run_id: str, gate_type: str, decision: str) -> None:
        """Resume a suspended graph with the decider's gate decision. ``gate_type`` is carried
        through to the next node's state (observability — the routing logic itself reads only
        ``decision``). Used by the workspace write API's gate-decision endpoint for the
        ``functional``, ``technical_design``, and (M2) ``technical_merge`` gates."""
        with self._lock_for(run_id):
            self._graph.invoke(
                Command(resume={"decision": decision, "gate_type": gate_type}),
                _config(run_id),
            )

    def resume_for_dod(self, run_id: str, status: str) -> None:
        """Resume a suspended graph with the DoD result (``"green"`` or ``"red"``). Called by the
        CI poller (M2 #4) after ``dod.green`` / ``dod.red`` lands in the event log. Separate from
        :meth:`resume_for_decision` because DoD is not a *human* gate — the resumer's caller is the
        CI status loop, not the workspace."""
        with self._lock_for(run_id):
            self._graph.invoke(
                Command(resume={"status": status}),
                _config(run_id),
            )

    # --- introspection (used by tests + ops) ----------------------------------------------------

    def state(self, run_id: str) -> Any:
        """Return the LangGraph snapshot for ``run_id`` — what node is next, what's interrupted.

        Read-only; useful for asserting in tests and for an ops "where is this task?" view that
        cross-checks the projection."""
        return self._graph.get_state(_config(run_id))

    # --- internals ------------------------------------------------------------------------------

    def _lock_for(self, run_id: str) -> threading.Lock:
        with self._locks_lock:
            lock = self._locks.get(run_id)
            if lock is None:
                lock = threading.Lock()
                self._locks[run_id] = lock
            return lock


def _config(run_id: str) -> dict:
    """LangGraph's per-thread config. ``thread_id`` is what the checkpointer scopes state on."""
    return {"configurable": {"thread_id": run_id}}


# --- drain mode / kill switch (US-0024 H2) -------------------------------------------------------


class DrainSwitch:
    """An instance-wide kill switch the architect can flip to stop **new agent work** (US-0024 H2).

    Flipping it does not touch the event log or reject the architect's inputs — a dispatch/decision
    still records its event (the audited fact). It only stops the engine from *acting*: while
    drained, the async dispatcher/resumer skip kicking the LangGraph run, so no new LLM/tool work
    starts. This is the one-toggle response to a runaway task (extended thinking + tool use +
    request_changes storms can burn material cost); the refinement cap bounds one task, this bounds
    the whole instance. Thread-safe: the HTTP request threads read it, the architect's toggle writes.
    """

    def __init__(self, drained: bool = False):
        self._drained = drained
        self._lock = threading.Lock()

    @property
    def drained(self) -> bool:
        with self._lock:
            return self._drained

    def drain(self) -> None:
        """Stop new agent work instance-wide."""
        with self._lock:
            self._drained = True

    def resume(self) -> None:
        """Resume normal operation; new agent work flows again."""
        with self._lock:
            self._drained = False


# --- async wrappers for the production boot path -------------------------------------------------


def make_async_dispatcher(runtime: LangGraphRuntime,
                          executor: ThreadPoolExecutor,
                          drain: Optional[DrainSwitch] = None) -> Callable[[str], Optional[Future]]:
    """Wrap :meth:`LangGraphRuntime.dispatch` so the write API's HTTP request returns immediately
    after the ``task.dispatched`` event lands, while the graph runs the spec node in the
    background. The returned ``Future`` is for tests/observability; the write API discards it.

    When ``drain`` is engaged (US-0024 H2) the kick is skipped — the ``task.dispatched`` event is
    already authoritative, so the run can be re-attached from the log once drain is lifted — and
    ``None`` is returned in place of a ``Future``."""

    def _dispatch(run_id: str) -> Optional[Future]:
        if drain is not None and drain.drained:
            return None
        return executor.submit(runtime.dispatch, run_id)

    return _dispatch


def make_async_resumer(runtime: LangGraphRuntime,
                       executor: ThreadPoolExecutor,
                       drain: Optional[DrainSwitch] = None
                       ) -> Callable[[str, str, str], Optional[Future]]:
    """Like :func:`make_async_dispatcher` for the gate-decision path. The HTTP response returns
    after ``gate.decided`` is logged; the graph resumes in the background (which may take seconds
    if the next node runs the design agent). Skipped while ``drain`` is engaged (US-0024 H2)."""

    def _resume(run_id: str, gate_type: str, decision: str) -> Optional[Future]:
        if drain is not None and drain.drained:
            return None
        return executor.submit(runtime.resume_for_decision, run_id, gate_type, decision)

    return _resume
