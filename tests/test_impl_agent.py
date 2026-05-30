"""The builder agent (US-0011, ``impl``) — ``run_impl_for_run``.

Same offline discipline as :mod:`tests.test_design_agent`: ``FakeGitHubClient`` + ``FakeProvider``
(conftest.py), no sockets, no real LLM. The builder reads the approved design + spec content the
reader serves, commits one-commit-per-task to the **same** ``maestro/*`` branch, and opens a **draft**
PR whose body carries the requirement→change traceability — then ``pr.opened`` advances the projection
to the merge gate.
"""
import json

import pytest

from orchestrator.agents.impl import (
    DEFAULT_PROMPT_PATH,
    BuildRejected,
    run_impl_for_run,
)
from orchestrator.projection import project_task

ARCH = "@arch"
REPO = "acme/widget"                       # the register fixture's repo for product 'maestro'
BRANCH = "maestro/task-9c2e3f"             # the spec agent's branch — design + impl use the SAME one
SPEC_PATH = "docs/product/specs/csv-export.md"
DESIGN_PATH = "docs/architecture/csv-export-design.md"


# --- fixtures -----------------------------------------------------------------------------------

def _spec_md(acs=("AC-1", "AC-2")):
    crit = "\n".join(f"- **{ac}.** WHEN a thing happens THE SYSTEM SHALL respond." for ac in acs)
    return f"""---
title: "CSV export"
maestro:
  feature: csv-export
  kind: functional_spec
---

# CSV export

## Acceptance criteria (EARS)

{crit}
"""


def _design_md(feature="csv-export"):
    return f"""---
title: "CSV export — technical design"
maestro:
  feature: {feature}
  kind: technical_design
---

# CSV export — technical design

## Task list
| # | Task | Targets | Requirements | Depends on |
|---|---|---|---|---|
| 1 | Add /reports/csv endpoint | {REPO} | AC-1 | — |
| 2 | Wire auth + rate limit | {REPO} | AC-2 | 1 |
"""


def _build_response(feature="csv-export", commits=None, summary="Adds a CSV export endpoint."):
    if commits is None:
        commits = [
            {"task": 1, "title": "Add /reports/csv endpoint", "requirements": ["AC-1"],
             "files": [{"path": "reports/csv.py", "content": "# csv endpoint\n"}]},
            {"task": 2, "title": "Wire auth + rate limit", "requirements": ["AC-2"],
             "files": [{"path": "reports/auth.py", "content": "# auth\n"},
                       {"path": "reports/limits.py", "content": "# limits\n"}]},
        ]
    plan = {"feature": feature, "summary": summary, "commits": commits}
    # A little prose above the block — the parser anchors on the trailing fence, so this is ignored.
    return "Here is the implementation plan.\n\n```json maestro-build\n" + \
        json.dumps(plan, indent=2) + "\n```\n"


@pytest.fixture
def model_with_build(model_factory, audit):
    """(model, provider) whose response is the well-formed build plan above."""
    from tests.conftest import _Resp
    return model_factory(audit, resp=_Resp(text=_build_response(), input_tokens=300,
                                            output_tokens=600))


@pytest.fixture
def design_approved(write_api, events, github_client):
    """A dispatched task with spec.drafted + design.produced seeded, and the spec/design content
    placed on the branch so the builder's reader can fetch them — the state when build_node runs."""
    out = write_api.dispatch_task(ARCH, "maestro", intent="Add a CSV export endpoint")
    task_id = out["task_id"]
    github_client.files[(REPO, BRANCH, SPEC_PATH)] = {"content": _spec_md(), "file_sha": "specsha"}
    github_client.files[(REPO, BRANCH, DESIGN_PATH)] = {"content": _design_md(),
                                                         "file_sha": "designsha"}
    events.append(run_id=task_id, actor="spec-agent", type="spec.drafted",
                  target=f"{REPO}:{BRANCH}:{SPEC_PATH}",
                  payload={"task_id": task_id, "agent": "spec", "kind": "functional_spec",
                           "feature": "csv-export",
                           "ref": {"repo": REPO, "branch": BRANCH, "path": SPEC_PATH,
                                   "commit": "speccommit"}})
    events.append(run_id=task_id, actor="design-agent", type="design.produced",
                  target=f"{REPO}:{BRANCH}:{DESIGN_PATH}",
                  payload={"task_id": task_id, "agent": "design", "kind": "technical_design",
                           "feature": "csv-export",
                           "ref": {"repo": REPO, "branch": BRANCH, "path": DESIGN_PATH,
                                   "commit": "designcommit"}})
    return task_id


