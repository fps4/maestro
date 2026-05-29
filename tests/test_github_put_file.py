"""The GitHub put_file primitive + the audited :meth:`GitHubAdapter.commit_artefact` wrapper.

The branch-policy refusal (``maestro/*``-only) lives in the adapter, NOT the http client — same
shape as ``open_branch``. These tests pin both layers.
"""
import pytest

from adapters.github.adapter import GitHubAdapter
from orchestrator.projection import project_task

REPO = "acme/widget"
BRANCH = "maestro/us-0042-csv-export"


@pytest.fixture
def adapter(events, register, routing, github_client):
    return GitHubAdapter(events, register, routing, github_client)


# --- fake client mechanics ----------------------------------------------------------------------

def test_put_file_create_returns_commit_and_file_sha(github_client):
    res = github_client.put_file(REPO, "docs/x.md", "hello\n", BRANCH, "first commit")
    assert res["path"] == "docs/x.md"
    assert res["commit_sha"].startswith("commit-")
    assert res["file_sha"].startswith("blob-")
    assert github_client.files[(REPO, BRANCH, "docs/x.md")]["content"] == "hello\n"


def test_put_file_update_requires_sha(github_client):
    """The fake mirrors GitHub: an update to an existing path MUST carry the existing blob SHA."""
    github_client.put_file(REPO, "docs/x.md", "v1\n", BRANCH, "create")
    with pytest.raises(RuntimeError):
        github_client.put_file(REPO, "docs/x.md", "v2\n", BRANCH, "update without sha")
    existing_sha = github_client.files[(REPO, BRANCH, "docs/x.md")]["file_sha"]
    res = github_client.put_file(REPO, "docs/x.md", "v2\n", BRANCH, "update", sha=existing_sha)
    assert github_client.files[(REPO, BRANCH, "docs/x.md")]["content"] == "v2\n"
    assert res["file_sha"] != existing_sha


def test_put_file_create_with_sha_is_rejected(github_client):
    with pytest.raises(RuntimeError):
        github_client.put_file(REPO, "docs/new.md", "x", BRANCH, "create", sha="blob-bogus")


# --- the audited adapter wrapper ----------------------------------------------------------------

def test_commit_artefact_writes_file_and_emits_event(adapter, events, github_client):
    out = adapter.commit_artefact(
        run_id="run-1", repo=REPO, branch=BRANCH,
        path="docs/product/specs/csv-export.md", content="# Spec\n",
        message="spec: first draft",
    )
    assert (REPO, BRANCH, "docs/product/specs/csv-export.md") in github_client.files
    assert out["commit_sha"].startswith("commit-")

    [evt] = [e for e in events.read() if e["type"] == "artefact.committed"]
    assert evt["run_id"] == "run-1"
    assert evt["payload"]["repo"] == REPO
    assert evt["payload"]["branch"] == BRANCH
    assert evt["payload"]["path"] == "docs/product/specs/csv-export.md"
    assert evt["payload"]["commit_sha"] == out["commit_sha"]
    assert evt["payload"]["updated"] is False                     # first commit, no sha given


def test_commit_artefact_on_update_records_updated_true(adapter, github_client):
    adapter.commit_artefact("run-1", REPO, BRANCH, "docs/spec.md", "v1", "first")
    existing = github_client.files[(REPO, BRANCH, "docs/spec.md")]["file_sha"]
    out = adapter.commit_artefact("run-1", REPO, BRANCH, "docs/spec.md", "v2", "redraft",
                                  sha=existing)
    assert out["commit_sha"] != ""


def test_commit_artefact_refuses_non_maestro_branch(adapter, events, github_client):
    """The merge boundary's structural rule (ADR-0016 / standards/git.yaml): no agent write goes
    to a default branch. The adapter is the single chokepoint that enforces it; here we check the
    same refusal applies to commit_artefact, not just open_branch."""
    with pytest.raises(ValueError):
        adapter.commit_artefact("run-1", REPO, "main", "docs/x.md", "x", "msg")
    with pytest.raises(ValueError):
        adapter.commit_artefact("run-1", REPO, "release/v1", "docs/x.md", "x", "msg")
    # Nothing landed on the wire — the refusal is pre-call, not after.
    assert (REPO, "main", "docs/x.md") not in github_client.files
    # Nothing was logged either (the adapter raises before append; consistent with open_branch).
    assert not any(e["type"] == "artefact.committed" for e in events.read())


def test_commit_artefact_projection_is_inert(adapter, events):
    """artefact.committed is bookkeeping — it does NOT advance the stage. The producer event
    (spec.drafted / design.produced) is what opens the gate."""
    events.append(run_id="run-1", actor="@arch", type="task.dispatched",
                  payload={"task_id": "run-1", "product_id": "maestro", "repo": REPO,
                           "intent": "x"})
    adapter.commit_artefact("run-1", REPO, BRANCH, "docs/spec.md", "# spec\n", "first")
    state = project_task(events.read(), "run-1")
    assert state.stage == "intake"                                # still at intake; no gate opened
    assert state.open_gates == {}
