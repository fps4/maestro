"""The LangGraph stage machine for one delivery task (ADR-0014).

One graph instance per task; ``thread_id == task_id`` (the ``run-<hex>`` id). The graph runs the
full M1 + M2 topology:

    dispatch → spec_node → await_functional_gate → {approve: design_node, request_changes: spec_node, reject: END}
    design_node → await_design_gate → {approve: build_node, request_changes: design_node, reject: END}
    build_node → await_dod → {green: await_merge_gate, red: END}
    await_merge_gate → {approve: merge_exec_node, request_changes: build_node, reject: END}
    merge_exec_node → END

The ``await_*`` nodes call :func:`langgraph.types.interrupt` and pause; resumption is driven by
external signals on the authoritative event log (ADR-0008):

* ``await_functional_gate`` / ``await_design_gate`` / ``await_merge_gate`` — workspace write API's
  gate-decision endpoint emits ``gate.decided``, then signals the runtime to resume with the
  decider's choice.
* ``await_dod`` — the orchestrator's CI poller (M2 #4) reads PR check status via the GitHub adapter
  and emits ``dod.green`` / ``dod.red``, then signals the runtime to resume with the result.

The graph's state is intentionally thin — ``run_id`` plus the last decision context. The **truth**
is the event log: the spec / design / build / merge nodes call into :mod:`orchestrator.agents`
helpers (or the GitHub adapter for the merge), which read from the log and write new events
through the audited adapters. The checkpointer is an execution cache (ADR-0014); a process restart
can rebuild the projection from the log alone, then re-attach the runtime to the surviving graph
state.

What this slice (M2 #3) does NOT ship (deferred):

* The **build node body** — M2 #4 wires the builder agent (US-0011) here. The stub below makes the
  topology reviewable now.
* The **DoD poll** — M2 #4 wires the CI poller against ``await_dod``; the interrupt payload shape
  is forward-compat. M2 #4+ also wires the spec-derived test agent (US-0014) whose result is the
  first DoD signal the poller reads.
* The **merge exec body** — a later slice wires ``GitHubAdapter.merge`` (ADR-0016 boundary) here.
  M0 + M1 proved the refusal half; the execution half lives in this node.
"""
from __future__ import annotations

from typing import Any, Callable, Optional, TypedDict

# LangGraph is imported eagerly so a misconfiguration (missing dep) fails at boot, not on the first
# dispatched task. The module is not used until the runtime is constructed.
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, StateGraph
from langgraph.types import interrupt


class TaskGraphState(TypedDict, total=False):
    """The thin state we carry across nodes. The event log is the truth — this is just enough to
    route on the last gate / dod decision."""
    run_id: str
    stage: str                        # mirror of projection.TaskState.stage for observability
    last_decision: str                # approve | request_changes | reject  (gate decisions)
    last_gate_type: str               # functional | technical_design | technical_merge
    last_dod_status: str              # green | red                          (DoD result)
    last_error: str                   # set when a node raises so a future supervisor can route


# --- node callables (built per-graph because they close over the agent / adapter helpers) -------


