"""Multi-file atomic commit (US-0011 builder) — the Git Data API client primitive + the audited
:meth:`GitHubAdapter.commit_change` wrapper.

The ``maestro/*``-only refusal lives in the adapter, NOT the http client — same shape as
``commit_artefact`` / ``open_branch``. The client test pins the low-level git plumbing call sequence
without a socket by stubbing the transport.
"""
import pytest

from adapters.github.adapter import GitHubAdapter
from adapters.github.http_client import HttpGitHubClient

REPO = "acme/widget"
BRANCH = "maestro/us-0042-csv-export"


@pytest.fixture
def adapter(events, register, routing, github_client):
    return GitHubAdapter(events, register, routing, github_client)


# --- the audited adapter wrapper ----------------------------------------------------------------

def test_commit_change_writes_files_and_emits_event(adapter, events, github_client):
    out = adapter.commit_change(
        run_id="run-1", repo=REPO, branch=BRANCH,
        files=[{"path": "reports/csv.py", "content": "# a\n"},
               {"path": "reports/auth.py", "content": "# b\n"}],
        message="task-1: Add /reports/csv endpoint", task=1, requirements=["AC-1"],
    )
    assert out["commit_sha"].startswith("commit-multi-")
    # Both files landed in the one commit.
    assert github_client.files[(REPO, BRANCH, "reports/csv.py")]["content"] == "# a\n"
    assert github_client.files[(REPO, BRANCH, "reports/auth.py")]["content"] == "# b\n"
    assert len(github_client.commits) == 1

    [evt] = [e for e in events.read() if e["type"] == "commit.created"]
    assert evt["run_id"] == "run-1"
    assert evt["payload"]["task"] == 1
    assert evt["payload"]["requirements"] == ["AC-1"]
    assert evt["payload"]["paths"] == ["reports/csv.py", "reports/auth.py"]
    assert evt["payload"]["commit_sha"] == out["commit_sha"]
    assert evt["payload"]["message"] == "task-1: Add /reports/csv endpoint"


def test_commit_change_refuses_non_maestro_branch(adapter, events, github_client):
    """The ADR-0016 structural rule — no agent write reaches a default branch. The same refusal
    commit_artefact enforces applies to the builder's multi-file commit."""
    with pytest.raises(ValueError):
        adapter.commit_change("run-1", REPO, "main",
                              [{"path": "x.py", "content": "x"}], "task-1: x")
    assert (REPO, "main", "x.py") not in github_client.files
    assert not any(e["type"] == "commit.created" for e in events.read())   # refusal is pre-call


# --- the Git Data API client primitive ----------------------------------------------------------

class _StubTransport:
    """Records (method, path, body) and returns canned git-data responses so commit_files can be
    exercised offline — the same plumbing GitHub walks: ref → base commit → tree → commit → ref."""

    def __init__(self):
        self.calls = []

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "GET" and "/git/ref/heads/" in path:
            return {"object": {"sha": "basecommit"}}
        if method == "GET" and "/git/commits/" in path:
            return {"tree": {"sha": "basetree"}}
        if method == "POST" and path.endswith("/git/trees"):
            return {"sha": "newtree"}
        if method == "POST" and path.endswith("/git/commits"):
            return {"sha": "newcommit"}
        if method == "PATCH" and "/git/refs/heads/" in path:
            return {"object": {"sha": "newcommit"}}
        raise AssertionError(f"unexpected call {method} {path}")


def test_http_commit_files_walks_the_git_data_api():
    client = HttpGitHubClient(token="t")
    stub = _StubTransport()
    client._request = stub

    out = client.commit_files(
        REPO, BRANCH,
        [{"path": "reports/csv.py", "content": "# a\n"},
         {"path": "reports/auth.py", "content": "# b\n"}],
        "task-1: Add /reports/csv endpoint",
    )
    assert out == {"commit_sha": "newcommit"}

    methods = [(m, p.split(REPO)[-1]) for m, p, _ in stub.calls]
    assert methods == [
        ("GET", "/git/ref/heads/maestro/us-0042-csv-export"),
        ("GET", "/git/commits/basecommit"),
        ("POST", "/git/trees"),
        ("POST", "/git/commits"),
        ("PATCH", "/git/refs/heads/maestro/us-0042-csv-export"),
    ]
    # The tree carries both files on top of the base tree; the commit parents the base.
    tree_body = next(b for m, p, b in stub.calls if p.endswith("/git/trees"))
    assert tree_body["base_tree"] == "basetree"
    assert [e["path"] for e in tree_body["tree"]] == ["reports/csv.py", "reports/auth.py"]
    assert all(e["mode"] == "100644" and e["type"] == "blob" for e in tree_body["tree"])
    commit_body = next(b for m, p, b in stub.calls if p.endswith("/git/commits"))
    assert commit_body["parents"] == ["basecommit"]
    assert commit_body["tree"] == "newtree"


def test_http_open_pull_request_sends_draft():
    client = HttpGitHubClient(token="t")
    calls = []

    def stub(method, path, body=None):
        calls.append((method, path, body))
        return {"number": 7, "html_url": "https://github.com/acme/widget/pull/7", "draft": True}

    client._request = stub
    out = client.open_pull_request(REPO, BRANCH, "main", "title", "body", draft=True)
    assert out == {"number": 7, "url": "https://github.com/acme/widget/pull/7", "draft": True}
    assert calls[0][2]["draft"] is True
