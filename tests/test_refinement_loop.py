"""The M1 refinement loop — request_changes → bundle → agent re-draft → agent_response.posted →
gate re-opens. End-to-end coverage of ADR-0020 (input) + ADR-0022 (output) implementations.

These tests drive the full round trip through the workspace write API + the spec agent + the
harness, so they pin behaviour at the seam where multiple components must agree on the bundle/
response shape. The integration is exercised with **no LLM** (FakeProvider returns the agent's
re-draft text verbatim) and **no GitHub** (FakeGitHubClient mirrors the create/update sha rule).
"""
import json

import pytest

from adapters.github.adapter import GitHubAdapter
from orchestrator.agents.base import (
    MAX_NOTE_CHARS,
    ArtefactRejected,
)
from orchestrator.agents.spec import run_spec_for_run
from orchestrator.projection import project_task

ARCH = "@arch"
REPO = "acme/widget"


# --- fixtures ------------------------------------------------------------------------------------

def _spec_artefact(feature="csv-export"):
    """A well-formed first-draft spec the FakeProvider returns."""
    return f"""---
title: "CSV export"
status: draft
last_updated: 2026-05-29
owners: [architect]
maestro:
  feature: {feature}
  kind: functional_spec
  task: US-0042
  summary: |
    A CSV export endpoint that lets finance pull the last quarter's
    invoices in one paged file, up to 50000 rows per request.
---

# CSV export

## Acceptance criteria
- AC-1. The system shall export to CSV.
- AC-3. The system shall handle the empty-result case.
"""


def _redraft_artefact_with_response(bundle_id, comment_ids, *, summary, feature="csv-export"):
    """A well-formed re-draft: artefact + trailing maestro-response fenced block."""
    response = {
        "bundle_id": bundle_id,
        "summary_of_changes": summary,
        "addresses": [
            {"comment_id": cid, "action": "addressed",
             "note": f"Tightened criterion for {cid}.",
             "ref_section": {"locator": {"criterion_id": "AC-3"}}}
            for cid in comment_ids
        ],
    }
    return _spec_artefact(feature) + "\n```json maestro-response\n" + json.dumps(response, indent=2) + "\n```\n"


@pytest.fixture
def gh_adapter(events, register, routing, github_client):
    return GitHubAdapter(events, register, routing, github_client)


# --- happy path: dispatch → spec → gate request_changes → bundle → re-draft → gate re-opens ----

