"""Shared fixtures + fakes for the engine-spine tests (contract layer: no network, no real LLM)."""
import pytest

from adapters.github.adapter import GitHubAdapter
from model.audit import LLMAudit
from model.client import ModelClient
from orchestrator import db
from orchestrator.eventlog import EventLog
from orchestrator.idempotency import IdempotencyStore
from orchestrator.register import Participant, Product, Register
from orchestrator.routing import RoutingResolver
from orchestrator.writeapi import WriteAPI


@pytest.fixture
def conn():
    """A fresh in-memory store; EventLog and LLMAudit share this one connection."""
    c = db.connect(":memory:")
    yield c
    c.close()


@pytest.fixture
def events(conn):
    return EventLog(conn)


@pytest.fixture
def audit(conn):
    return LLMAudit(conn)


@pytest.fixture
def register():
    """A technical product 'maestro' owning repo acme/widget. @arch is the architect; @dev is a
    functional_reviewer (used to prove a non-role-holder's approval is refused)."""
    maestro = Product(
        id="maestro", name="maestro", product_type="technical", visibility="public",
        repos=("acme/widget",),
        participants=(
            Participant(handle="@arch", role="architect", slack_user_id="U_ARCH"),
            Participant(handle="@dev", role="functional_reviewer", telegram_user_id="555"),
        ),
    )
    return Register(products={"maestro": maestro})


@pytest.fixture
def routing():
    """The real routing matrix (config/reviewers.yaml) — tests run from the repo root."""
    return RoutingResolver.load()


@pytest.fixture
def idempotency(conn):
    """24h-TTL idempotency store sharing the in-memory event-log conn."""
    return IdempotencyStore(conn)


@pytest.fixture
def write_api(register, events, routing, idempotency):
    """The workspace write API — deterministic run/comment ids (run-1, run-2, …; cmt-1, cmt-2, …)
    for replay-correct tests."""
    run_counter = {"n": 0}
    cmt_counter = {"n": 0}
    def run_id():
        run_counter["n"] += 1
        return f"run-{run_counter['n']}"
    def cmt_id():
        cmt_counter["n"] += 1
        return f"cmt-{cmt_counter['n']}"
    return WriteAPI(register, events, routing, idempotency,
                    id_factory=run_id, comment_id_factory=cmt_id)


# --- fake GitHub client ------------------------------------------------------------------------

class FakeGitHubClient:
    def __init__(self):
        self.branches = []
        self.prs = []
        self.merges = []
        # files: ``{(repo, branch, path) -> {content, file_sha}}`` so commit_artefact tests can
        # assert "the file landed" without faking the whole GitHub API surface.
        self.files: dict[tuple[str, str, str], dict] = {}
        self.put_file_calls: list[dict] = []
        # One entry per commit_files call (US-0011 builder) — ``{repo, branch, message, paths}`` in
        # order, so a test can assert the one-commit-per-task message sequence.
        self.commits: list[dict] = []

    def create_branch(self, repo, branch, from_ref):
        self.branches.append((repo, branch, from_ref))
        return {"ref": f"refs/heads/{branch}"}

    def open_pull_request(self, repo, head, base, title, body, draft=False):
        number = len(self.prs) + 100
        self.prs.append({"repo": repo, "head": head, "base": base, "title": title,
                         "body": body, "draft": draft, "number": number})
        return {"number": number, "url": f"https://github.com/{repo}/pull/{number}",
                "draft": draft}

    def merge_pull_request(self, repo, number, method):
        self.merges.append((repo, number, method))
        return {"merged": True, "sha": f"deadbeef{number}"}

    def put_file(self, repo, path, content, branch, message, sha=None):
        """Mimic GitHub's PUT /contents — sha REQUIRED on update, MUST be absent on create."""
        existing = self.files.get((repo, branch, path))
        if existing and sha is None:
            raise RuntimeError(f"PUT /contents on existing file {path!r} without sha (GitHub 422)")
        if existing and existing["file_sha"] != sha:
            raise RuntimeError(f"sha mismatch on {path!r} (GitHub 409)")
        if not existing and sha is not None:
            raise RuntimeError(f"sha given for new file {path!r} (GitHub 422)")
        file_sha = f"blob-{len(self.put_file_calls) + 1:08x}"
        commit_sha = f"commit-{len(self.put_file_calls) + 1:08x}"
        self.files[(repo, branch, path)] = {"content": content, "file_sha": file_sha}
        self.put_file_calls.append({"repo": repo, "branch": branch, "path": path,
                                    "message": message, "sha": sha})
        return {"commit_sha": commit_sha, "file_sha": file_sha, "path": path}

    def commit_files(self, repo, branch, files, message):
        """Mimic the Git Data API multi-file commit — every file lands in ONE commit. Stores each
        file (so a later get_contents / put_file sees it) and records the commit in order."""
        seq = len(self.commits) + 1
        commit_sha = f"commit-multi-{seq:08x}"
        for f in files:
            file_sha = f"blob-multi-{seq:08x}-{f['path']}"
            self.files[(repo, branch, f["path"])] = {"content": f["content"], "file_sha": file_sha}
        self.commits.append({"repo": repo, "branch": branch, "message": message,
                             "paths": [f["path"] for f in files], "commit_sha": commit_sha})
        return {"commit_sha": commit_sha}

    def get_contents(self, repo, path, ref):
        """Read a committed file back (the reader role the builder uses to fetch design/spec). ``ref``
        is a branch in these tests; we match on (repo, ref, path) and fall back to any branch holding
        the path so a commit-sha ref still resolves offline."""
        hit = self.files.get((repo, ref, path))
        if hit is None:
            for (r, _b, p), v in self.files.items():
                if r == repo and p == path:
                    hit = v
                    break
        if hit is None:
            raise FileNotFoundError(f"{repo}@{ref}:{path}")
        return {"content": hit["content"], "sha": hit["file_sha"], "path": path}


