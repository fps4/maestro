"""The **design agent** (US-0013) — approved functional spec → technical design, posted to the
design gate.

Mirror of :mod:`orchestrator.agents.spec`: a ~30-line subclass of
:class:`orchestrator.agents.base.Agent` plus a synchronous helper the LangGraph runtime's
``design_node`` calls. The harness from #5 still owns everything reusable; this file pins only the
three anchors and the input-derivation shape that makes the design agent different from the spec
agent:

* ``producer_event_type = "design.produced"`` — the projection's ``_GATE_OPENER`` reads this
  exact string to open the **technical_design** gate.
* ``artefact_kind = "technical_design"`` — the harness refuses anything else.
* ``_default_target_path`` → ``docs/architecture/<feature>-design.md`` (the maestro convention).

The dispatcher-style helper :func:`run_design_for_run` reads the latest ``spec.drafted`` event
for the task (which is the *approved* spec, since LangGraph only routes to the design node after
the functional gate approves), passes its ref as the prompt's ``spec_ref`` input, and runs the
agent on the **same branch** the spec lives on (per the design-agent prompt).

What this slice does NOT ship (deferred):

* **Multi-file commits for proposed ADRs.** The design prompt declares ``proposed_adrs?`` as an
  output and instructs the agent to add ADR files "in the same commit". The harness today
  commits one file. The agent may still mention proposed ADRs in the design body; a follow-up
  slice (alongside #9's refinement-loop trailing-fence convention) lands the multi-file commit
  path.
* **The refinement loop** — #9. ``feedback_bundle?`` is declared in the prompt's inputs and the
  helper will read the latest ``feedback_bundle.created`` event when the design gate's
  ``request_changes`` loops back here; the agent_response.posted emission rides under the same
  slice.
"""
import pathlib
from typing import Any, Optional

from adapters.github.adapter import GitHubAdapter
from model.client import ModelClient
from orchestrator.agents.base import Agent, AgentRun
from orchestrator.agents.loader import Prompt, load_prompt
from orchestrator.eventlog import EventLog
from orchestrator.register import Register

DEFAULT_PROMPT_PATH = "standards/prompts/design-agent.md"

# Where in the repo the design lands. Products whose README pins a different layout can override
# via ``target_path=`` on :meth:`Agent.run`. The slug comes from the **spec's** ``maestro.feature``
# (the spec.drafted event payload carries it) — the design must use the same feature slug as the
# spec it designs from; the harness validates that via ``feature_slug=`` to ``Agent.run``.
TARGET_PATH_FMT = "docs/architecture/{feature}-design.md"


class DesignAgent(Agent):
    """The concrete design agent. All behaviour beyond the three anchors is inherited from
    :class:`Agent`."""

    producer_event_type = "design.produced"
    artefact_kind = "technical_design"

    def _default_target_path(self, *, feature_slug: str) -> str:
        return TARGET_PATH_FMT.format(feature=feature_slug)


def run_design_for_run(run_id: str, *, events: EventLog, register: Register,
                       model: ModelClient, github: GitHubAdapter,
                       prompt_path: str = DEFAULT_PROMPT_PATH) -> AgentRun:
    """Drive the design agent for a task whose functional gate has just been approved.

    The graph's ``design_node`` calls this. It does not need to find or open a branch — the spec
    agent already created one (and committed the spec to it). The design lands on the **same
    branch**, same task; the design's ``maestro.feature`` MUST match the spec's
    ``maestro.feature``, which we pin via ``feature_slug=`` so the harness rejects a drifted slug.

    The ``spec_ref`` the prompt receives is the latest ``spec.drafted`` event's ref — which is
    the *approved* spec at this point (the runtime only routes here after
    ``gate.decided(approve, functional)``). When the spec gets re-drafted on a request_changes
    cycle and re-approved, the latest spec.drafted event's ref is what the design agent reads.
    """
    spec_event = _latest_spec_drafted(events, run_id)
    spec_payload = spec_event["payload"]
    spec_ref = spec_payload["ref"]
    feature_slug = spec_payload.get("feature")
    if not feature_slug:
        raise ValueError(
            f"spec.drafted event for run {run_id!r} carries no `feature` — the spec agent "
            f"should emit it (orchestrator/agents/base._emit_producer_event)"
        )

    # Look up the product from the task.dispatched event (single source of truth for product_id;
    # the spec.drafted payload carries it too but going through dispatched mirrors how the spec
    # helper does it, so the two helpers stay symmetric).
    dispatched = _find_dispatched(events, run_id)
    product_id = dispatched["payload"]["product_id"]
    intent = dispatched["payload"]["intent"]
    repo = spec_ref["repo"]
    branch = spec_ref["branch"]

    product = register.product(product_id)
    if product is None:
        raise ValueError(f"product {product_id!r} not in register (task {run_id!r})")

    prompt = _load_prompt(prompt_path)
    agent = DesignAgent(prompt, model, events, github)

    # Re-draft detection — symmetric with the spec helper. On the design gate's request_changes
    # the workspace emits ``feedback_bundle.created`` (gate.type = "technical_design"); the next
    # design_node invocation reads it and the harness takes the re-draft path.
    feedback_bundle = _active_feedback_bundle(events, run_id, gate_type="technical_design")
    target_path = TARGET_PATH_FMT.format(feature=feature_slug)
    file_sha = (_existing_file_sha(events, run_id, repo, branch, target_path)
                if feedback_bundle is not None else None)

    inputs: dict = {
        "task": {"task_id": run_id, "product_id": product_id, "repo": repo,
                 "stage": "design"},
        "product": {"id": product.id, "name": product.name,
                    "product_type": product.product_type, "repos": list(product.repos)},
        "spec_ref": {"repo": spec_ref["repo"], "branch": spec_ref["branch"],
                     "path": spec_ref["path"], "commit": spec_ref.get("commit"),
                     "feature": feature_slug, "intent": intent},
    }
    if feedback_bundle is not None:
        inputs["feedback_bundle"] = feedback_bundle

    return agent.run(run_id=run_id, repo=repo, branch=branch, inputs=inputs,
                     feature_slug=feature_slug, target_path=target_path, file_sha=file_sha)


