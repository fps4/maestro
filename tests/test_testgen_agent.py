"""The test agent (US-0014, ``testgen``) — ``run_testgen_for_run``.

Same offline discipline as :mod:`tests.test_impl_agent`: ``FakeGitHubClient`` + ``FakeProvider``
(conftest.py), no sockets, no real LLM. The test agent reads the approved spec + the builder's
committed implementation the reader serves, then commits spec-derived tests to the **same**
``maestro/*`` branch in one commit and emits ``tests.generated`` carrying the per-criterion coverage.
The core invariant: **every EARS acceptance criterion is covered** and **no production code is
written**.
"""
import json

import pytest

from orchestrator.agents.testgen import (
    TestsRejected,
    run_testgen_for_run,
)

ARCH = "@arch"
REPO = "acme/widget"                       # the register fixture's repo for product 'maestro'
BRANCH = "maestro/task-9c2e3f"             # the builder's branch — testgen commits onto the SAME one
SPEC_PATH = "docs/product/specs/csv-export.md"
DESIGN_PATH = "docs/architecture/csv-export-design.md"
IMPL_PATH = "reports/csv.py"


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
"""


def _tests_response(feature="csv-export", files=None,
                    summary="Tests the CSV export endpoint against each criterion."):
    if files is None:
        files = [
            {"path": "tests/test_csv_export.py", "criteria": ["AC-1", "AC-2"],
             "content": "def test_ac1():\n    assert True\n\n\ndef test_ac2():\n    assert True\n"},
        ]
    plan = {"feature": feature, "summary": summary, "files": files}
    # Prose above the trailing block; the parser anchors on the trailing fence, so this is ignored.
    return "Here is the test plan.\n\n```json maestro-tests\n" + json.dumps(plan, indent=2) + "\n```\n"


@pytest.fixture
def model_with_tests(model_factory, audit):
    """(model, provider) whose response is the well-formed test plan above."""
    from tests.conftest import _Resp
    return model_factory(audit, resp=_Resp(text=_tests_response(), input_tokens=300,
                                            output_tokens=500))


@pytest.fixture
def impl_landed(write_api, events, github_client):
    """A dispatched task with spec.drafted + design.produced + a builder commit.created seeded, and
    the spec/design/impl content placed on the branch so the test agent's reader can fetch them —
    the state when build_node calls the test agent after the builder."""
    out = write_api.dispatch_task(ARCH, "maestro", intent="Add a CSV export endpoint")
    task_id = out["task_id"]
    github_client.files[(REPO, BRANCH, SPEC_PATH)] = {"content": _spec_md(), "file_sha": "specsha"}
    github_client.files[(REPO, BRANCH, DESIGN_PATH)] = {"content": _design_md(),
                                                         "file_sha": "designsha"}
    github_client.files[(REPO, BRANCH, IMPL_PATH)] = {"content": "# csv endpoint\n",
                                                       "file_sha": "implsha"}
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
    events.append(run_id=task_id, actor="impl-agent", type="commit.created",
                  target=f"{REPO}:{BRANCH}",
                  payload={"repo": REPO, "branch": BRANCH, "task": 1,
                           "requirements": ["AC-1"], "paths": [IMPL_PATH],
                           "commit_sha": "implcommit", "message": "task-1: add endpoint"})
    return task_id


# --- happy path ---------------------------------------------------------------------------------

def test_run_testgen_end_to_end(impl_landed, events, register, model_with_tests, github,
                                github_client):
    """spec + implementation → one tests commit on the SAME branch → tests.generated with coverage."""
    model, _ = model_with_tests
    out = run_testgen_for_run(impl_landed, events=events, register=register, model=model,
                              github=github, reader=github_client)

    assert out.repo == REPO and out.branch == BRANCH and out.feature == "csv-export"

    # No new branch, no PR — the builder owns those; the test agent only commits tests.
    assert not any(e["type"] == "branch.created" for e in events.read())
    assert len(github_client.prs) == 0

    # The test file landed on the branch in ONE commit named for the feature.
    assert (REPO, BRANCH, "tests/test_csv_export.py") in github_client.files
    assert github_client.commits[-1]["message"] == "tests: spec-derived tests for csv-export"
    assert github_client.commits[-1]["paths"] == ["tests/test_csv_export.py"]

    # Coverage maps every spec AC to its test file.
    assert out.coverage == {"AC-1": ["tests/test_csv_export.py"],
                            "AC-2": ["tests/test_csv_export.py"]}


def test_tests_generated_event_carries_coverage(impl_landed, events, register, model_with_tests,
                                                github, github_client):
    """tests.generated records, per criterion, which files cover it — the audited spec-adherence
    claim the DoD orchestration (US-0020) reads alongside the CI poll."""
    model, _ = model_with_tests
    out = run_testgen_for_run(impl_landed, events=events, register=register, model=model,
                              github=github, reader=github_client)
    gen = [e for e in events.read() if e["type"] == "tests.generated"]
    assert len(gen) == 1
    payload = gen[0]["payload"]
    assert payload["feature"] == "csv-export"
    assert payload["coverage"] == {"AC-1": ["tests/test_csv_export.py"],
                                   "AC-2": ["tests/test_csv_export.py"]}
    assert payload["paths"] == ["tests/test_csv_export.py"]
    assert gen[0]["seq"] == out.event_seq

    # One commit.created from the test commit too (the adapter audits every write).
    test_commits = [e for e in events.read()
                    if e["type"] == "commit.created" and e["payload"].get("task") is None]
    assert len(test_commits) == 1
    assert test_commits[0]["payload"]["paths"] == ["tests/test_csv_export.py"]


def test_multiple_files_each_cover_some_criteria(impl_landed, events, register, model_factory,
                                                 audit, github, github_client):
    """A criterion may be covered by its own file; the coverage map unions across files."""
    from tests.conftest import _Resp
    files = [
        {"path": "tests/test_csv_unit.py", "criteria": ["AC-1"],
         "content": "def test_ac1():\n    assert True\n"},
        {"path": "tests/test_csv_integration.py", "criteria": ["AC-2"],
         "content": "def test_ac2():\n    assert True\n"},
    ]
    model, _ = model_factory(audit, resp=_Resp(text=_tests_response(files=files)))
    out = run_testgen_for_run(impl_landed, events=events, register=register, model=model,
                              github=github, reader=github_client)
    assert out.coverage == {"AC-1": ["tests/test_csv_unit.py"],
                            "AC-2": ["tests/test_csv_integration.py"]}
    # Both files in one commit.
    assert github_client.commits[-1]["paths"] == ["tests/test_csv_unit.py",
                                                  "tests/test_csv_integration.py"]


# --- rejection paths ----------------------------------------------------------------------------

def test_uncovered_criterion_is_rejected(impl_landed, events, register, model_factory, audit,
                                         github, github_client):
    """US-0014 AC #1/#5: a spec criterion with no test fails generation — the gate can't be green."""
    from tests.conftest import _Resp
    # Spec has AC-1, AC-2, AC-3; the plan only covers AC-1 and AC-2.
    github_client.files[(REPO, BRANCH, SPEC_PATH)] = {
        "content": _spec_md(acs=("AC-1", "AC-2", "AC-3")), "file_sha": "specsha"}
    model, _ = model_factory(audit, resp=_Resp(text=_tests_response()))
    with pytest.raises(TestsRejected) as exc:
        run_testgen_for_run(impl_landed, events=events, register=register, model=model,
                            github=github, reader=github_client)
    assert exc.value.reason == "uncovered_criterion"
    assert "AC-3" in str(exc.value)
    # Nothing committed on a rejected plan.
    assert (REPO, BRANCH, "tests/test_csv_export.py") not in github_client.files