def build_graph(
    *,
    run_spec:    Callable[[str], Any],
    run_design:  Optional[Callable[[str], Any]] = None,
    run_build:   Optional[Callable[[str], Any]] = None,
    run_merge:   Optional[Callable[[str], Any]] = None,
    checkpointer: Optional[BaseCheckpointSaver] = None,
) -> Any:
    """Compile the full M1 + M2 delivery-task graph.

    ``run_spec`` / ``run_design`` / ``run_build`` / ``run_merge`` are the side-effecting hooks the
    nodes call; injecting them keeps the graph topology testable without the agent stack (a test
    can pass no-op closures that just record they were called).

    Production wires:

    * ``run_spec``   = :func:`orchestrator.agents.spec.run_spec_for_run`
    * ``run_design`` = :func:`orchestrator.agents.design.run_design_for_run`
    * ``run_build``  = the builder-agent dispatcher (M2 #4)
    * ``run_merge``  = the GitHub-adapter merge call (ADR-0016 boundary)

    ``checkpointer`` is :class:`langgraph.checkpoint.memory.MemorySaver` in tests and
    :class:`langgraph.checkpoint.sqlite.SqliteSaver` in production (ADR-0008/0014).
    """

    # --- M1 nodes (unchanged shape) ----------------------------------------------------------------

    def spec_node(state: TaskGraphState) -> dict:
        run_spec(state["run_id"])
        return {"stage": "functional_gate"}

    def await_functional_gate(state: TaskGraphState) -> dict:
        payload = interrupt({"gate": "functional", "run_id": state["run_id"]})
        return {"last_decision": payload["decision"], "last_gate_type": "functional"}

    def design_node(state: TaskGraphState) -> dict:
        if run_design is None:
            # The M1 #7 stub kept the topology compilable before #8 filled it. Retained here so a
            # test can exercise M2's routing with no agent hooks at all.
            return {"stage": "technical_gate"}
        run_design(state["run_id"])
        return {"stage": "technical_gate"}

    def await_design_gate(state: TaskGraphState) -> dict:
        payload = interrupt({"gate": "technical_design", "run_id": state["run_id"]})
        return {"last_decision": payload["decision"], "last_gate_type": "technical_design"}

    # --- M2 nodes (this slice) ---------------------------------------------------------------------

    def build_node(state: TaskGraphState) -> dict:
        # M2 #4 plugs the builder agent (US-0011) in here. The stub keeps the topology compilable
        # so a test can exercise M2's routing without the agent stack — same discipline as the M1
        # #7 design_node stub.
        if run_build is None:
            return {"stage": "build"}
        run_build(state["run_id"])
        return {"stage": "build"}

    def await_dod(state: TaskGraphState) -> dict:
        # Resumed by the CI poller (M2 #4) with ``{"status": "green"|"red"}``. The interrupt
        # payload to the poller mirrors the gate-await shape so the poller's resume call site looks
        # like a gate resume — :meth:`LangGraphRuntime.resume_for_dod` formalises that.
        payload = interrupt({"gate": "dod", "run_id": state["run_id"]})
        return {"last_dod_status": payload["status"]}

    def await_merge_gate(state: TaskGraphState) -> dict:
        # Shape mirrors await_functional_gate / await_design_gate — the merge gate is just a third
        # ``gate.decided`` event of ``type = "technical_merge"``. M0 + M1 already routed
        # ``technical_merge`` through the workspace write API (forward-compat); now the graph
        # actually awaits it.
        payload = interrupt({"gate": "technical_merge", "run_id": state["run_id"]})
        return {"last_decision": payload["decision"], "last_gate_type": "technical_merge"}

    def merge_exec_node(state: TaskGraphState) -> dict:
        # A later slice calls ``GitHubAdapter.merge(run_id, approval_seq)`` here (ADR-0016
        # boundary — the adapter refuses without a valid, unconsumed approval event; that refusal
        # half is already live since M0). On success the adapter emits ``merge.executed`` and the
        # projection flips the task to ``done`` independently.
        if run_merge is None:
            return {"stage": "done"}
        run_merge(state["run_id"])
        return {"stage": "done"}

    # --- routing -----------------------------------------------------------------------------------

    def route_after_functional(state: TaskGraphState) -> str:
        return _route(state["last_decision"], on_approve="design_node", on_revise="spec_node")

    def route_after_design(state: TaskGraphState) -> str:
        # M2 extends M1: approve now advances to build_node (was END in M1).
        return _route(state["last_decision"], on_approve="build_node", on_revise="design_node")

    def route_after_dod(state: TaskGraphState) -> str:
        # Distinct from gate routing — DoD has only two outcomes (green / red), no "request_changes"
        # semantics. A red DoD ends the graph; the projection records the failure independently
        # from the ``dod.red`` event. M3 may add a "fix and retry" loop; for M2 the architect
        # restarts via a new delivery task.
        status = state.get("last_dod_status")
        if status == "green":
            return "await_merge_gate"
        return END  # red — and any unrecognised value (defensive, same shape as _route)

    def route_after_merge_gate(state: TaskGraphState) -> str:
        # ``request_changes`` on the merge gate loops back to the **builder** (not the designer) —
        # the architect saw the implementation and wants a different implementation. Reject ends
        # the task. Same shape as the M1 design-gate loop, one step further down the chain.
        return _route(state["last_decision"], on_approve="merge_exec_node", on_revise="build_node")

    # --- graph -------------------------------------------------------------------------------------

    builder = StateGraph(TaskGraphState)
    # M1 nodes
    builder.add_node("spec_node", spec_node)
    builder.add_node("await_functional_gate", await_functional_gate)
    builder.add_node("design_node", design_node)
    builder.add_node("await_design_gate", await_design_gate)
    # M2 nodes
    builder.add_node("build_node", build_node)
    builder.add_node("await_dod", await_dod)
    builder.add_node("await_merge_gate", await_merge_gate)
    builder.add_node("merge_exec_node", merge_exec_node)

    builder.set_entry_point("spec_node")

    # M1 edges
    builder.add_edge("spec_node", "await_functional_gate")
    builder.add_conditional_edges(
        "await_functional_gate", route_after_functional,
        {"design_node": "design_node", "spec_node": "spec_node", END: END},
    )
    builder.add_edge("design_node", "await_design_gate")
    builder.add_conditional_edges(
        "await_design_gate", route_after_design,
        # M2: design approval now routes to build_node (was END in M1).
        {"build_node": "build_node", "design_node": "design_node", END: END},
    )

    # M2 edges
    builder.add_edge("build_node", "await_dod")
    builder.add_conditional_edges(
        "await_dod", route_after_dod,
        {"await_merge_gate": "await_merge_gate", END: END},
    )
    builder.add_conditional_edges(
        "await_merge_gate", route_after_merge_gate,
        {"merge_exec_node": "merge_exec_node", "build_node": "build_node", END: END},
    )
    builder.add_edge("merge_exec_node", END)

    return builder.compile(checkpointer=checkpointer)


def _route(decision: str, *, on_approve: Any, on_revise: str) -> Any:
    """One routing rule used at every **gate** — ``approve`` advances, ``request_changes`` loops
    back to the producer, ``reject`` ends. The projection records the cancelled/blocked status
    independently (projection.py — gate.decided handling), so the graph just ends.

    Used by every ``await_*_gate`` node; the DoD wait has its own (``route_after_dod``) because it
    has only two outcomes and no "request_changes" semantics."""
    if decision == "approve":
        return on_approve
    if decision == "request_changes":
        return on_revise
    return END                                 # reject — and any unrecognised value (defensive)
