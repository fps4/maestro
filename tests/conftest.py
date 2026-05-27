"""Shared fixtures + fakes for the engine-spine tests (contract layer: no network, no real LLM)."""
import pytest

from adapters.github.adapter import GitHubAdapter
from model.audit import LLMAudit
from model.client import ModelClient
from orchestrator import db
from orchestrator.eventlog import EventLog
from orchestrator.register import Participant, Product, Register
from orchestrator.routing import RoutingResolver


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


# --- fake GitHub client ------------------------------------------------------------------------

class FakeGitHubClient:
    def __init__(self):
        self.branches = []
        self.prs = []
        self.merges = []

    def create_branch(self, repo, branch, from_ref):
        self.branches.append((repo, branch, from_ref))
        return {"ref": f"refs/heads/{branch}"}

    def open_pull_request(self, repo, head, base, title, body):
        number = len(self.prs) + 100
        self.prs.append((repo, head, base))
        return {"number": number, "url": f"https://github.com/{repo}/pull/{number}"}

    def merge_pull_request(self, repo, number, method):
        self.merges.append((repo, number, method))
        return {"merged": True, "sha": f"deadbeef{number}"}


@pytest.fixture
def github_client():
    return FakeGitHubClient()


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