def test_path_outside_test_root_is_rejected(impl_landed, events, register, model_factory, audit,
                                            github, github_client):
    """US-0014 AC #4: the test agent writes tests only — a path outside the test root is refused so
    it cannot edit production code."""
    from tests.conftest import _Resp
    files = [{"path": "reports/csv.py", "criteria": ["AC-1", "AC-2"],
              "content": "# sneaky production edit\n"}]
    model, _ = model_factory(audit, resp=_Resp(text=_tests_response(files=files)))
    with pytest.raises(TestsRejected) as exc:
        run_testgen_for_run(impl_landed, events=events, register=register, model=model,
                            github=github, reader=github_client)
    assert exc.value.reason == "production_code_write"


def test_path_traversal_is_rejected(impl_landed, events, register, model_factory, audit,
                                    github, github_client):
    """A tests/ prefix with a ``..`` escape is still a production-code write."""
    from tests.conftest import _Resp
    files = [{"path": "tests/../reports/csv.py", "criteria": ["AC-1", "AC-2"],
              "content": "# escape\n"}]
    model, _ = model_factory(audit, resp=_Resp(text=_tests_response(files=files)))
    with pytest.raises(TestsRejected) as exc:
        run_testgen_for_run(impl_landed, events=events, register=register, model=model,
                            github=github, reader=github_client)
    assert exc.value.reason == "production_code_write"


def test_unknown_criterion_is_rejected(impl_landed, events, register, model_factory, audit,
                                       github, github_client):
    """A criteria id the spec never declared is a stray reference, surfaced not silently kept."""
    from tests.conftest import _Resp
    files = [{"path": "tests/test_csv.py", "criteria": ["AC-1", "AC-2", "AC-9"],
              "content": "def test_x():\n    assert True\n"}]
    model, _ = model_factory(audit, resp=_Resp(text=_tests_response(files=files)))
    with pytest.raises(TestsRejected) as exc:
        run_testgen_for_run(impl_landed, events=events, register=register, model=model,
                            github=github, reader=github_client)
    assert exc.value.reason == "unknown_criterion"


def test_wrong_feature_is_rejected(impl_landed, events, register, model_factory, audit,
                                   github, github_client):
    """A drifted feature slug (not the approved design's) is refused."""
    from tests.conftest import _Resp
    model, _ = model_factory(audit, resp=_Resp(text=_tests_response(feature="other-feature")))
    with pytest.raises(TestsRejected) as exc:
        run_testgen_for_run(impl_landed, events=events, register=register, model=model,
                            github=github, reader=github_client)
    assert exc.value.reason == "wrong_feature"


def test_missing_block_is_rejected(impl_landed, events, register, model_factory, audit,
                                   github, github_client):
    """No trailing maestro-tests block → missing_tests_block (same discipline as the builder)."""
    from tests.conftest import _Resp
    model, _ = model_factory(audit, resp=_Resp(text="I wrote some tests, trust me."))
    with pytest.raises(TestsRejected) as exc:
        run_testgen_for_run(impl_landed, events=events, register=register, model=model,
                            github=github, reader=github_client)
    assert exc.value.reason == "missing_tests_block"