def test_request_changes_cycle_end_to_end(write_api, events, register, model_factory, audit,
                                          gh_adapter, github_client):
    """The full cycle: dispatch → spec drafts → architect comments on AC-3 → request_changes →
    bundle composes → spec re-runs with feedback_bundle in inputs → emits agent_response.posted
    → projection re-opens the functional gate at the response's seq."""
    from tests.conftest import _Resp

    # 1. Dispatch + first spec draft.
    out = write_api.dispatch_task(ARCH, "maestro", intent="Add CSV export")
    task_id = out["task_id"]

    model, provider = model_factory(audit, resp=_Resp(text=_spec_artefact()))
    run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    state = project_task(events.read(), task_id)
    assert state.stage == "functional_gate"
    opener_seq = state.open_gates["functional"]["seq"]

    # 2. Architect comments on AC-3 (anchored to the functional spec the agent just committed).
    branch = state.open_gates["functional"]["gate_id"]            # not the branch — see next line
    branch = "maestro/task-" + task_id.removeprefix("run-")
    comment = write_api.post_comment(
        ARCH, "maestro", task_id, body="AC-3 needs the empty-zero-rows case fully spelled out",
        anchor={"artefact": {"kind": "functional_spec",
                              "ref": {"repo": REPO, "branch": branch,
                                      "path": "docs/product/specs/csv-export.md",
                                      "commit": "abc"}},
                "locator": {"criterion_id": "AC-3"}})
    comment_id = comment["comment_id"]

    # 3. Architect requests changes — the write API composes a feedback_bundle.created event.
    decision = write_api.decide_gate(
        ARCH, "maestro", task_id, "functional",
        decision="request_changes",
        rationale="Address AC-3 and re-publish.",
        if_match=opener_seq, idempotency_key="dk-rc")
    bundle_id = decision["feedback_bundle_id"]
    assert bundle_id is not None

    state = project_task(events.read(), task_id)
    assert "functional" not in state.open_gates           # gate closed by request_changes
    assert state.stage == "intake"                         # returned to producer

    # 4. Spec agent re-runs (LangGraph would route here on request_changes; here we call directly).
    #    Provider returns the re-draft text including the trailing maestro-response block.
    provider._resp.content[0].text = _redraft_artefact_with_response(
        bundle_id, [comment_id],
        summary="Spelled out the empty-zero-rows case in AC-3.",
    )
    redraft = run_spec_for_run(task_id, events=events, register=register, model=model,
                                github=gh_adapter)

    # The harness took the re-draft path: emitted agent_response.posted, NOT spec.drafted again.
    response_events = [e for e in events.read() if e["type"] == "agent_response.posted"]
    spec_events = [e for e in events.read() if e["type"] == "spec.drafted"]
    assert len(response_events) == 1
    assert len(spec_events) == 1                            # only the first draft; no second one
    response_payload = response_events[0]["payload"]
    assert response_payload["bundle_id"] == bundle_id
    assert response_payload["agent"] == "spec"
    assert response_payload["summary_of_changes"].startswith("Spelled out")
    assert response_payload["addresses"][0]["comment_id"] == comment_id
    assert response_payload["addresses"][0]["action"] == "addressed"
    assert response_payload["ref"]["commit"] == redraft.commit["commit_sha"]

    # The harness stripped the trailing block from the committed file.
    committed = github_client.files[(REPO, branch, "docs/product/specs/csv-export.md")]["content"]
    assert "maestro-response" not in committed
    assert "# CSV export" in committed

    # The projection re-opened the functional gate at the response's seq (NEW pending state).
    state = project_task(events.read(), task_id)
    assert state.stage == "functional_gate"
    assert "functional" in state.open_gates
    assert state.open_gates["functional"]["seq"] == response_events[0]["seq"]
    # And there's exactly one AgentResponse projected for the workspace's diff view.
    assert len(state.agent_responses) == 1
    assert state.agent_responses[0].bundle_id == bundle_id


def test_redraft_uses_existing_file_sha_for_update(write_api, events, register, model_factory,
                                                    audit, gh_adapter, github_client):
    """On a re-draft, GitHub requires the existing file's blob sha (update semantics). The helper
    pulls it from the latest artefact.committed event and passes it through to the harness."""
    from tests.conftest import _Resp

    out = write_api.dispatch_task(ARCH, "maestro", intent="x")
    task_id = out["task_id"]
    branch = "maestro/task-" + task_id.removeprefix("run-")

    model, provider = model_factory(audit, resp=_Resp(text=_spec_artefact()))
    run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    opener_seq = project_task(events.read(), task_id).open_gates["functional"]["seq"]

    # Comment + request_changes
    cmt = write_api.post_comment(
        ARCH, "maestro", task_id, body="rework",
        anchor={"artefact": {"kind": "functional_spec",
                              "ref": {"repo": REPO, "branch": branch,
                                      "path": "docs/product/specs/csv-export.md",
                                      "commit": "abc"}},
                "locator": {"criterion_id": "AC-3"}})
    dec = write_api.decide_gate(ARCH, "maestro", task_id, "functional",
                                 decision="request_changes", rationale="x",
                                 if_match=opener_seq, idempotency_key="dk-sha")
    bundle_id = dec["feedback_bundle_id"]

    # The fake records put_file calls; on the first commit sha was None (create), on the re-draft
    # it must be the existing file_sha.
    first_call = github_client.put_file_calls[-1]
    assert first_call["sha"] is None

    provider._resp.content[0].text = _redraft_artefact_with_response(
        bundle_id, [cmt["comment_id"]], summary="redrafted")
    run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)

    redraft_call = github_client.put_file_calls[-1]
    assert redraft_call["sha"] is not None
    assert redraft_call["sha"].startswith("blob-")


# --- missing / malformed response block ---------------------------------------------------------