# --- happy path ---------------------------------------------------------------------------------

def test_run_impl_end_to_end(design_approved, events, register, model_with_build, github,
                             github_client):
    """design.produced → per-task commits on the SAME branch → draft PR → pr.opened opens the
    technical_merge gate."""
    model, _ = model_with_build
    out = run_impl_for_run(design_approved, events=events, register=register, model=model,
                           github=github, reader=github_client)

    assert out.repo == REPO and out.branch == BRANCH and out.feature == "csv-export"

    # No new branch — the spec agent already opened it; the builder commits onto it.
    assert not any(e["type"] == "branch.created" for e in events.read())

    # The files landed on the branch.
    assert (REPO, BRANCH, "reports/csv.py") in github_client.files
    assert (REPO, BRANCH, "reports/auth.py") in github_client.files

    # A draft PR was opened head=branch, base=main.
    assert len(github_client.prs) == 1
    pr = github_client.prs[0]
    assert pr["head"] == BRANCH and pr["base"] == "main" and pr["draft"] is True
    assert out.pr["draft"] is True

    # The projection advances to the merge gate, with the technical_merge gate open.
    state = project_task(events.read(), design_approved)
    assert state.stage == "merge_gate"
    assert "technical_merge" in state.open_gates
    assert state.open_gates["technical_merge"]["seq"] == out.pr_event_seq
    assert state.pr["draft"] is True


def test_one_commit_per_task_in_order(design_approved, events, register, model_with_build,
                                      github, github_client):
    """The M2 commit-shape resolution — one commit per task-list entry, message ``task-{n}: …``,
    in dependency order. Task 2 touches two files; they land in ONE commit, not two."""
    model, _ = model_with_build
    run_impl_for_run(design_approved, events=events, register=register, model=model,
                     github=github, reader=github_client)

    msgs = [c["message"] for c in github_client.commits]
    assert msgs == ["task-1: Add /reports/csv endpoint", "task-2: Wire auth + rate limit"]
    # Task 2's two files are one commit.
    assert github_client.commits[1]["paths"] == ["reports/auth.py", "reports/limits.py"]

    # One commit.created event per commit, carrying the requirements for the audit.
    created = [e for e in events.read() if e["type"] == "commit.created"]
    assert [e["payload"]["task"] for e in created] == [1, 2]
    assert created[0]["payload"]["requirements"] == ["AC-1"]


def test_pr_body_has_task_link_refs_and_traceability(design_approved, events, register,
                                                     model_with_build, github, github_client):
    """AC #2: the PR description links the delivery task + approved spec/design and shows which
    requirement each change satisfies."""
    model, _ = model_with_build
    run_impl_for_run(design_approved, events=events, register=register, model=model,
                     github=github, reader=github_client)
    body = github_client.prs[0]["body"]

    assert design_approved in body                          # delivery task id
    assert SPEC_PATH in body and DESIGN_PATH in body        # approved spec + design refs
    assert "Adds a CSV export endpoint." in body            # the builder's summary
    # Every AC is traced to the task that satisfies it.
    assert "| AC-1 |" in body and "`task-1`" in body
    assert "| AC-2 |" in body and "`task-2`" in body


def test_unmapped_ac_is_surfaced(design_approved, events, register, model_factory, audit,
                                 github, github_client):
    """An acceptance criterion in the spec that no commit claims is surfaced as ⚠️ unmapped — the
    traceability gap is visible, not silently dropped."""
    from tests.conftest import _Resp
    # Spec has AC-1, AC-2, AC-3; the build only maps AC-1 and AC-2.
    github_client.files[(REPO, BRANCH, SPEC_PATH)] = {
        "content": _spec_md(acs=("AC-1", "AC-2", "AC-3")), "file_sha": "specsha"}
    model, _ = model_factory(audit, resp=_Resp(text=_build_response()))
    run_impl_for_run(design_approved, events=events, register=register, model=model,
                     github=github, reader=github_client)
    body = github_client.prs[0]["body"]
    assert "| AC-3 | ⚠️ unmapped |" in body


# --- idempotent re-build ------------------------------------------------------------------------

