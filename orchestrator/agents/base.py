"""The agent harness — one place every crew agent runs through.

A run goes:

1. **Validate inputs** — the caller hands us a dict keyed by the prompt's ``inputs:`` names; we
   reject anything missing (required) or unknown.
2. **Call the model** — through the single :class:`~model.client.ModelClient` (ADR-0002), with the
   prompt's body as the ``system`` message and a stable user message naming the run + inputs.
3. **Parse the artefact** — the response is a markdown file: ``--- yaml frontmatter ---`` then
   body. We use :func:`orchestrator.specindex.parse_frontmatter` so the round-trip matches what the
   SpecIndex will see when the workspace renders the committed file.
4. **Validate the artefact** — ``maestro.feature`` slug, ``maestro.kind`` enum, ``maestro.summary``
   shape (ADR-0021). Anything off is :class:`ArtefactRejected`; the harness does **not** silently
   correct — that would defeat the agent contract.
5. **Commit** — the audited :meth:`adapters.github.adapter.GitHubAdapter.commit_artefact` writes to
   a ``maestro/*`` branch (the only write path; default-branch refusal lives there).
6. **Emit the producer event** — ``spec.drafted`` for the spec agent, ``design.produced`` for the
   design agent. The event's type is **on the agent**, not the harness: the concrete agent declares
   what its successful first draft means in the gate-stage machine. Re-drafts emit
   ``agent_response.posted`` (ADR-0022); they ride the same machinery, with a different terminator.

Out of scope for this slice (#5):

* The **refinement loop** — consuming a ``feedback_bundle`` input and emitting
  ``agent_response.posted`` lands in #9 once the feedback-bundle reader exists.
* LangGraph stage-wiring — #7. The harness is pure I/O; it does not know about ``interrupt()``.
"""
from dataclasses import dataclass
from typing import Any, Optional

from adapters.github.adapter import GitHubAdapter
from model.client import ModelClient, ModelResult
from orchestrator.agents.loader import Prompt
from orchestrator.eventlog import EventLog
from orchestrator.specindex import KINDS, parse_frontmatter

# Plain-language summary constraints (ADR-0021). Enforced at the harness boundary so an artefact
# that violates the contract never lands on a branch — the agent must re-draft and try again.
MAX_SUMMARY_CHARS = 800
MAX_SUMMARY_WORDS = 120
_DISALLOWED_IN_SUMMARY = ("```", "](http", "AC-", "WHEN", "SHALL")


class InputRejected(ValueError):
    """The caller did not honour the prompt's ``inputs:`` contract — missing required or extras."""


class ArtefactRejected(ValueError):
    """The LLM's response is not a valid maestro artefact (frontmatter shape, summary, …).

    The harness raises rather than corrects: a malformed artefact means the agent's behaviour
    needs adjustment (in the prompt), not the harness's parser. ``reason`` is a stable code the
    test suite (and a future agent-quality dashboard) can group by.
    """

    def __init__(self, reason: str, detail: str = ""):
        self.reason = reason
        super().__init__(f"{reason}: {detail}" if detail else reason)


@dataclass(frozen=True)
class AgentRun:
    """One harness invocation's outcome — what was produced, where it landed, and how to find it."""
    run_id: str
    agent: str                           # spec | design | …
    artefact_kind: str                   # functional_spec | technical_design
    artefact_path: str                   # repo-relative
    artefact_content: str                # the full file the harness committed (frontmatter + body)
    frontmatter: dict                    # parsed YAML, validated
    commit: dict                         # {commit_sha, file_sha, repo, branch, path}
    event_seq: int                       # the producer event's seq in the log
    model_call: Any                      # the ModelClient's LLMCall record (for cost/latency drill-down)