def test_redraft_without_response_block_is_rejected(write_api, events, register, model_factory,
                                                     audit, gh_adapter):
    """On a re-draft (feedback_bundle in inputs), the LLM MUST emit the trailing maestro-response
    block. Without it the harness raises ArtefactRejected (missing_response_block) — no half-
    finished cycle lands in the log."""
    from tests.conftest import _Resp

    out = write_api.dispatch_task(ARCH, "maestro", intent="x")
    task_id = out["task_id"]
    branch = "maestro/task-" + task_id.removeprefix("run-")
    model, provider = model_factory(audit, resp=_Resp(text=_spec_artefact()))
    run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    opener = project_task(events.read(), task_id).open_gates["functional"]["seq"]
    write_api.post_comment(ARCH, "maestro", task_id, body="x",
                           anchor={"artefact": {"kind": "functional_spec",
                                                "ref": {"repo": REPO, "branch": branch,
                                                        "path": "docs/product/specs/csv-export.md",
                                                        "commit": "abc"}},
                                   "locator": {"criterion_id": "AC-3"}})
    write_api.decide_gate(ARCH, "maestro", task_id, "functional",
                           decision="request_changes", rationale="x",
                           if_match=opener, idempotency_key="k")

    # The re-draft text has NO trailing fenced block.
    provider._resp.content[0].text = _spec_artefact()           # just an artefact, no response
    with pytest.raises(ArtefactRejected) as ei:
        run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    assert ei.value.reason == "missing_response_block"


def test_redraft_with_malformed_response_block_is_rejected(write_api, events, register,
                                                            model_factory, audit, gh_adapter):
    """A response block with broken JSON → ArtefactRejected (malformed_response_block)."""
    from tests.conftest import _Resp

    out = write_api.dispatch_task(ARCH, "maestro", intent="x")
    task_id = out["task_id"]
    branch = "maestro/task-" + task_id.removeprefix("run-")
    model, provider = model_factory(audit, resp=_Resp(text=_spec_artefact()))
    run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    opener = project_task(events.read(), task_id).open_gates["functional"]["seq"]
    write_api.post_comment(ARCH, "maestro", task_id, body="x",
                           anchor={"artefact": {"kind": "functional_spec",
                                                "ref": {"repo": REPO, "branch": branch,
                                                        "path": "docs/product/specs/csv-export.md",
                                                        "commit": "abc"}},
                                   "locator": {"criterion_id": "AC-3"}})
    write_api.decide_gate(ARCH, "maestro", task_id, "functional",
                           decision="request_changes", rationale="x",
                           if_match=opener, idempotency_key="k")

    provider._resp.content[0].text = (
        _spec_artefact()
        + "\n```json maestro-response\n{ not valid json\n```\n"
    )
    with pytest.raises(ArtefactRejected) as ei:
        run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    assert ei.value.reason == "malformed_response_block"


# --- bundle ↔ response validation rules ---------------------------------------------------------

def _make_pending_redraft(write_api, events, register, model_factory, audit, gh_adapter):
    """Helper: dispatch, draft, comment, request_changes — leaving the task ready for a re-draft.
    Returns ``(task_id, bundle_id, comment_id, provider)``."""
    from tests.conftest import _Resp

    out = write_api.dispatch_task(ARCH, "maestro", intent="x")
    task_id = out["task_id"]
    branch = "maestro/task-" + task_id.removeprefix("run-")
    model, provider = model_factory(audit, resp=_Resp(text=_spec_artefact()))
    run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    opener = project_task(events.read(), task_id).open_gates["functional"]["seq"]
    cmt = write_api.post_comment(ARCH, "maestro", task_id, body="r",
                                  anchor={"artefact": {"kind": "functional_spec",
                                                       "ref": {"repo": REPO, "branch": branch,
                                                               "path": "docs/product/specs/csv-export.md",
                                                               "commit": "abc"}},
                                          "locator": {"criterion_id": "AC-3"}})
    dec = write_api.decide_gate(ARCH, "maestro", task_id, "functional",
                                 decision="request_changes", rationale="x",
                                 if_match=opener, idempotency_key="k")
    return task_id, dec["feedback_bundle_id"], cmt["comment_id"], model, provider


def test_response_bundle_id_must_match(write_api, events, register, model_factory, audit,
                                        gh_adapter):
    task_id, _bundle_id, cmt_id, model, provider = _make_pending_redraft(
        write_api, events, register, model_factory, audit, gh_adapter)
    provider._resp.content[0].text = _redraft_artefact_with_response(
        "fb-WRONG", [cmt_id], summary="x")
    with pytest.raises(ArtefactRejected) as ei:
        run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    assert ei.value.reason == "response_bundle_mismatch"


