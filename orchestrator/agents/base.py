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

# ADR-0022 per-anchor-reply envelope.
MAX_NOTE_CHARS = 240
_ACTIONS = {"addressed", "deferred", "rejected"}


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

        Two paths, discriminated by the presence of ``feedback_bundle`` in ``inputs``:

        * **first draft** (no bundle) — the LLM emits the markdown artefact; the harness commits
          it and emits the producer event (``spec.drafted`` / ``design.produced``) that opens the
          gate.
        * **re-draft** (bundle present) — the LLM emits the artefact **plus a trailing fenced
          block** named ``json maestro-response`` carrying ``{bundle_id, summary_of_changes,
          addresses[]}`` (the spec / design prompts pin the format). The harness parses + strips
          that block from the committed file, validates the response against the bundle
          (no silent skipping, addresses order matches items order, action enum, note ≤240 chars,
          summary envelope), commits the cleaned artefact, and emits ``agent_response.posted``
          (ADR-0022) — which the projection treats as a gate re-opener for the matching gate.

        ``feature_slug`` and ``target_path`` are passed in by the concrete agent (it knows its
        naming pattern); making the harness compute them would re-encode each agent's path policy
        here. ``file_sha`` is the existing file's blob SHA on a re-draft (None on a first draft) —
        GitHub's optimistic-concurrency rule (see ``HttpGitHubClient.put_file``).
        """
        self._validate_subclass_anchors()
        self._validate_inputs(inputs)

        result = self._call_model(run_id, inputs)

        feedback_bundle = inputs.get("feedback_bundle")
        if feedback_bundle is not None:
            artefact_text, response_payload = _extract_response_block(result.text)
            self._validate_response_against_bundle(response_payload, feedback_bundle)
        else:
            artefact_text = result.text
            response_payload = None

        meta, body = parse_frontmatter(artefact_text)
        self._validate_artefact(meta, body, feature_slug=feature_slug)

        path = target_path or self._default_target_path(feature_slug=meta["maestro"]["feature"])
        commit = self._github.commit_artefact(
            run_id=run_id, repo=repo, branch=branch, path=path,
            content=artefact_text,
            message=commit_message or self._default_commit_message(meta, response_payload),
            sha=file_sha,
        )

        if response_payload is not None:
            event = self._emit_agent_response(
                run_id, repo, branch, path, meta, commit, result, response_payload,
            )
        else:
            event = self._emit_producer_event(run_id, repo, branch, path, meta, commit, result)

        return AgentRun(
            run_id=run_id, agent=self._prompt.agent, artefact_kind=self.artefact_kind,
            artefact_path=path, artefact_content=artefact_text, frontmatter=meta,
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

    def _default_commit_message(self, meta: dict, response_payload: Optional[dict] = None) -> str:
        feature = meta.get("maestro", {}).get("feature", "?")
        task = meta.get("maestro", {}).get("task")
        prefix = f"{task}: " if task else ""
        if response_payload is not None:
            return f"{prefix}{self._prompt.agent}: re-draft {self.artefact_kind} for {feature}"
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

    # --- response validation (ADR-0022 §required-shape-rules) -----------------------------------

    def _validate_response_against_bundle(self, response: dict, bundle: dict) -> None:
        """Pin the agent's ``addresses[]`` against the bundle's ``items[]``: one entry per item, in
        bundle order, comment_ids matched, action enum, note ≤240 chars, summary envelope.

        Every ``ArtefactRejected`` reason here is stable and named (``response_bundle_mismatch``,
        ``incomplete_addresses``, ``invalid_action``, ``oversize_note``, ``oversize_summary_of_changes``,
        ``missing_response_field``) so a regression dashboard can group by mode of failure."""
        if not isinstance(response, dict):
            raise ArtefactRejected("missing_response_field",
                                   "maestro-response block did not parse as a JSON object")

        bundle_id_expected = bundle.get("id") or bundle.get("bundle_id")
        bundle_id_emitted = response.get("bundle_id")
        if not bundle_id_emitted:
            raise ArtefactRejected("missing_response_field",
                                   "agent_response is missing `bundle_id`")
        if bundle_id_emitted != bundle_id_expected:
            raise ArtefactRejected(
                "response_bundle_mismatch",
                f"bundle_id {bundle_id_emitted!r} in response does not match the input "
                f"bundle's {bundle_id_expected!r}",
            )

        summary = response.get("summary_of_changes")
        if not isinstance(summary, str) or not summary.strip():
            raise ArtefactRejected("missing_response_field",
                                   "agent_response is missing `summary_of_changes`")
        s = summary.strip()
        if len(s) > MAX_SUMMARY_CHARS:
            raise ArtefactRejected(
                "oversize_summary_of_changes",
                f"summary_of_changes must be ≤ {MAX_SUMMARY_CHARS} chars (ADR-0022); got {len(s)}",
            )
        if len(s.split()) > MAX_SUMMARY_WORDS:
            raise ArtefactRejected(
                "oversize_summary_of_changes",
                f"summary_of_changes must be ≤ {MAX_SUMMARY_WORDS} words (ADR-0022)",
            )

        items = bundle.get("items") or []
        addresses = response.get("addresses")
        if not isinstance(addresses, list):
            raise ArtefactRejected("missing_response_field",
                                   "agent_response.addresses must be a list")
        if len(addresses) != len(items):
            raise ArtefactRejected(
                "incomplete_addresses",
                f"addresses[] must have one entry per bundle item (ADR-0022): bundle has "
                f"{len(items)} items, response has {len(addresses)} addresses",
            )

        for i, (item, entry) in enumerate(zip(items, addresses)):
            if not isinstance(entry, dict):
                raise ArtefactRejected("incomplete_addresses",
                                       f"addresses[{i}] is not an object")
            comment_id_expected = _bundle_item_comment_id(item)
            comment_id_emitted = entry.get("comment_id")
            if comment_id_emitted != comment_id_expected:
                raise ArtefactRejected(
                    "incomplete_addresses",
                    f"addresses[{i}].comment_id {comment_id_emitted!r} does not match the "
                    f"bundle item's {comment_id_expected!r} (must be in bundle order)",
                )
            action = entry.get("action")
            if action not in _ACTIONS:
                raise ArtefactRejected(
                    "invalid_action",
                    f"addresses[{i}].action must be one of {sorted(_ACTIONS)!r}; got {action!r}",
                )
            note = entry.get("note")
            if not isinstance(note, str) or not note.strip():
                raise ArtefactRejected(
                    "missing_response_field",
                    f"addresses[{i}].note is required for every entry (ADR-0022)",
                )
            if len(note) > MAX_NOTE_CHARS:
                raise ArtefactRejected(
                    "oversize_note",
                    f"addresses[{i}].note must be ≤ {MAX_NOTE_CHARS} chars (ADR-0022); "
                    f"got {len(note)}",
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

    def _emit_agent_response(self, run_id: str, repo: str, branch: str, path: str,
                             meta: dict, commit: dict, result: ModelResult,
                             response: dict) -> dict:
        """Emit ``agent_response.posted`` (ADR-0022) on a re-draft. The harness fills the
        ``artefact.ref``, ``attributed_to``, and ``emitted_at`` fields; the LLM supplied
        ``bundle_id``, ``summary_of_changes``, and ``addresses[]``. The projection treats this
        event as a **gate re-opener** for the agent's gate type so the workspace sees a fresh
        pending state on the new artefact."""
        m = meta.get("maestro", {})
        return self._events.append(
            run_id=run_id, actor=self._actor, type="agent_response.posted",
            target=f"{repo}:{branch}:{path}",
            payload={
                "task_id": run_id,
                "agent": self._prompt.agent,
                "kind": self.artefact_kind,
                "feature": m.get("feature"),
                "bundle_id": response["bundle_id"],
                "summary_of_changes": response["summary_of_changes"].strip(),
                "addresses": response["addresses"],
                "ref": {"repo": repo, "branch": branch, "path": path,
                        "commit": commit.get("commit_sha")},
                "attributed_to": {"agent": self._prompt.agent, "run_id": run_id,
                                   "model": result.call.model},
            },
        )


# --- helpers ---------------------------------------------------------------------------------------


# Trailing ```json maestro-response ... ``` block — required on a re-draft, must be the last
# fenced block in the response. The regex is anchored at the end so the artefact's own body can
# contain code fences (a technical_design with a YAML or python example is fine) without confusing
# us — we only ever match the trailing one.
import json as _json
import re as _re

_RESPONSE_BLOCK_RE = _re.compile(
    r"\n*```json\s+maestro-response\s*\n(?P<body>.+?)\n```\s*$",
    _re.DOTALL,
)


def _extract_response_block(text: str) -> tuple[str, dict]:
    """Strip the trailing maestro-response block off ``text``; return ``(artefact_text, payload)``.

    Raises :class:`ArtefactRejected` (``missing_response_block`` / ``malformed_response_block``)
    when the agent did not honour the format the spec/design prompts pinned. The returned
    ``artefact_text`` is what gets committed — the response metadata never lands in the repo.
    """
    match = _RESPONSE_BLOCK_RE.search(text)
    if match is None:
        raise ArtefactRejected(
            "missing_response_block",
            "the response did not end with a ```json maestro-response``` fenced block "
            "(ADR-0022; see standards/prompts/<agent>-agent.md §format-on-a-re-draft)",
        )
    try:
        payload = _json.loads(match.group("body"))
    except _json.JSONDecodeError as exc:
        raise ArtefactRejected(
            "malformed_response_block",
            f"the maestro-response JSON did not parse: {exc.msg} (line {exc.lineno})",
        ) from None
    artefact = text[: match.start()].rstrip() + "\n"
    return artefact, payload


def _bundle_item_comment_id(item: dict) -> Optional[str]:
    """Pull a stable comment_id out of one bundle item. ADR-0020's payload puts the comment under
    ``items[].comments[0].id``; tolerate either shape (``item.comment_id`` or first-comment id) so
    a future bundle-shape refinement doesn't ripple through this validator."""
    if not isinstance(item, dict):
        return None
    direct = item.get("comment_id")
    if direct:
        return direct
    comments = item.get("comments")
    if isinstance(comments, list) and comments and isinstance(comments[0], dict):
        return comments[0].get("id") or comments[0].get("comment_id")
    return None


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
