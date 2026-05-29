"""The orchestrator runtime — owns the LangGraph instance + the write API's dispatcher/resumer
hooks (ADR-0014).

One process, one runtime, one graph instance per delivery task (``thread_id = task_id``). The
runtime is **the only component** that imports LangGraph; everything upstream (the write API,
the projection, the read API) sees it as two opaque callables:

* :meth:`dispatch` — start a graph run after the workspace write API emits ``task.dispatched``.
* :meth:`resume_for_decision` — resume a suspended graph after the gate-decision endpoint emits
  ``gate.decided``.

That isolation is the point: the engine spine stays LangGraph-free; ADR-0008's "event log is the
truth" invariant is preserved because the spec/design nodes call into
:mod:`orchestrator.agents` helpers that read/write the log directly. The graph state is a
**rebuildable execution cache** (ADR-0014), not authoritative.

Async-vs-sync: the runtime's two entry points are **synchronous** — they invoke the graph and
return when it next interrupts or terminates. The boot path wraps them in a thread pool so the
HTTP request that triggered them doesn't block on a multi-second LLM call (see
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

    ``run_spec`` / ``run_design`` are the spec / design dispatcher helpers
    (``orchestrator.agents.spec.run_spec_for_run`` and — when M1 #8 lands — ``run_design_for_run``).
    Wiring them in here, not on the graph build, lets a test inject deterministic no-op closures.
    """

    def __init__(self, *, run_spec: Callable[[str], Any],
                 run_design: Optional[Callable[[str], Any]] = None,
                 checkpointer: Optional[BaseCheckpointSaver] = None):
        self._graph = build_graph(
            run_spec=run_spec, run_design=run_design,
            checkpointer=checkpointer or InMemorySaver(),
        )
        # One lock per thread_id; held while LangGraph reads/writes the checkpointer for that run.
        self._locks: dict[str, threading.Lock] = {}
        self._locks_lock = threading.Lock()       # protect the dict above

    # --- the two entry points the write API calls ----------------------------------------------

    def dispatch(self, run_id: str) -> None:
        """Start a graph run for a freshly dispatched task. Synchronous; returns when the graph
        interrupts (at the first ``await_*_gate`` node) or terminates."""
        with self._lock_for(run_id):
            self._graph.invoke({"run_id": run_id}, _config(run_id))

    def resume_for_decision(self, run_id: str, gate_type: str, decision: str) -> None:
        """Resume a suspended graph with the architect's gate decision. ``gate_type`` is carried
        through to the next node's state (observability — the routing logic itself reads only
        ``decision``)."""
        with self._lock_for(run_id):
            self._graph.invoke(
                Command(resume={"decision": decision, "gate_type": gate_type}),
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


# --- async wrappers for the production boot path -------------------------------------------------


def make_async_dispatcher(runtime: LangGraphRuntime,
                          executor: ThreadPoolExecutor) -> Callable[[str], Future]:
    """Wrap :meth:`LangGraphRuntime.dispatch` so the write API's HTTP request returns immediately
    after the ``task.dispatched`` event lands, while the graph runs the spec node in the
    background. The returned ``Future`` is for tests/observability; the write API discards it."""

    def _dispatch(run_id: str) -> Future:
        return executor.submit(runtime.dispatch, run_id)

    return _dispatch


def make_async_resumer(runtime: LangGraphRuntime,
                       executor: ThreadPoolExecutor) -> Callable[[str, str, str], Future]:
    """Like :func:`make_async_dispatcher` for the gate-decision path. The HTTP response returns
    after ``gate.decided`` is logged; the graph resumes in the background (which may take seconds
    if the next node runs the design agent)."""

    def _resume(run_id: str, gate_type: str, decision: str) -> Future:
        return executor.submit(runtime.resume_for_decision, run_id, gate_type, decision)

    return _resume
