"""The **spec agent** (US-0010) — intent → functional spec, posted to the functional gate.

A ~30-line subclass of :class:`orchestrator.agents.base.Agent`: the harness owns input validation,
the ModelClient call, frontmatter validation, the audited commit, and the producer event. This
file pins only the **three anchors** the harness leaves to the concrete agent:

* ``producer_event_type = "spec.drafted"`` — the projection ([`_GATE_OPENER`](../projection.py))
  reads this exact string to open the functional gate.
* ``artefact_kind = "functional_spec"`` — the ``maestro.kind`` the harness will refuse anything
  else for.
* ``_default_target_path`` — ``docs/product/specs/<feature>.md`` (the maestro convention; products
  whose README pins a different layout can override at call-time).

Alongside the class, :func:`run_spec_for_run` wires the dispatch → spec flow without LangGraph
(M1 #7): read the task.dispatched event, ensure the ``maestro/*`` branch exists (idempotent —
the event log tells us if it was already created), build the inputs the prompt expects, and
:meth:`Agent.run`. The LangGraph stage-wiring slice will call **this same function** inside its
spec stage node, so the orchestrator and a CLI / test see one entry point.
"""
import pathlib
from typing import Optional

from adapters.github.adapter import GitHubAdapter
from model.client import ModelClient
from orchestrator.agents.base import Agent, AgentRun
from orchestrator.agents.loader import Prompt, load_prompt
from orchestrator.eventlog import EventLog
from orchestrator.register import Register

DEFAULT_PROMPT_PATH = "standards/prompts/spec-agent.md"
DEFAULT_BASE_BRANCH = "main"

# Where in the repo the spec lands. The product's README may name a different path; callers can
# override via ``target_path=`` on :meth:`Agent.run`. The slug comes from the LLM's
# ``maestro.feature``, validated by the harness.
TARGET_PATH_FMT = "docs/product/specs/{feature}.md"


class SpecAgent(Agent):
    """The concrete spec agent. All behaviour beyond the three anchors is inherited from
    :class:`Agent`."""

    producer_event_type = "spec.drafted"
    artefact_kind = "functional_spec"

    def _default_target_path(self, *, feature_slug: str) -> str:
        return TARGET_PATH_FMT.format(feature=feature_slug)


def run_spec_for_run(run_id: str, *, events: EventLog, register: Register,
                     model: ModelClient, github: GitHubAdapter,
                     prompt_path: str = DEFAULT_PROMPT_PATH,
                     base_branch: str = DEFAULT_BASE_BRANCH) -> AgentRun:
    """Drive the spec agent for a dispatched task — the dispatch → spec wiring.

    Reads the ``task.dispatched`` event the workspace write API emitted (M1 #1), ensures the
    ``maestro/*`` branch exists for this task (creating it if not — idempotent against a previous
    partial run, because :class:`adapters.github.adapter.GitHubAdapter` emits ``branch.created``
    and we re-read that), constructs the inputs the prompt declares, and runs the agent.

    Branch shape per ``standards/naming.yaml``: M1 dispatched tasks are not US-bound (the
    architect dispatches free-form intent), so we use the unbound form
    ``maestro/task-<run_id_short>``. The bound form (``maestro/us-NNNN-<slug>``) lands when
    intake binds a task to a US id — a later slice.
    """
    dispatched = _find_dispatched(events, run_id)
    payload = dispatched["payload"]
    product_id = payload["product_id"]
    repo = payload["repo"]
    intent = payload["intent"]

    product = register.product(product_id)
    if product is None:
        # The dispatch event landed but the register changed since; M1 dogfood doesn't expect this,
        # but the failure must be loud (don't pick a different product).
        raise ValueError(f"product {product_id!r} not in register (task {run_id!r})")

    branch = _branch_for_task(run_id)
    _ensure_branch(github, events, run_id, repo, branch, base_branch)

    prompt = _load_prompt(prompt_path)
    agent = SpecAgent(prompt, model, events, github)

    # Re-draft detection: when LangGraph routes ``request_changes`` back to spec_node, this helper
    # runs a second time. The discriminator is **an unconsumed ``feedback_bundle.created`` event**
    # — the one the workspace write API emitted on the most recent ``request_changes`` decision,
    # not yet closed by an ``agent_response.posted``. If present, the harness takes the re-draft
    # path (parse trailing fenced block, emit ``agent_response.posted``, re-open the gate).
    feedback_bundle = _active_feedback_bundle(events, run_id, gate_type="functional")
    target_path = None
    file_sha = None
    if feedback_bundle is not None:
        feature_slug = _feature_slug_for_run(events, run_id)
        if feature_slug:
            target_path = TARGET_PATH_FMT.format(feature=feature_slug)
            file_sha = _existing_file_sha(events, run_id, repo, branch, target_path)

    inputs: dict = {
        "task": {"task_id": run_id, "product_id": product_id, "repo": repo,
                 "stage": "intake"},
        "product": {"id": product.id, "name": product.name,
                    "product_type": product.product_type, "repos": list(product.repos)},
        "intent": intent,
    }
    if feedback_bundle is not None:
        inputs["feedback_bundle"] = feedback_bundle

    return agent.run(run_id=run_id, repo=repo, branch=branch, inputs=inputs,
                     target_path=target_path, file_sha=file_sha)