# --- helpers ---------------------------------------------------------------------------------------


def _active_feedback_bundle(events: EventLog, run_id: str, *,
                            gate_type: str) -> Optional[dict]:
    """Symmetric with ``orchestrator.agents.spec._active_feedback_bundle`` — latest unclosed
    ``feedback_bundle.created`` for this gate type. Duplicated rather than imported because the
    spec helper's symbol is private; one-line copy is cheaper than a cross-agent import."""
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
    """The file_sha of the most recent ``artefact.committed`` event for ``(repo, branch, path)``
    — for the re-draft's PUT-with-sha (GitHub's optimistic-concurrency rule)."""
    for e in reversed(events.read(run_id)):
        if e["type"] != "artefact.committed":
            continue
        p = e["payload"]
        if (p.get("repo") == repo and p.get("branch") == branch and p.get("path") == path):
            return p.get("file_sha")
    return None


def _latest_spec_drafted(events: EventLog, run_id: str) -> dict:
    """Return the most recent ``spec.drafted`` event for the task. The latest one is the approved
    one at the design stage (LangGraph routes here only after the functional gate approves), and
    on a re-draft after request_changes the new spec.drafted supersedes the prior."""
    raw = events.read(run_id)
    candidates = [e for e in raw if e["type"] == "spec.drafted"]
    if not candidates:
        raise ValueError(
            f"no spec.drafted event for run {run_id!r} — was the spec agent run "
            f"(orchestrator.agents.spec.run_spec_for_run) before the design helper?"
        )
    return candidates[-1]


def _find_dispatched(events: EventLog, run_id: str) -> dict:
    """Symmetric with :func:`orchestrator.agents.spec._find_dispatched`. The design helper needs
    ``product_id`` (for the register lookup) and ``intent`` (so the design prompt can reference
    the original ask alongside the spec). The latest dispatch wins on the rare re-dispatch."""
    raw = events.read(run_id)
    candidates = [e for e in raw if e["type"] == "task.dispatched"]
    if not candidates:
        raise ValueError(
            f"no task.dispatched event for run {run_id!r} — design ran without a dispatch?"
        )
    return candidates[-1]


def _load_prompt(prompt_path: str) -> Prompt:
    """Resolve ``prompt_path`` against the repo root if relative, with a package-root fallback
    so a deployed copy works regardless of cwd — same logic as the spec agent's loader.

    Kept symmetric (rather than imported from :mod:`orchestrator.agents.spec`) because the spec
    helper's private symbol is not part of any package surface, and a one-line copy is cheaper
    than coupling two agent modules through a shared private."""
    p = pathlib.Path(prompt_path)
    if not p.is_absolute():
        candidates = [p, pathlib.Path(__file__).resolve().parents[2] / prompt_path]
        for c in candidates:
            if c.exists():
                return load_prompt(c)
    return load_prompt(p)


def get_default_prompt(prompt_path: Optional[str] = None) -> Prompt:
    """Public accessor for the loaded design prompt — handy for the boot path / a CLI that wants
    to log which prompt was loaded before running."""
    return _load_prompt(prompt_path or DEFAULT_PROMPT_PATH)
