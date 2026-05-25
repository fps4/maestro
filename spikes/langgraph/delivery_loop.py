"""The maestro delivery loop as a LangGraph state machine, with human gates as interrupts and a
bounded-role crew.

    spec → [functional gate] → design → [technical/design gate] → build → [merge gate] → done

Gates pause via interrupt() and resume via Command(resume=...); request_changes loops back. Each
stage delegates to a crew agent (ADR-0002 egress); the build stage fans out to test + reviewer
SUBAGENTS, enforcing reviewer ≠ author (ADR-0004). Domain events go to the append-only log
(authoritative; ADR-0008/0009) — the checkpointer is just execution recovery. SPIKE.
"""
from typing import Optional, TypedDict

from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt

from crew import Crew

ACTIONS = ["approve", "request_changes", "reject"]


class DeliveryState(TypedDict, total=False):
    run_id: str
    intent: str
    product_type: str
    spec: Optional[str]
    design: Optional[str]
    pr_url: Optional[str]
    stage: str
    last_decision: dict
    history: list


def make_graph(checkpointer, model, events):
    crew = Crew(model)

    def emit(state, type_, **payload):
        events.append(run_id=state["run_id"], actor="orchestrator", type=type_, payload=payload)

    def route(product_type, gate):
        if gate == "functional" and product_type == "commercial":
            return {"role": "functional_reviewer", "surface": "web-ui", "destination": "product review page"}
        return {"role": "architect", "surface": "slack", "destination": "architect channel"}

    def spec(state):
        agent = crew.agent("spec")
        agent.run(f"Draft a functional spec (EARS) for: {state['intent']}")
        emit(state, "spec.drafted", by=agent.id)
        return {"spec": f"[spec by {agent.id}] {state['intent']}", "stage": "functional_gate"}

    def functional_gate(state):
        decision = interrupt({"gate": "functional", **route(state["product_type"], "functional"),
                              "actions": ACTIONS, "artifact": "functional spec",
                              "preview": (state.get("spec") or "")[:240]})
        emit(state, "gate.resolved", gate="functional", decision=decision)
        return {"last_decision": decision,
                "history": state.get("history", []) + [{"gate": "functional", **decision}]}

    def design(state):
        agent = crew.agent("architect")
        agent.run(f"Technical design + tasks for:\n{state['spec']}")
        emit(state, "design.produced", by=agent.id)
        return {"design": f"[design by {agent.id}]", "stage": "technical_gate"}

    def technical_gate(state):
        decision = interrupt({"gate": "technical_design", "role": "architect", "surface": "slack",
                              "destination": "architect channel", "actions": ACTIONS,
                              "artifact": "technical design", "preview": (state.get("design") or "")[:240]})
        emit(state, "gate.resolved", gate="technical_design", decision=decision)
        return {"last_decision": decision,
                "history": state.get("history", []) + [{"gate": "technical_design", **decision}]}

    def build(state):
        builder = crew.agent("builder")
        builder.run(f"Implement on a maestro/* branch from:\n{state['design']}")
        pr = f"https://github.com/example/repo/pull/{abs(hash(state['run_id'])) % 900 + 100}"
        emit(state, "pr.opened", pr_url=pr, by=builder.id)

        # subagent fan-out within the build stage:
        test = crew.agent("test")
        test.run(f"Generate + run spec-derived tests for {pr}")
        emit(state, "test.passed", by=test.id)

        reviewer = crew.agent("reviewer")
        assert reviewer.id != builder.id, "reviewer must not be the author (ADR-0004)"
        reviewer.run(f"Critique the diff for {pr} against standards/")
        emit(state, "review.posted", by=reviewer.id, author=builder.id, findings="none-high")
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

    def decided(state):
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
