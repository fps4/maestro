"""The LangGraph stage machine for one delivery task (ADR-0014).

One graph instance per task; ``thread_id == task_id`` (the ``run-<hex>`` id). The graph runs:

    dispatch → spec_node → await_functional_gate → {approve: design_node, request_changes: spec_node, reject: END}
    design_node → await_design_gate → {approve: END (M1 ends; M2 wires build/merge),
                                       request_changes: design_node, reject: END}

The ``await_*`` nodes call :func:`langgraph.types.interrupt` and pause; resumption is driven by the
workspace write API's gate-decision endpoint (M1 #4), which writes the ``gate.decided`` event into
the authoritative log (ADR-0008) and then signals the runtime to resume the suspended graph with
the architect's choice.

The graph's state is intentionally thin — ``run_id`` plus the last decision context. The **truth**
is the event log: the spec/design nodes call into :mod:`orchestrator.agents` helpers, which read
from the log and write new events through the audited GitHub adapter and ModelClient. The
checkpointer is an execution cache (ADR-0014); a process restart can rebuild the projection from
the log alone, then re-attach the runtime to the surviving graph state.

What this slice does NOT ship (deferred):

* The **design node body** — #8 (the design agent + its dispatcher-style helper) plugs in here.
  The stub below makes the topology reviewable now and lets ``request_changes → design_node``
  loop without crashing.
* The **refinement loop**'s feedback-bundle read — #9 wires it inside the spec/design nodes once
  the agent harness can emit ``agent_response.posted``.
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
    route on the last gate decision."""
    run_id: str
    stage: str                        # mirror of projection.TaskState.stage for observability
    last_decision: str                # approve | request_changes | reject
    last_gate_type: str               # functional | technical_design | technical_merge
    last_error: str                   # set when a node raises so a future supervisor can route


# --- node callables (built per-graph because they close over the spec/design helpers) -----------


def build_graph(
    *,
    run_spec: Callable[[str], Any],
    run_design: Optional[Callable[[str], Any]] = None,
    checkpointer: Optional[BaseCheckpointSaver] = None,
) -> Any:
    """Compile the M1 delivery-task graph.

    ``run_spec`` and ``run_design`` are the side-effecting hooks the nodes call; injecting them
    keeps the graph topology testable without the agent stack (a test can pass two no-op closures
    that just record they were called). In production they are
    :func:`orchestrator.agents.spec.run_spec_for_run` and (when #8 lands)
    ``run_design_for_run``, both pre-bound to the runtime's ``events``, ``register``, ``model``,
    ``github`` references.

    ``checkpointer`` is :class:`langgraph.checkpoint.memory.MemorySaver` in tests and
    :class:`langgraph.checkpoint.sqlite.SqliteSaver` in production (ADR-0008/0014).
    """

    def spec_node(state: TaskGraphState) -> dict:
        run_spec(state["run_id"])
        return {"stage": "functional_gate"}

    def await_functional_gate(state: TaskGraphState) -> dict:
        # The payload here is what the workspace write API hands to ``runtime.resume_for_decision``;
        # it carries the architect's decision exactly as recorded in the ``gate.decided`` event.
        payload = interrupt({"gate": "functional", "run_id": state["run_id"]})
        return {"last_decision": payload["decision"], "last_gate_type": "functional"}

    def design_node(state: TaskGraphState) -> dict:
        if run_design is None:
            # #8 fills this. The stub lets the topology compile + the conditional-edges route to
            # await_design_gate so ``request_changes`` on the functional gate doesn't dead-end.
            return {"stage": "technical_gate"}
        run_design(state["run_id"])
        return {"stage": "technical_gate"}

    def await_design_gate(state: TaskGraphState) -> dict:
        payload = interrupt({"gate": "technical_design", "run_id": state["run_id"]})
        return {"last_decision": payload["decision"], "last_gate_type": "technical_design"}

    def route_after_functional(state: TaskGraphState) -> str:
        return _route(state["last_decision"], on_approve="design_node", on_revise="spec_node")

    def route_after_design(state: TaskGraphState) -> str:
        # M1 ends after design approval; M2 wires build + merge_gate.
        return _route(state["last_decision"], on_approve=END, on_revise="design_node")

    builder = StateGraph(TaskGraphState)
    builder.add_node("spec_node", spec_node)
    builder.add_node("await_functional_gate", await_functional_gate)
    builder.add_node("design_node", design_node)
    builder.add_node("await_design_gate", await_design_gate)

    builder.set_entry_point("spec_node")
    builder.add_edge("spec_node", "await_functional_gate")
    builder.add_conditional_edges(
        "await_functional_gate", route_after_functional,
        {"design_node": "design_node", "spec_node": "spec_node", END: END},
    )
    builder.add_edge("design_node", "await_design_gate")
    builder.add_conditional_edges(
        "await_design_gate", route_after_design,
        {"design_node": "design_node", END: END},
    )

    return builder.compile(checkpointer=checkpointer)


def _route(decision: str, *, on_approve: Any, on_revise: str) -> Any:
    """One routing rule used at both gates — ``approve`` advances, ``request_changes`` loops back
    to the producer, ``reject`` ends. The projection records the cancelled/blocked status
    independently (projection.py — gate.decided handling), so the graph just ends."""
    if decision == "approve":
        return on_approve
    if decision == "request_changes":
        return on_revise
    return END                                 # reject — and any unrecognised value (defensive)