@pytest.fixture
def github_client():
    return FakeGitHubClient()


# --- fake repo content reader (the read API's RepoContentReader) -------------------------------

def _blob_sha(text: str) -> str:
    """A content-addressed blob SHA — changes iff the content changes (like git)."""
    return f"blob-{abs(hash(text)) % 10**9}"


class FakeContentReader:
    """In-memory repo content for read-API tests — files keyed by ``(repo, branch) -> {path: text}``.

    Mirrors the github adapter's read surface offline. ``head_sha``/``list_tree_entries`` raise for an
    unknown branch (a real ref-miss); ``get_contents`` raises for an unknown path. ``reads`` counts
    content fetches, so tests can assert the index cache avoids re-fetching.
    """

    def __init__(self):
        self.files: dict[tuple[str, str], dict[str, str]] = {}
        self.reads = 0

    def put(self, repo, branch, path, text):
        self.files.setdefault((repo, branch), {})[path] = text
        return self

    def head_sha(self, repo, ref):
        files = self.files.get((repo, ref))
        if files is None:
            raise FileNotFoundError(f"no such ref {repo}@{ref}")
        return f"head-{abs(hash(tuple(sorted(files.items())))) % 10**9}"

    def list_tree_entries(self, repo, ref, path_prefix=""):
        if (repo, ref) not in self.files:
            raise FileNotFoundError(f"no such ref {repo}@{ref}")
        return [(p, _blob_sha(t)) for p, t in self.files[(repo, ref)].items() if p.startswith(path_prefix)]

    def get_contents(self, repo, path, ref):
        try:
            text = self.files[(repo, ref)][path]
        except KeyError:
            raise FileNotFoundError(f"{repo}@{ref}:{path}")
        self.reads += 1
        return {"content": text, "sha": _blob_sha(text), "path": path}


@pytest.fixture
def content_reader():
    return FakeContentReader()


@pytest.fixture
def github(events, register, routing, github_client):
    return GitHubAdapter(events, register, routing, github_client)


# --- fake model provider -----------------------------------------------------------------------

class _Usage:
    def __init__(self, **kw):
        self.input_tokens = kw.get("input_tokens", 0)
        self.output_tokens = kw.get("output_tokens", 0)
        self.cache_read_input_tokens = kw.get("cache_read", 0)
        self.cache_creation_input_tokens = kw.get("cache_write", 0)


class _Block:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class _Resp:
    def __init__(self, text="ok", stop_reason="end_turn", **usage):
        self.content = [_Block(text)]
        self.usage = _Usage(**usage)
        self.stop_reason = stop_reason


class FakeProvider:
    def __init__(self, resp=None, error=None):
        self._resp = resp or _Resp(input_tokens=10, output_tokens=5)
        self._error = error
        self.calls = []
        self.messages = self

    def create(self, **kw):
        self.calls.append(kw)
        if self._error:
            raise self._error
        return self._resp


@pytest.fixture
def model_factory():
    """Returns (model_client, provider) given an audit sink — provider captures the forwarded kwargs."""
    def make(audit: LLMAudit, resp=None, error=None):
        provider = FakeProvider(resp=resp, error=error)
        return ModelClient(audit, client_factory=lambda: provider), provider
    return make
