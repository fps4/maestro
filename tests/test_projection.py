"""Replay the event log into current task state — rehydration after a restart (US-0020, ADR-0008)."""
from adapters.github.adapter import append_merge_approval
from orchestrator.projection import project_task


def test_rehydrate_stage_from_events(events):
    events.append(run_id="t", actor="o", type="task.created", payload={})
    events.append(run_id="t", actor="spec-1", type="spec.drafted", payload={})
    events.append(run_id="t", actor="architect-1", type="design.produced", payload={})
    state = project_task(events.read(), "t")
    assert state.stage == "technical_gate"
    assert state.status == "active"


def test_pr_opened_moves_to_merge_gate_and_records_pr(events):
    events.append(run_id="t", actor="o", type="task.created", payload={})
    events.append(run_id="t", actor="builder-1", type="pr.opened",
                  payload={"repo": "acme/widget", "pr_number": 7, "pr_url": "u", "branch": "maestro/x"})
    state = project_task(events.read(), "t")
    assert state.stage == "merge_gate"
    assert state.pr == {"repo": "acme/widget", "number": 7, "url": "u"}
    assert state.branch == "maestro/x"


def test_request_changes_returns_to_producing_stage(events):
    events.append(run_id="t", actor="o", type="task.created", payload={})
    events.append(run_id="t", actor="spec-1", type="spec.drafted", payload={})
    events.append(run_id="t", actor="@arch", type="gate.resolved",
                  payload={"gate": "functional", "decision": {"decision": "request_changes", "by": "@arch"}})
    state = project_task(events.read(), "t")
    assert state.stage == "intake"        # back to the spec producer
    assert state.gates[-1].decision == "request_changes"
    assert state.gates[-1].resolved_by == "@arch"


def test_merge_executed_marks_done_and_consumes_approval(events):
    events.append(run_id="t", actor="o", type="task.created", payload={})
    events.append(run_id="t", actor="builder-1", type="pr.opened",
                  payload={"repo": "acme/widget", "pr_number": 7, "pr_url": "u"})
    appr = append_merge_approval(events, "t", "acme/widget", 7, by="@arch")
    events.append(run_id="t", actor="github-adapter", type="merge.executed",
                  payload={"repo": "acme/widget", "pr_number": 7, "approval_seq": appr["seq"]})
    state = project_task(events.read(), "t")
    assert state.stage == "done"
    assert state.status == "done"
    assert state.merged is True
    assert appr["seq"] in state.consumed_approvals


def test_reject_cancels_the_task(events):
    events.append(run_id="t", actor="o", type="task.created", payload={})
    events.append(run_id="t", actor="@arch", type="gate.resolved",
                  payload={"gate": "functional", "decision": {"decision": "reject", "by": "@arch"}})
    assert project_task(events.read(), "t").status == "cancelled"


# --- M1 gate.decided event shape + open_gates derivation -----------------------------------------

def test_open_gates_populated_by_spec_drafted_with_opaque_id_and_seq(events):
    """``spec.drafted`` opens the functional gate; the projection mints an opaque ``gate_id`` keyed
    on the opener's seq, and records the seq the workspace uses for ``If-Match``."""
    events.append(run_id="t", actor="o", type="task.dispatched",
                  payload={"task_id": "t", "product_id": "p", "repo": "r"})
    opener = events.append(run_id="t", actor="spec-1", type="spec.drafted", payload={})
    state = project_task(events.read(), "t")
    assert "functional" in state.open_gates
    g = state.open_gates["functional"]
    assert g["seq"] == opener["seq"]
    assert g["gate_id"] == f"gate-{opener['seq']:04x}"
    assert g["type"] == "functional"


def test_open_gates_closes_on_gate_decided(events):
    """The workspace-write-api ``gate.decided`` event closes the open gate. The shape is flat —
    ``payload.decision`` is a string; attribution comes from ``payload.attributed_to``."""
    events.append(run_id="t", actor="o", type="task.dispatched",
                  payload={"task_id": "t", "product_id": "p", "repo": "r"})
    events.append(run_id="t", actor="spec-1", type="spec.drafted", payload={})
    events.append(run_id="t", actor="@arch", type="gate.decided",
                  payload={"type": "functional", "decision": "approve",
                           "rationale": "EARS cover the cases",
                           "attributed_to": {"email": "arch@x", "role": "architect"}})
    state = project_task(events.read(), "t")
    assert state.open_gates == {}
    [g] = state.gates
    assert g.gate == "functional" and g.decision == "approve" and g.resolved_by == "arch@x"


def test_open_gates_re_opens_on_revise_then_redraft(events):
    """request_changes returns the stage to the producer; the gate stays closed until the next
    opener (the spec agent's re-publish) lands, which mints a *new* opaque id + seq."""
    events.append(run_id="t", actor="o", type="task.dispatched",
                  payload={"task_id": "t", "product_id": "p", "repo": "r"})
    first = events.append(run_id="t", actor="spec-1", type="spec.drafted", payload={})
    events.append(run_id="t", actor="@arch", type="gate.decided",
                  payload={"type": "functional", "decision": "request_changes",
                           "rationale": "AC-3", "attributed_to": {"email": "a", "role": "architect"}})
    interim = project_task(events.read(), "t")
    assert interim.open_gates == {}
    assert interim.stage == "intake"                 # back to the spec producer

    redraft = events.append(run_id="t", actor="spec-1", type="spec.drafted", payload={})
    final = project_task(events.read(), "t")
    assert final.stage == "functional_gate"
    g = final.open_gates["functional"]
    assert g["seq"] == redraft["seq"] and g["seq"] != first["seq"]
    assert g["gate_id"] == f"gate-{redraft['seq']:04x}"


def test_legacy_gate_resolved_still_folds(events):
    """M0 emitted ``gate.resolved`` with a nested ``decision: {decision, by}``. The projection must
    keep folding that shape so historical event logs replay correctly (ADR-0008)."""
    events.append(run_id="t", actor="o", type="task.created", payload={})
    events.append(run_id="t", actor="spec-1", type="spec.drafted", payload={})
    events.append(run_id="t", actor="@arch", type="gate.resolved",
                  payload={"gate": "functional",
                           "decision": {"decision": "approve", "by": "@arch"}})
    state = project_task(events.read(), "t")
    assert state.open_gates == {}
    [g] = state.gates
    assert g.decision == "approve" and g.resolved_by == "@arch"