def test_reinvoke_does_not_open_a_second_pr(design_approved, events, register, model_with_build,
                                            github, github_client):
    """On a merge-gate request_changes the graph loops back to build_node and the builder re-runs.
    It pushes revised commits but must NOT open a duplicate PR (idempotency)."""
    model, _ = model_with_build
    run_impl_for_run(design_approved, events=events, register=register, model=model,
                     github=github, reader=github_client)
    assert len(github_client.prs) == 1

    out2 = run_impl_for_run(design_approved, events=events, register=register, model=model,
                            github=github, reader=github_client)
    assert len(github_client.prs) == 1                      # no second PR
    assert out2.pr_event_seq is None                        # no new pr.opened event
    assert out2.pr["number"] == github_client.prs[0]["number"]
    # The revised commits were still pushed (4 commits total over the two runs).
    assert len(github_client.commits) == 4


# --- failure modes ------------------------------------------------------------------------------

def test_missing_build_block_is_rejected(design_approved, events, register, model_factory, audit,
                                         github, github_client):
    from tests.conftest import _Resp
    model, _ = model_factory(audit, resp=_Resp(text="I implemented it, trust me."))
    with pytest.raises(BuildRejected) as ei:
        run_impl_for_run(design_approved, events=events, register=register, model=model,
                         github=github, reader=github_client)
    assert ei.value.reason == "missing_build_block"


def test_wrong_feature_is_rejected(design_approved, events, register, model_factory, audit,
                                   github, github_client):
    from tests.conftest import _Resp
    model, _ = model_factory(audit, resp=_Resp(text=_build_response(feature="something-else")))
    with pytest.raises(BuildRejected) as ei:
        run_impl_for_run(design_approved, events=events, register=register, model=model,
                         github=github, reader=github_client)
    assert ei.value.reason == "wrong_feature"
    assert not github_client.prs                            # nothing opened on a rejected plan


def test_commit_without_files_is_rejected(design_approved, events, register, model_factory, audit,
                                          github, github_client):
    from tests.conftest import _Resp
    bad = _build_response(commits=[{"task": 1, "title": "x", "requirements": ["AC-1"], "files": []}])
    model, _ = model_factory(audit, resp=_Resp(text=bad))
    with pytest.raises(BuildRejected) as ei:
        run_impl_for_run(design_approved, events=events, register=register, model=model,
                         github=github, reader=github_client)
    assert ei.value.reason == "bad_commit"


def test_missing_design_produced_is_an_error(events, register, model_with_build, github,
                                             github_client, write_api):
    """The builder runs only after the design helper emitted design.produced. A misuse fails loudly."""
    out = write_api.dispatch_task(ARCH, "maestro", intent="Add CSV export")
    model, _ = model_with_build
    with pytest.raises(ValueError) as ei:
        run_impl_for_run(out["task_id"], events=events, register=register, model=model,
                         github=github, reader=github_client)
    assert "design.produced" in str(ei.value)


def test_unknown_product_is_an_error(events, model_with_build, github, github_client):
    events.append(run_id="run-orphan", actor=ARCH, type="task.dispatched",
                  target="task:run-orphan",
                  payload={"task_id": "run-orphan", "product_id": "ghost", "repo": "acme/ghost",
                           "intent": "x"})
    for etype, agent, kind, path in (("spec.drafted", "spec", "functional_spec", "s.md"),
                                     ("design.produced", "design", "technical_design", "d.md")):
        events.append(run_id="run-orphan", actor=f"{agent}-agent", type=etype,
                      target=f"acme/ghost:maestro/task-orphan:{path}",
                      payload={"task_id": "run-orphan", "agent": agent, "kind": kind,
                               "feature": "x",
                               "ref": {"repo": "acme/ghost", "branch": "maestro/task-orphan",
                                       "path": path, "commit": "abc"}})
    from orchestrator.register import Register
    model, _ = model_with_build
    with pytest.raises(ValueError) as ei:
        run_impl_for_run("run-orphan", events=events, register=Register(products={}),
                         model=model, github=github, reader=github_client)
    assert "not in register" in str(ei.value)


# --- prompt anchor ------------------------------------------------------------------------------

def test_default_prompt_path_points_at_the_shipped_file():
    assert DEFAULT_PROMPT_PATH == "standards/prompts/impl-agent.md"