class Agent:
    """The crew agent harness — concrete agents subclass and declare the four anchors below.

    Anchors:

    * ``producer_event_type`` — the event the harness emits on a successful first draft. The agent
      slice (spec → ``spec.drafted``, design → ``design.produced``) names this; the harness does
      not infer it from the prompt's ``agent`` field, because the stage machinery (projection.py)
      reads this exact string.
    * ``artefact_kind`` — the ``maestro.kind`` enum value the artefact MUST carry.
    * ``target_path`` — a callable ``(feature_slug, run_id) -> repo-relative path`` so the
      naming pattern stays in the agent slice, not the harness (M1 uses
      ``docs/product/specs/<feature>.md`` for spec; ``docs/architecture/<feature>-design.md`` for
      design — different agents, different naming, one harness).
    * ``branch_for_task`` — ``(task) -> branch name`` per ``standards/naming.yaml``. The same task
      goes through this on a re-draft, yielding the same branch.

    The harness does NOT know what a "spec" or a "design" is — it knows what a *maestro artefact*
    is. That is the layering the prompt files preserve.
    """

    producer_event_type: str = ""        # subclass MUST set
    artefact_kind: str = ""              # subclass MUST set (one of KINDS)

    def __init__(self, prompt: Prompt, model: ModelClient, events: EventLog,
                 github: GitHubAdapter, *, actor: Optional[str] = None,
                 max_output_tokens: Optional[int] = None):
        self._prompt = prompt
        self._model = model
        self._events = events
        self._github = github
        self._actor = actor or f"{prompt.agent}-agent"
        # Per-call output budget: explicit > prompt default > model default.
        self._max_output_tokens = max_output_tokens or prompt.max_output_tokens

    # --- the one public entry point ---------------------------------------------------------------

    def run(self, run_id: str, repo: str, branch: str, inputs: dict[str, Any],
            *, feature_slug: Optional[str] = None, target_path: Optional[str] = None,
            file_sha: Optional[str] = None,
            commit_message: Optional[str] = None) -> AgentRun:
        """Drive one agent invocation end-to-end.

        ``feature_slug`` and ``target_path`` are passed in by the concrete agent (it knows its
        naming pattern); making the harness compute them would re-encode each agent's path policy
        here. ``file_sha`` is the existing file's blob SHA on a re-draft (None on a first draft) —
        GitHub's optimistic-concurrency rule (see ``HttpGitHubClient.put_file``).
        """
        self._validate_subclass_anchors()
        self._validate_inputs(inputs)

        result = self._call_model(run_id, inputs)
        meta, body = parse_frontmatter(result.text)
        self._validate_artefact(meta, body, feature_slug=feature_slug)

        path = target_path or self._default_target_path(feature_slug=meta["maestro"]["feature"])
        commit = self._github.commit_artefact(
            run_id=run_id, repo=repo, branch=branch, path=path,
            content=result.text,
            message=commit_message or self._default_commit_message(meta),
            sha=file_sha,
        )
        event = self._emit_producer_event(run_id, repo, branch, path, meta, commit, result)

        return AgentRun(
            run_id=run_id, agent=self._prompt.agent, artefact_kind=self.artefact_kind,
            artefact_path=path, artefact_content=result.text, frontmatter=meta,
            commit={**commit, "repo": repo, "branch": branch, "path": path},
            event_seq=event["seq"], model_call=result.call,
        )

    # --- subclass hooks ---------------------------------------------------------------------------

    def _default_target_path(self, *, feature_slug: str) -> str:
        """Default repo-relative path for this agent's artefact. Overridden by concrete agents that
        prefer a non-standard layout (a product README can name its own); kept here for unit tests
        that don't construct a full agent subclass."""
        raise NotImplementedError(
            f"{type(self).__name__}: pass target_path= or override _default_target_path"
        )

    def _default_commit_message(self, meta: dict) -> str:
        feature = meta.get("maestro", {}).get("feature", "?")
        task = meta.get("maestro", {}).get("task")
        prefix = f"{task}: " if task else ""
        return f"{prefix}{self._prompt.agent}: {self.artefact_kind} for {feature}"

    # --- inputs ----------------------------------------------------------------------------------

    def _validate_inputs(self, inputs: dict[str, Any]) -> None:
        missing = self._prompt.required_inputs() - set(inputs)
        if missing:
            raise InputRejected(
                f"missing required inputs for agent {self._prompt.agent!r}: {sorted(missing)!r}"
            )
        unknown = set(inputs) - self._prompt.known_inputs()
        if unknown:
            raise InputRejected(
                f"unknown inputs for agent {self._prompt.agent!r}: {sorted(unknown)!r} "
                f"(declare them in standards/prompts/{self._prompt.agent}-agent.md)"
            )

    def _validate_subclass_anchors(self) -> None:
        if not self.producer_event_type:
            raise NotImplementedError(
                f"{type(self).__name__}: producer_event_type must be set (e.g. 'spec.drafted')"
            )
        if self.artefact_kind not in KINDS:
            raise NotImplementedError(
                f"{type(self).__name__}: artefact_kind must be one of {sorted(KINDS)!r}; "
                f"got {self.artefact_kind!r}"
            )

    # --- model call ------------------------------------------------------------------------------

    def _call_model(self, run_id: str, inputs: dict[str, Any]) -> ModelResult:
        """One call through the single ModelClient (ADR-0002). The prompt body is the system
        message; the user message names the run and frames the inputs deterministically so an
        audit can replay (matches the inputs the agent saw — ADR-0009)."""
        user_message = _format_user_message(self._prompt, inputs)
        kwargs = {}
        if self._max_output_tokens is not None:
            kwargs["max_tokens"] = self._max_output_tokens
        return self._model.complete(
            agent=self._prompt.agent, run_id=run_id, tier=self._prompt.model_tier,
            system=self._prompt.body, prompt=user_message, **kwargs,
        )

    # --- artefact validation ---------------------------------------------------------------------

    def _validate_artefact(self, meta: Optional[dict], body: str, *,
                           feature_slug: Optional[str]) -> None:
        """Check the maestro: frontmatter shape (ADR-0018) + the plain-language summary contract
        (ADR-0021). A failure here is the agent's bug, not the harness's; we surface the precise
        ``reason`` code so the test suite can pin behaviour."""
        if meta is None:
            raise ArtefactRejected("no_frontmatter",
                                   "the model response did not start with a `---` YAML block")
        m = meta.get("maestro")
        if not isinstance(m, dict):
            raise ArtefactRejected("no_maestro_block",
                                   "frontmatter is missing the `maestro:` block (ADR-0018)")
        kind = m.get("kind")
        if kind != self.artefact_kind:
            raise ArtefactRejected(
                "wrong_kind",
                f"maestro.kind must be {self.artefact_kind!r} for this agent; got {kind!r}",
            )
        feature = m.get("feature")
        if not isinstance(feature, str) or not _is_slug(feature):
            raise ArtefactRejected("bad_feature",
                                   f"maestro.feature must be a slug ([a-z0-9-]+); got {feature!r}")
        if feature_slug is not None and feature != feature_slug:
            raise ArtefactRejected(
                "wrong_feature",
                f"maestro.feature {feature!r} does not match the task's feature {feature_slug!r}",
            )
        self._validate_summary(m.get("summary"))
        if not body.strip():
            raise ArtefactRejected("empty_body", "the artefact body is empty")

    @staticmethod
    def _validate_summary(summary) -> None:
        if not isinstance(summary, str) or not summary.strip():
            raise ArtefactRejected("missing_summary",
                                   "maestro.summary is required (ADR-0021)")
        s = summary.strip()
        if len(s) > MAX_SUMMARY_CHARS:
            raise ArtefactRejected(
                "oversize_summary",
                f"maestro.summary must be ≤ {MAX_SUMMARY_CHARS} chars (ADR-0021); got {len(s)}",
            )
        if len(s.split()) > MAX_SUMMARY_WORDS:
            raise ArtefactRejected(
                "oversize_summary",
                f"maestro.summary must be ≤ {MAX_SUMMARY_WORDS} words (ADR-0021)",
            )
        for marker in _DISALLOWED_IN_SUMMARY:
            if marker in s:
                raise ArtefactRejected(
                    "jargon_in_summary",
                    f"maestro.summary must be plain language; remove {marker!r} (ADR-0021)",
                )

    # --- producer event -------------------------------------------------------------------------

    def _emit_producer_event(self, run_id: str, repo: str, branch: str, path: str,
                             meta: dict, commit: dict, result: ModelResult) -> dict:
        """Emit the agent's producer event (``spec.drafted`` / ``design.produced``) carrying the
        artefact ref. Projected by :mod:`orchestrator.projection` into the gate opener — so the
        workspace's open_gates entry appears immediately after this event lands."""
        m = meta.get("maestro", {})
        return self._events.append(
            run_id=run_id, actor=self._actor, type=self.producer_event_type,
            target=f"{repo}:{branch}:{path}",
            payload={
                "task_id": run_id,
                "agent": self._prompt.agent,
                "kind": self.artefact_kind,
                "feature": m.get("feature"),
                "ref": {"repo": repo, "branch": branch, "path": path,
                        "commit": commit.get("commit_sha")},
                "model": result.call.model,
            },
        )


# --- helpers ---------------------------------------------------------------------------------------


def _format_user_message(prompt: Prompt, inputs: dict[str, Any]) -> str:
    """Render the harness user message: one block per declared input, in prompt order.

    Deterministic and minimal — the prompt body (the system) carries the instructions; the user
    message just relays the inputs the harness validated. Order matches the prompt's ``inputs:``
    block so an audit replay reads the same."""
    import json
    lines: list[str] = [f"run_id: {inputs.get('task', {}).get('task_id') if isinstance(inputs.get('task'), dict) else ''}"]
    lines.append("")
    for io in prompt.inputs:
        if io.name not in inputs:
            continue
        value = inputs[io.name]
        rendered = value if isinstance(value, str) else json.dumps(value, default=str, indent=2)
        lines.append(f"## {io.name}")
        lines.append("")
        lines.append(rendered)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _is_slug(s: str) -> bool:
    """``[a-z0-9-]+`` with no leading/trailing hyphen — matches specindex._FEATURE_RE intent."""
    if not s or s[0] == "-" or s[-1] == "-":
        return False
    return all(c.isalnum() and c.islower() or c.isdigit() or c == "-" for c in s)
