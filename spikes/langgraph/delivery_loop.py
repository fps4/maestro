"""The maestro delivery loop as a LangGraph state machine, with human gates as interrupts.

    spec → [functional gate] → design → [technical/design gate] → build → [merge gate] → done

Each gate calls interrupt() to pause for a human decision; request_changes loops back to the
producing node. Nodes reason through the single ModelClient (ADR-0002) and emit domain events to a
separate append-only log (ADR-0008/0009). SPIKE — the runtime ADR is deferred.
"""
from typing import Optional, TypedDict

from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt

ACTIONS = ["approve", "request_changes", "reject"]


class DeliveryState(TypedDict, total=False):
    run_id: str
    intent: str
    product_type: str          # "technical" routes every gate to the architect (ADR-0003/0011)
    spec: Optional[str]
    design: Optional[str]
    pr_url: Optional[str]
    stage: str
    last_decision: dict
    history: list


def make_graph(checkpointer, model, events):
    def emit(state, type_, **payload):
        events.append(run_id=state["run_id"], actor="orchestrator", type=type_, payload=payload)

    def route(product_type, gate):
        # ADR-0011/0013: technical → architect on Slack; commercial functional → reviewer surface.
        if gate == "functional" and product_type == "commercial":
            return {"role": "functional_reviewer", "surface": "web-ui", "destination": "product review page"}
        return {"role": "architect", "surface": "slack", "destination": "architect channel"}

    def spec(state):
        text = model.complete("spec", f"Draft a functional spec (EARS) for: {state['intent']}")
        emit(state, "spec.drafted")
        return {"spec": text, "stage": "functional_gate"}

    def functional_gate(state):
        decision = interrupt({"gate": "functional", **route(state["product_type"], "functional"),
                              "actions": ACTIONS, "artifact": "functional spec",
                              "preview": (state.get("spec") or "")[:240]})
        emit(state, "gate.resolved", gate="functional", decision=decision)
        return {"last_decision": decision,
                "history": state.get("history", []) + [{"gate": "functional", **decision}]}

    def design(state):
        text = model.complete("architect", f"Technical design + tasks for:\n{state['spec']}")
        emit(state, "design.produced")
        return {"design": text, "stage": "technical_gate"}

    def technical_gate(state):
        decision = interrupt({"gate": "technical_design", "role": "architect", "surface": "slack",
                              "destination": "architect channel", "actions": ACTIONS,
                              "artifact": "technical design", "preview": (state.get("design") or "")[:240]})
        emit(state, "gate.resolved", gate="technical_design", decision=decision)
        return {"last_decision": decision,
                "history": state.get("history", []) + [{"gate": "technical_design", **decision}]}

    def build(state):
        model.complete("builder", f"Implement on a maestro/* branch from:\n{state['design']}")
        pr = f"https://github.com/example/repo/pull/{abs(hash(state['run_id'])) % 900 + 100}"
        emit(state, "pr.opened", pr_url=pr)   # in the real engine the DoD gates must be green here
        return {"pr_url": pr, "stage": "merge_gate"}

    def merge_gate(state):
        decision = interrupt({"gate": "technical_merge", "role": "architect", "surface": "slack",
                              "destination": "architect channel", "actions": ACTIONS,
                              "artifact": f"PR {state['pr_url']}",
                              "note": "a human merges in GitHub; maestro only observes (ADR-0004)"})
        emit(state, "gate.resolved", gate="technical_merge", decision=decision)
        return {"last_decision": decision,
                "history": state.get("history", []) + [{"gate": "technical_merge", **decision}]}

    def done(state):
        emit(state, "task.done", pr_url=state.get("pr_url"))
        return {"stage": "done"}

    def decided(state):                       # conditional-edge router: the human's choice
        return state["last_decision"]["decision"]

    g = StateGraph(DeliveryState)
    for name, fn in [("spec", spec), ("functional_gate", functional_gate), ("design", design),
                     ("technical_gate", technical_gate), ("build", build),
                     ("merge_gate", merge_gate), ("done", done)]:
        g.add_node(name, fn)

    g.add_edge(START, "spec")
    g.add_edge("spec", "functional_gate")
    g.add_conditional_edges("functional_gate", decided,
                            {"approve": "design", "request_changes": "spec", "reject": END})
    g.add_edge("design", "technical_gate")
    g.add_conditional_edges("technical_gate", decided,
                            {"approve": "build", "request_changes": "design", "reject": END})
    g.add_edge("build", "merge_gate")
    g.add_conditional_edges("merge_gate", decided,
                            {"approve": "done", "request_changes": "build", "reject": END})
    g.add_edge("done", END)
    return g.compile(checkpointer=checkpointer)
