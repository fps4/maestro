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
    assert state.pr == {"repo": "acme/widget", "number": 7, "url": "u", "draft": False}
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


# --- M1 agent_response.posted (ADR-0022 — re-opens the gate after a refinement cycle) -----------

def test_agent_response_posted_re_opens_the_matching_gate(events):
    """A spec agent's ``agent_response.posted`` re-opens the **functional** gate with the
    response's seq — the workspace can round-trip that seq as ``If-Match`` on the next decision."""
    events.append(run_id="t", actor="o", type="task.dispatched",
                  payload={"task_id": "t", "product_id": "p", "repo": "r"})
    events.append(run_id="t", actor="spec-1", type="spec.drafted",
                  payload={"feature": "x"})
    events.append(run_id="t", actor="@arch", type="gate.decided",
                  payload={"type": "functional", "decision": "request_changes",
                           "rationale": "fix", "feedback_bundle_id": "fb-1",
                           "attributed_to": {"email": "a", "role": "architect"}})
    resp = events.append(run_id="t", actor="spec-agent", type="agent_response.posted",
                          payload={"task_id": "t", "agent": "spec", "kind": "functional_spec",
                                   "feature": "x", "bundle_id": "fb-1",
                                   "summary_of_changes": "redrafted",
                                   "addresses": [{"comment_id": "cmt-1", "action": "addressed",
                                                  "note": "ok", "ref_section": None}],
                                   "ref": {"repo": "r", "branch": "b",
                                           "path": "p", "commit": "redraft-sha"}})
    state = project_task(events.read(), "t")
    assert state.stage == "functional_gate"
    assert "functional" in state.open_gates
    assert state.open_gates["functional"]["seq"] == resp["seq"]
    [recorded] = state.agent_responses
    assert recorded.bundle_id == "fb-1"
    assert recorded.summary_of_changes == "redrafted"


def test_artefacts_chain_records_producer_then_response(events):
    """``TaskState.artefacts`` chains every artefact commit in event order — producer events
    (spec.drafted / design.produced) and refinement responses (agent_response.posted) — so the
    workspace's diff-of-artefact view can walk adjacent (kind, path) pairs without re-scanning
    the log (US-0032 §refinement-loop)."""
    events.append(run_id="t", actor="o", type="task.dispatched",
                  payload={"task_id": "t", "product_id": "p", "repo": "r"})
    events.append(run_id="t", actor="spec-1", type="spec.drafted",
                  payload={"agent": "spec", "kind": "functional_spec", "feature": "x",
                           "ref": {"repo": "r", "branch": "b",
                                   "path": "docs/x.md", "commit": "c0"}})
    events.append(run_id="t", actor="@arch", type="gate.decided",
                  payload={"type": "functional", "decision": "request_changes",
                           "rationale": "fix", "feedback_bundle_id": "fb-1",
                           "attributed_to": {"email": "a", "role": "architect"}})
    events.append(run_id="t", actor="spec-1", type="agent_response.posted",
                  payload={"task_id": "t", "agent": "spec", "kind": "functional_spec",
                           "feature": "x", "bundle_id": "fb-1",
                           "summary_of_changes": "redrafted",
                           "addresses": [{"comment_id": "cmt-1", "action": "addressed",
                                          "note": "ok", "ref_section": None}],
                           "ref": {"repo": "r", "branch": "b",
                                   "path": "docs/x.md", "commit": "c1"}})

    state = project_task(events.read(), "t")
    assert len(state.artefacts) == 2
    first, second = state.artefacts
    assert first.via == "producer" and first.ref["commit"] == "c0"
    assert second.via == "response" and second.ref["commit"] == "c1"
    # Adjacent (kind, path) pairs ⇒ the workspace renders a diff between c0 and c1.
    assert first.kind == second.kind == "functional_spec"
    assert first.ref["path"] == second.ref["path"]


def test_agent_response_from_design_re_opens_technical_design_gate(events):
    """Symmetric for the design agent — ``agent: design`` re-opens the ``technical_design`` gate."""
    events.append(run_id="t", actor="o", type="task.dispatched",
                  payload={"task_id": "t", "product_id": "p", "repo": "r"})
    events.append(run_id="t", actor="spec-1", type="spec.drafted", payload={"feature": "x"})
    events.append(run_id="t", actor="design-1", type="design.produced",
                  payload={"feature": "x"})
    events.append(run_id="t", actor="@arch", type="gate.decided",
                  payload={"type": "technical_design", "decision": "request_changes",
                           "rationale": "x", "feedback_bundle_id": "fb-d-1",
                           "attributed_to": {"email": "a", "role": "architect"}})
    resp = events.append(run_id="t", actor="design-agent", type="agent_response.posted",
                          payload={"task_id": "t", "agent": "design",
                                   "kind": "technical_design", "feature": "x",
                                   "bundle_id": "fb-d-1",
                                   "summary_of_changes": "redrafted design",
                                   "addresses": [{"comment_id": "cmt-d-1",
                                                  "action": "addressed",
                                                  "note": "ok", "ref_section": None}],
                                   "ref": {"repo": "r", "branch": "b",
                                           "path": "p", "commit": "rd"}})
    state = project_task(events.read(), "t")
    assert state.stage == "technical_gate"
    assert "technical_design" in state.open_gates
    assert state.open_gates["technical_design"]["seq"] == resp["seq"]


def test_artifact_stored_appends_to_stored_artefacts_index(events):
    """US-0033: artifact.stored events project into the per-task artefacts index (the browser's
    source), distinct from the spec/design diff-chaining `artefacts` list."""
    events.append(run_id="t", actor="o", type="task.created", payload={})
    events.append(run_id="t", actor="builder-1", type="artifact.stored",
                  payload={"task_id": "t", "product_id": "maestro", "kind": "pr_diff",
                           "key": "tasks/t/pr-diff.patch", "storage_uri": "minio://b/maestro/tasks/t/pr-diff.patch",
                           "sha256": "a" * 64, "content_type": "text/x-diff", "size": 1234,
                           "source": {"event": "pr.opened", "seq": 5}})
    state = project_task(events.read(), "t")
    assert len(state.stored_artefacts) == 1
    a = state.stored_artefacts[0]
    assert a.kind == "pr_diff"
    assert a.key == "tasks/t/pr-diff.patch"
    assert a.name == "pr-diff.patch"            # defaulted to the key's basename
    assert a.product_id == "maestro"
    assert a.size == 1234 and a.sha256 == "a" * 64
    assert a.source == {"event": "pr.opened", "seq": 5}


def test_stored_artefacts_are_chronological_and_named(events):
    events.append(run_id="t", actor="o", type="task.created", payload={})
    events.append(run_id="t", actor="t-agent", type="artifact.stored",
                  payload={"task_id": "t", "product_id": "maestro", "kind": "test_report",
                           "key": "tasks/t/report.json", "name": "JUnit report",
                           "storage_uri": "minio://b/x", "sha256": "b" * 64,
                           "content_type": "application/json", "size": 10})
    events.append(run_id="t", actor="sbom", type="artifact.stored",
                  payload={"task_id": "t", "product_id": "maestro", "kind": "sbom",
                           "key": "tasks/t/sbom.spdx.json", "storage_uri": "minio://b/y",
                           "sha256": "c" * 64, "content_type": "application/json", "size": 20})
    state = project_task(events.read(), "t")
    assert [a.kind for a in state.stored_artefacts] == ["test_report", "sbom"]
    assert state.stored_artefacts[0].name == "JUnit report"      # explicit name preserved
    assert state.stored_artefacts[1].name == "sbom.spdx.json"    # defaulted from key