def test_response_must_have_one_address_per_bundle_item(write_api, events, register,
                                                          model_factory, audit, gh_adapter):
    """``addresses[]`` has one entry per items[] entry (ADR-0022 — no silent skipping)."""
    task_id, bundle_id, _cmt_id, model, provider = _make_pending_redraft(
        write_api, events, register, model_factory, audit, gh_adapter)
    # Empty addresses list against a bundle that has one item.
    response = {"bundle_id": bundle_id, "summary_of_changes": "x", "addresses": []}
    provider._resp.content[0].text = (
        _spec_artefact() + "\n```json maestro-response\n" + json.dumps(response) + "\n```\n"
    )
    with pytest.raises(ArtefactRejected) as ei:
        run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    assert ei.value.reason == "incomplete_addresses"


def test_response_action_must_be_in_enum(write_api, events, register, model_factory, audit,
                                          gh_adapter):
    task_id, bundle_id, cmt_id, model, provider = _make_pending_redraft(
        write_api, events, register, model_factory, audit, gh_adapter)
    response = {
        "bundle_id": bundle_id, "summary_of_changes": "x",
        "addresses": [{"comment_id": cmt_id, "action": "ignored",
                       "note": "We did not do this.", "ref_section": None}],
    }
    provider._resp.content[0].text = (
        _spec_artefact() + "\n```json maestro-response\n" + json.dumps(response) + "\n```\n"
    )
    with pytest.raises(ArtefactRejected) as ei:
        run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    assert ei.value.reason == "invalid_action"


def test_response_note_must_be_within_240_chars(write_api, events, register, model_factory, audit,
                                                  gh_adapter):
    task_id, bundle_id, cmt_id, model, provider = _make_pending_redraft(
        write_api, events, register, model_factory, audit, gh_adapter)
    long_note = "x" * (MAX_NOTE_CHARS + 1)
    response = {
        "bundle_id": bundle_id, "summary_of_changes": "x",
        "addresses": [{"comment_id": cmt_id, "action": "addressed",
                       "note": long_note, "ref_section": None}],
    }
    provider._resp.content[0].text = (
        _spec_artefact() + "\n```json maestro-response\n" + json.dumps(response) + "\n```\n"
    )
    with pytest.raises(ArtefactRejected) as ei:
        run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    assert ei.value.reason == "oversize_note"


def test_response_summary_of_changes_envelope_enforced(write_api, events, register, model_factory,
                                                         audit, gh_adapter):
    """summary_of_changes must be ≤120 words / 800 chars (ADR-0022, mirrors maestro.summary)."""
    task_id, bundle_id, cmt_id, model, provider = _make_pending_redraft(
        write_api, events, register, model_factory, audit, gh_adapter)
    over = " ".join(["word"] * 150)
    response = {
        "bundle_id": bundle_id, "summary_of_changes": over,
        "addresses": [{"comment_id": cmt_id, "action": "addressed",
                       "note": "ok", "ref_section": None}],
    }
    provider._resp.content[0].text = (
        _spec_artefact() + "\n```json maestro-response\n" + json.dumps(response) + "\n```\n"
    )
    with pytest.raises(ArtefactRejected) as ei:
        run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    assert ei.value.reason == "oversize_summary_of_changes"


def test_response_comment_id_must_match_bundle_order(write_api, events, register, model_factory,
                                                       audit, gh_adapter):
    """addresses[i].comment_id must match items[i].comment_id — bundle order is the contract."""
    task_id, bundle_id, _cmt_id, model, provider = _make_pending_redraft(
        write_api, events, register, model_factory, audit, gh_adapter)
    response = {
        "bundle_id": bundle_id, "summary_of_changes": "x",
        "addresses": [{"comment_id": "cmt-WRONG", "action": "addressed",
                       "note": "ok", "ref_section": None}],
    }
    provider._resp.content[0].text = (
        _spec_artefact() + "\n```json maestro-response\n" + json.dumps(response) + "\n```\n"
    )
    with pytest.raises(ArtefactRejected) as ei:
        run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    assert ei.value.reason == "incomplete_addresses"


# --- read API surfaces agent_responses ----------------------------------------------------------