# --- helpers ---------------------------------------------------------------------------------------


def _active_feedback_bundle(events: EventLog, run_id: str, *,
                            gate_type: str) -> Optional[dict]:
    """Return the most recent ``feedback_bundle.created`` event payload for this gate type that
    has **not** yet been closed by a matching ``agent_response.posted`` — that's the bundle the
    re-drafting agent must address now.

    For M1 dogfood the active set is usually 0 or 1; the lookup is linear over the task's events
    (one task fits comfortably in memory), no separate index needed."""
    raw = events.read(run_id)
    closed_ids = {e["payload"].get("bundle_id") for e in raw
                  if e["type"] == "agent_response.posted"}
    for e in reversed(raw):
        if e["type"] != "feedback_bundle.created":
            continue
        p = e["payload"]
        gate = (p.get("gate") or {}).get("type")
        if gate != gate_type:
            continue
        if p.get("bundle_id") in closed_ids:
            continue
        return p
    return None


def _existing_file_sha(events: EventLog, run_id: str, repo: str, branch: str,
                       path: str) -> Optional[str]:
    """Find the file_sha of the most recent ``artefact.committed`` event for ``(repo, branch,
    path)`` — what we pass to GitHub on a re-draft so the PUT is an update (sha-required) rather
    than a create (sha-forbidden)."""
    for e in reversed(events.read(run_id)):
        if e["type"] != "artefact.committed":
            continue
        p = e["payload"]
        if (p.get("repo") == repo and p.get("branch") == branch and p.get("path") == path):
            return p.get("file_sha")
    return None


def _feature_slug_for_run(events: EventLog, run_id: str) -> Optional[str]:
    """The feature slug from the most recent ``spec.drafted`` event for this run — on a re-draft
    we already committed at least one spec, and the slug stays stable across the cycle."""
    for e in reversed(events.read(run_id)):
        if e["type"] == "spec.drafted":
            return (e.get("payload") or {}).get("feature")
    return None


def _find_dispatched(events: EventLog, run_id: str) -> dict:
    """Read this task's ``task.dispatched`` event. Latest one wins (a re-dispatch is rare but the
    most recent intent is the right one to design from)."""
    raw = events.read(run_id)
    candidates = [e for e in raw if e["type"] == "task.dispatched"]
    if not candidates:
        raise ValueError(
            f"no task.dispatched event for run {run_id!r} — was the task dispatched through the "
            f"workspace write API?"
        )
    return candidates[-1]


def _branch_for_task(run_id: str) -> str:
    """Unbound-task naming per ``standards/naming.yaml`` — ``maestro/task-<run_id_short>``.

    ``run_id`` has shape ``run-<8 hex>`` (workspace-write-api / writeapi._default_run_id). We strip
    the ``run-`` prefix so the branch reads ``maestro/task-9c2e3f`` rather than
    ``maestro/task-run-9c2e3f``. A run_id without that prefix is taken whole — defensive against
    a future id shape change.
    """
    short = run_id.removeprefix("run-")
    return f"maestro/task-{short}"


def _ensure_branch(github: GitHubAdapter, events: EventLog, run_id: str, repo: str,
                   branch: str, base_branch: str) -> None:
    """Idempotent branch-open. If a ``branch.created`` event for this branch is already in the
    log for this run, skip the API call — a previous partial run made the branch, and the GitHub
    API would 422 on a re-create."""
    for e in events.read(run_id):
        if (e["type"] == "branch.created"
                and (e.get("payload") or {}).get("repo") == repo
                and (e.get("payload") or {}).get("branch") == branch):
            return
    github.open_branch(run_id, repo, branch, from_ref=base_branch)


def _load_prompt(prompt_path: str) -> Prompt:
    """Resolve ``prompt_path`` against the repo root if it's relative, so callers don't have to
    care about cwd. Absolute paths pass through unchanged."""
    p = pathlib.Path(prompt_path)
    if not p.is_absolute():
        # Two anchors: cwd (the usual case in dev / tests) and the package root (so a deployed
        # copy that ships standards/ next to orchestrator/ still finds it).
        candidates = [p, pathlib.Path(__file__).resolve().parents[2] / prompt_path]
        for c in candidates:
            if c.exists():
                return load_prompt(c)
    return load_prompt(p)


def get_default_prompt(prompt_path: Optional[str] = None) -> Prompt:
    """Public accessor for the loaded prompt — handy for the boot path / a CLI that wants to log
    which prompt was loaded before running."""
    return _load_prompt(prompt_path or DEFAULT_PROMPT_PATH)
