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