def test_get_task_surfaces_agent_responses(write_api, events, register, model_factory, audit,
                                            gh_adapter, content_reader):
    """The workspace's diff-of-artefact view reads agent_responses from GET /tasks/{t}."""
    from orchestrator.readapi import ReadAPI

    task_id, bundle_id, cmt_id, model, provider = _make_pending_redraft(
        write_api, events, register, model_factory, audit, gh_adapter)
    provider._resp.content[0].text = _redraft_artefact_with_response(
        bundle_id, [cmt_id], summary="redrafted ac-3")
    run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)

    api = ReadAPI(register, events, content_reader)
    out = api.get_task("@arch", "maestro", task_id)
    [resp] = out["agent_responses"]
    assert resp["bundle_id"] == bundle_id
    assert resp["agent"] == "spec"
    assert resp["kind"] == "functional_spec"
    assert resp["summary_of_changes"].startswith("redrafted")
    assert resp["addresses"][0]["comment_id"] == cmt_id


# --- multi-cycle: a second request_changes after the first response opens a new bundle ----------

def test_two_request_changes_cycles_produce_two_responses(write_api, events, register,
                                                            model_factory, audit, gh_adapter):
    """Each request_changes opens a new bundle; the previous bundle is closed (matched by an
    agent_response.posted with the same bundle_id) and the helper picks the new active one on
    the next re-draft. Two cycles ⇒ two responses, two bundles, no cross-talk."""
    from tests.conftest import _Resp

    out = write_api.dispatch_task(ARCH, "maestro", intent="x")
    task_id = out["task_id"]
    branch = "maestro/task-" + task_id.removeprefix("run-")
    model, provider = model_factory(audit, resp=_Resp(text=_spec_artefact()))
    run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    state = project_task(events.read(), task_id)
    opener_1 = state.open_gates["functional"]["seq"]

    # Cycle 1.
    cmt1 = write_api.post_comment(ARCH, "maestro", task_id, body="rev1",
                                   anchor={"artefact": {"kind": "functional_spec",
                                                        "ref": {"repo": REPO, "branch": branch,
                                                                "path": "docs/product/specs/csv-export.md",
                                                                "commit": "abc"}},
                                           "locator": {"criterion_id": "AC-3"}})
    dec1 = write_api.decide_gate(ARCH, "maestro", task_id, "functional",
                                  decision="request_changes", rationale="rev1",
                                  if_match=opener_1, idempotency_key="k1")
    bundle_1 = dec1["feedback_bundle_id"]
    provider._resp.content[0].text = _redraft_artefact_with_response(
        bundle_1, [cmt1["comment_id"]], summary="cycle 1 redraft")
    run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)

    state = project_task(events.read(), task_id)
    opener_2 = state.open_gates["functional"]["seq"]
    assert opener_2 != opener_1                                # new pending state, new seq

    # Cycle 2 — another anchored comment, request_changes again.
    cmt2 = write_api.post_comment(ARCH, "maestro", task_id, body="rev2",
                                   anchor={"artefact": {"kind": "functional_spec",
                                                        "ref": {"repo": REPO, "branch": branch,
                                                                "path": "docs/product/specs/csv-export.md",
                                                                "commit": "abc"}},
                                           "locator": {"criterion_id": "AC-1"}})
    dec2 = write_api.decide_gate(ARCH, "maestro", task_id, "functional",
                                  decision="request_changes", rationale="rev2",
                                  if_match=opener_2, idempotency_key="k2")
    bundle_2 = dec2["feedback_bundle_id"]
    assert bundle_2 != bundle_1
    # Bundle 2 only contains cmt2 — cmt1 was already addressed in cycle 1 (its seq is before
    # opener_2, which is the agent_response.posted that re-opened the gate). This is the
    # composition rule from workspace-write-api.py._collect_feedback_items: comments with
    # seq > current open_gate.seq.
    provider._resp.content[0].text = _redraft_artefact_with_response(
        bundle_2, [cmt2["comment_id"]], summary="cycle 2 redraft")
    run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)

    state = project_task(events.read(), task_id)
    assert len(state.agent_responses) == 2
    assert state.agent_responses[0].bundle_id == bundle_1
    assert state.agent_responses[1].bundle_id == bundle_2
