"""Boot the control plane: wire the stores + egress + adapters, verify the external connections, and
**fail fast** if any required one is missing or invalid — never a partially-connected start (US-0001).

What boots here is the authoritative engine layer (event log, projection, ModelClient egress, the
event-gated github adapter). The LangGraph runtime that drives the delivery-loop stages layers on top
in a later slice; the event log it sits on is already the source of truth (ADR-0014).

Connection policy: ``boot()`` does presence checks by default (offline-safe); ``probe=True`` makes the
live calls that prove the connections — GitHub ``/user`` and a 1-token Claude call — so "missing OR
invalid" both fail startup, naming the connection.
"""
import os
from dataclasses import dataclass
from typing import Optional

from adapters.github.adapter import GitHubAdapter
from adapters.github.http_client import HttpGitHubClient
from model.audit import LLMAudit, LLMCall
from model.client import ModelClient
from orchestrator import db
from orchestrator.eventlog import EventLog
from orchestrator.register import Register, load_register
from orchestrator.routing import RoutingResolver


class StartupError(Exception):
    """A required connection is missing or invalid; maestro must not start (US-0001)."""


@dataclass
class ConnectionStatus:
    name: str
    ok: Optional[bool]      # True = verified/present, False = failed, None = skipped (not this round)
    detail: str = ""


@dataclass
class Engine:
    conn: object
    events: EventLog
    audit: LLMAudit
    model: ModelClient
    register: Register
    routing: RoutingResolver
    github: GitHubAdapter
    github_client: object          # the raw GitHubClient — also the read API's RepoContentReader
    connections: list[ConnectionStatus]


def boot(*, db_path: Optional[str] = None, probe: bool = False,
         allow_example_register: bool = False) -> Engine:
    conn = db.connect(db_path)
    events = EventLog(conn)
    audit = LLMAudit(conn)
    model = ModelClient(audit)
    register = load_register(allow_example=allow_example_register)
    routing = RoutingResolver.load()

    github_token = os.environ.get("GITHUB_TOKEN")
    github_client = HttpGitHubClient(github_token) if github_token else None

    checks = [
        _check_github(github_client, probe),
        _check_anthropic(model, probe),
        _check_slack(),
    ]
    failed = [c for c in checks if c.ok is False]
    if failed:
        names = ", ".join(f"{c.name} ({c.detail})" for c in failed)
        raise StartupError(f"cannot start — connection(s) failed: {names}")

    github = GitHubAdapter(events, register, routing, github_client) if github_client else None
    return Engine(conn=conn, events=events, audit=audit, model=model, register=register,
                  routing=routing, github=github, github_client=github_client, connections=checks)


def _check_github(client: Optional[HttpGitHubClient], probe: bool) -> ConnectionStatus:
    if client is None:
        return ConnectionStatus("github", False, "GITHUB_TOKEN is not set")
    if not probe:
        return ConnectionStatus("github", True, "token present (not probed)")
    try:
        login = client.verify()
        return ConnectionStatus("github", True, f"authenticated as {login}")
    except Exception as exc:
        return ConnectionStatus("github", False, f"token invalid: {exc}")


def _check_anthropic(model: ModelClient, probe: bool) -> ConnectionStatus:
    if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("MAESTRO_MODEL_BASE_URL"):
        return ConnectionStatus("anthropic", False, "ANTHROPIC_API_KEY is not set")
    if not probe:
        return ConnectionStatus("anthropic", True, "key present (not probed)")
    try:
        res = model.complete(agent="boot-probe", run_id="boot", tier="fast",
                             prompt="ping", max_tokens=1)
        return ConnectionStatus("anthropic", True,
                                f"live call ok ({res.call.model}, {res.call.latency_ms}ms)")
    except Exception as exc:
        return ConnectionStatus("anthropic", False, f"call failed: {exc}")


def _check_slack() -> ConnectionStatus:
    # The Slack adapter (architect surface) is the next slice; this round is the engine spine.
    # Declared so the fail-fast framework already knows about it — skipped, not silently absent.
    return ConnectionStatus("slack", None, "adapter not built this round (engine-spine slice)")
