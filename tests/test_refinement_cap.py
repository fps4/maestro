"""US-0024 H2: the refinement loop is bounded.

Once a gate has taken ``max_refinement_iterations`` request_changes → re-draft cycles, a further
request_changes blocks the task instead of opening another cycle. Driven end-to-end through the
write API + spec agent (no LLM, no GitHub) so the cap is exercised on the real event stream.
"""
import json

import pytest

from adapters.github.adapter import GitHubAdapter
from orchestrator.agents.spec import run_spec_for_run
from orchestrator.projection import project_task
from orchestrator.routing import RoutingResolver
from orchestrator.writeapi import WriteAPI

ARCH = "@arch"
REPO = "acme/widget"
SPEC_PATH = "docs/product/specs/csv-export.md"


def _spec_artefact():
    return """---
title: "CSV export"
status: draft
last_updated: 2026-05-30
owners: [architect]
maestro:
  feature: csv-export
  kind: functional_spec
  task: US-0042
  summary: |
    A CSV export endpoint for finance to pull the last quarter's invoices.
---

# CSV export

## Acceptance criteria
- AC-1. The system shall export to CSV.
- AC-3. The system shall handle the empty-result case.
"""


def _redraft_with_response(bundle_id, comment_ids, *, summary):
    response = {
        "bundle_id": bundle_id,
        "summary_of_changes": summary,
        "addresses": [
            {"comment_id": cid, "action": "addressed",
             "note": f"Tightened {cid}.", "ref_section": {"locator": {"criterion_id": "AC-3"}}}
            for cid in comment_ids
        ],
    }
    return _spec_artefact() + "\n```json maestro-response\n" + json.dumps(response, indent=2) + "\n```\n"


def _capped_write_api(register, events, routing, idempotency, cap):
    n = {"run": 0, "cmt": 0, "bnd": 0}

    def run_id():
        n["run"] += 1
        return f"run-{n['run']}"

    def cmt_id():
        n["cmt"] += 1
        return f"cmt-{n['cmt']}"

    def bundle_id():
        n["bnd"] += 1
        return f"fb-{n['bnd']}"

    return WriteAPI(register, events, routing, idempotency,
                    id_factory=run_id, comment_id_factory=cmt_id, bundle_id_factory=bundle_id,
                    refinement_cap=cap)


@pytest.fixture
def gh_adapter(events, register, routing, github_client):
    return GitHubAdapter(events, register, routing, github_client)


def _request_changes_cycle(write_api, events, register, model, provider, gh_adapter, task_id, *, key):
    """One full cycle: comment → request_changes → spec re-draft. Returns the decision response."""
    branch = "maestro/task-" + task_id.removeprefix("run-")
    opener = project_task(events.read(), task_id).open_gates["functional"]["seq"]
    cmt = write_api.post_comment(
        ARCH, "maestro", task_id, body="rework AC-3",
        anchor={"artefact": {"kind": "functional_spec",
                             "ref": {"repo": REPO, "branch": branch, "path": SPEC_PATH, "commit": "abc"}},
                "locator": {"criterion_id": "AC-3"}})
    dec = write_api.decide_gate(ARCH, "maestro", task_id, "functional",
                                decision="request_changes", rationale="address AC-3",
                                if_match=opener, idempotency_key=key)
    if dec.get("status") != "blocked":
        provider._resp.content[0].text = _redraft_with_response(
            dec["feedback_bundle_id"], [cmt["comment_id"]], summary="redrafted AC-3")
        run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)
    return dec


def test_third_request_changes_blocks_when_cap_is_two(
        register, events, routing, idempotency, model_factory, audit, gh_adapter):
    from tests.conftest import _Resp

    write_api = _capped_write_api(register, events, routing, idempotency, cap=2)
    out = write_api.dispatch_task(ARCH, "maestro", intent="Add CSV export")
    task_id = out["task_id"]

    model, provider = model_factory(audit, resp=_Resp(text=_spec_artefact()))
    run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)

    # Two cycles are allowed (cap=2): each opens a bundle and re-drafts.
    d1 = _request_changes_cycle(write_api, events, register, model, provider, gh_adapter, task_id, key="k1")
    d2 = _request_changes_cycle(write_api, events, register, model, provider, gh_adapter, task_id, key="k2")
    assert d1["feedback_bundle_id"] is not None and d1.get("status") != "blocked"
    assert d2["feedback_bundle_id"] is not None and d2.get("status") != "blocked"

    # The third request_changes is over the cap → the task blocks, no bundle, no re-draft.
    d3 = _request_changes_cycle(write_api, events, register, model, provider, gh_adapter, task_id, key="k3")
    assert d3["status"] == "blocked"
    assert d3["blocked_reason"] == "refinement_cap_exceeded"
    assert d3["feedback_bundle_id"] is None

    log = events.read()
    blocked = [e for e in log if e["type"] == "task.blocked"]
    assert len(blocked) == 1
    assert blocked[0]["payload"]["reason"] == "refinement_cap_exceeded"
    assert blocked[0]["payload"]["cap"] == 2
    # Exactly two feedback bundles were ever created (cycles 1 and 2; the capped cycle made none).
    assert len([e for e in log if e["type"] == "feedback_bundle.created"]) == 2

    state = project_task(log, task_id)
    assert state.status == "blocked"


def test_under_cap_does_not_block(
        register, events, routing, idempotency, model_factory, audit, gh_adapter):
    from tests.conftest import _Resp

    write_api = _capped_write_api(register, events, routing, idempotency, cap=5)
    out = write_api.dispatch_task(ARCH, "maestro", intent="Add CSV export")
    task_id = out["task_id"]
    model, provider = model_factory(audit, resp=_Resp(text=_spec_artefact()))
    run_spec_for_run(task_id, events=events, register=register, model=model, github=gh_adapter)

    for i in range(3):                                     # 3 < cap 5 → never blocks
        dec = _request_changes_cycle(write_api, events, register, model, provider, gh_adapter,
                                     task_id, key=f"k{i}")
        assert dec.get("status") != "blocked"

    state = project_task(events.read(), task_id)
    assert state.status == "active"
    assert not [e for e in events.read() if e["type"] == "task.blocked"]


def test_default_cap_comes_from_config():
    # The shipped reviewers.yaml default is 5 (floored at 1 against misconfig).
    assert RoutingResolver.load().refinement_cap() == 5
