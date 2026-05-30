"""The **builder agent** (US-0011, ``impl``) — approved technical design → implementation on the
task's ``maestro/*`` branch → a **draft pull request**.

Unlike the spec / design agents, the builder does **not** subclass :class:`orchestrator.agents.base.Agent`:
that harness commits one markdown artefact and emits one producer event. The builder produces **code
across many files in several commits** plus a **PR** — a different output contract. So this module is
a standalone helper that mirrors the *shape* of :func:`orchestrator.agents.design.run_design_for_run`
(read the upstream event → derive refs → call the single :class:`~model.client.ModelClient` → write
through the audited :class:`~adapters.github.adapter.GitHubAdapter`) with its own parse/validate/commit
path.

The LangGraph ``build_node`` (ADR-0014) calls :func:`run_impl_for_run` after the technical-design gate
approves. The branch already exists (the spec agent opened it; the design landed on it), so the builder
commits onto the **same branch**:

* **one commit per task-list entry**, message ``task-{n}: <title>`` (M2 commit-shape resolution) — via
  the Git Data API multi-file commit (:meth:`GitHubAdapter.commit_change`) so a task's files land in
  one commit;
* then a **draft PR** whose body links the delivery task + approved spec/design and shows, per
  acceptance criterion, which change satisfies it. That body is composed **deterministically here**
  (not by the LLM) so the requirement→change traceability is a guaranteed property, not a model
  behaviour (US-0011 AC).

The ``pr.opened`` event the adapter emits is what the projection turns into the ``technical_merge``
gate opener (:mod:`orchestrator.projection`). The builder never merges and never pushes to a default
branch — the ``maestro/*`` guard lives in the adapter (ADR-0016).

What this slice (US-0011) does NOT do (deferred):

* **The merge-gate re-build loop's response record.** On a merge-gate ``request_changes`` the graph
  loops back to ``build_node``; this helper re-runs **idempotently** (it does not open a second PR and
  pushes the revised commits to the same branch), but the per-comment ``agent_response`` and the gate
  re-open belong to the merge-gate orchestration (US-0020).
* **Merge execution** (``run_merge`` / ``GitHubAdapter.merge``) — US-0020.
"""
import json
import pathlib
import re
from dataclasses import dataclass
from typing import Any, Optional

from adapters.github.adapter import GitHubAdapter
from model.client import ModelClient
from orchestrator.agents.loader import Prompt, load_prompt
from orchestrator.eventlog import EventLog
from orchestrator.register import Register
from orchestrator.specindex import parse_frontmatter

DEFAULT_PROMPT_PATH = "standards/prompts/impl-agent.md"
DEFAULT_BASE_BRANCH = "main"

# Trailing ```json maestro-build ... ``` block — the builder's whole structured output. Anchored at
# the end (same discipline as base._RESPONSE_BLOCK_RE) so the file contents the builder emits inside
# the block — which may themselves contain code fences — never confuse the match.
_BUILD_BLOCK_RE = re.compile(
    r"```json\s+maestro-build\s*\n(?P<body>.+?)\n```\s*$",
    re.DOTALL,
)
_AC_RE = re.compile(r"AC-\d+")


class BuildRejected(ValueError):
    """The LLM's response is not a valid maestro build plan (block shape, commits, files, …).

    Like :class:`orchestrator.agents.base.ArtefactRejected`, the helper raises rather than corrects:
    a malformed plan is the agent's bug (fix the prompt), not the harness's parser. ``reason`` is a
    stable code the test suite can group by."""

    def __init__(self, reason: str, detail: str = ""):
        self.reason = reason
        super().__init__(f"{reason}: {detail}" if detail else reason)


@dataclass(frozen=True)
class ImplRun:
    """One builder invocation's outcome — what was committed, the PR it opened, and the events."""
    run_id: str
    repo: str
    branch: str
    feature: str
    commits: list[dict]            # [{task, title, requirements, paths, commit_sha, message}]
    pr: Optional[dict]             # {repo, number, url, draft} — None only on an unexpected no-op
    pr_event_seq: Optional[int]    # the pr.opened event's seq (None on an idempotent re-build)
    model_call: Any                # the ModelClient's LLMCall record (cost/latency drill-down)


def run_impl_for_run(run_id: str, *, events: EventLog, register: Register,
                     model: ModelClient, github: GitHubAdapter, reader: Any,
                     prompt_path: str = DEFAULT_PROMPT_PATH,
                     base_branch: str = DEFAULT_BASE_BRANCH) -> ImplRun:
    """Drive the builder for a task whose design gate has just been approved.

    ``reader`` is a read-only repo-content client (the ``HttpGitHubClient`` / the read API's
    ``RepoContentReader``) — the builder fetches the approved design and spec **content** to implement
    against, because the model has no repo access of its own (the refs the spec/design agents pass are
    not enough to actually read the artefacts).
    """
    design_event = _latest_producer(events, run_id, "design.produced")
    design_ref = design_event["payload"]["ref"]
    feature = design_event["payload"].get("feature")
    if not feature:
        raise ValueError(
            f"design.produced event for run {run_id!r} carries no `feature` — the design agent "
            f"should emit it (orchestrator/agents/base._emit_producer_event)"
        )
    repo = design_ref["repo"]
    branch = design_ref["branch"]

    spec_event = _latest_producer(events, run_id, "spec.drafted")
    spec_ref = spec_event["payload"]["ref"]

    dispatched = _find_dispatched(events, run_id)
    product_id = dispatched["payload"]["product_id"]
    intent = dispatched["payload"]["intent"]

    product = register.product(product_id)
    if product is None:
        raise ValueError(f"product {product_id!r} not in register (task {run_id!r})")

    design_content = _read_content(reader, design_ref)
    spec_content = _read_content(reader, spec_ref)

    prompt = _load_prompt(prompt_path)

    inputs: dict = {
        "task": {"task_id": run_id, "product_id": product_id, "repo": repo, "stage": "build"},
        "product": {"id": product.id, "name": product.name,
                    "product_type": product.product_type, "repos": list(product.repos)},
        "design": {"ref": design_ref, "content": design_content},
        "spec": {"ref": spec_ref, "content": spec_content, "intent": intent},
    }
    # Re-build detection — symmetric with the spec/design helpers. A merge-gate request_changes loops
    # the graph back to build_node; the unclosed technical_merge feedback bundle is the discriminator.
    feedback_bundle = _active_feedback_bundle(events, run_id, gate_type="technical_merge")
    if feedback_bundle is not None:
        inputs["feedback_bundle"] = feedback_bundle

    _validate_inputs(prompt, inputs)
    result = _call_model(model, prompt, run_id, inputs)
    plan = _parse_build_plan(result.text)
    _validate_plan(plan, feature_expected=feature)

    commits = _commit_tasks(github, run_id, repo, branch, plan["commits"])

    # Idempotent re-build: if a PR already exists for this run (the graph looped build_node on a
    # merge-gate request_changes), push the revised commits but do not open a second PR — the merge
    # gate's re-open is wired with US-0020.
    existing = _existing_pr(events, run_id)
    if existing is not None:
        return ImplRun(run_id=run_id, repo=repo, branch=branch, feature=feature,
                       commits=commits, pr=existing, pr_event_seq=None, model_call=result.call)

    design_meta, _ = parse_frontmatter(design_content)
    title = _pr_title(design_meta, feature)
    body = _compose_pr_body(run_id=run_id, spec_ref=spec_ref, design_ref=design_ref,
                            spec_content=spec_content, summary=plan.get("summary", ""),
                            commits=commits)
    pr = github.open_pr(run_id, repo, head=branch, base=base_branch, title=title, body=body,
                        draft=True)
    pr_seq = _last_pr_opened_seq(events, run_id)
    return ImplRun(run_id=run_id, repo=repo, branch=branch, feature=feature, commits=commits,
                   pr={"repo": repo, "number": pr["number"], "url": pr.get("url"), "draft": True},
                   pr_event_seq=pr_seq, model_call=result.call)


# --- commit + PR composition -----------------------------------------------------------------------


def _commit_tasks(github: GitHubAdapter, run_id: str, repo: str, branch: str,
                  plan_commits: list[dict]) -> list[dict]:
    """Commit each task-list entry as one atomic commit ``task-{n}: <title>``, in plan order."""
    out: list[dict] = []
    for entry in plan_commits:
        n = entry["task"]
        title = entry["title"]
        message = f"task-{n}: {title}"
        files = [{"path": f["path"], "content": f["content"]} for f in entry["files"]]
        res = github.commit_change(run_id, repo, branch, files, message,
                                   task=n, requirements=entry["requirements"])
        out.append({"task": n, "title": title, "requirements": list(entry["requirements"]),
                    "paths": [f["path"] for f in files], "commit_sha": res.get("commit_sha"),
                    "message": message})
    return out


def _pr_title(design_meta: Optional[dict], feature: str) -> str:
    title = (design_meta or {}).get("title") if isinstance(design_meta, dict) else None
    if isinstance(title, str) and title.strip():
        # Drop the design's "— technical design" tail if present; this PR is the implementation.
        return re.sub(r"\s*[—-]\s*technical design\s*$", "", title.strip(), flags=re.IGNORECASE)
    return f"{feature} — implementation"


def _compose_pr_body(*, run_id: str, spec_ref: dict, design_ref: dict, spec_content: str,
                     summary: str, commits: list[dict]) -> str:
    """Build the PR description deterministically (US-0011 AC #2): delivery-task + spec/design links,
    a requirement→change table covering every AC in the spec (unmapped ACs surfaced), the builder's
    plain-language summary, and the draft/DoD note."""
    lines: list[str] = [
        f"Implements maestro delivery task `{run_id}`.",
        "",
        f"**Approved spec:** `{_ref_str(spec_ref)}`",
        f"**Approved design:** `{_ref_str(design_ref)}`",
        "",
        "## Summary",
        summary.strip() or "_(no summary provided)_",
        "",
        "## Requirements → changes",
        "| Requirement | Satisfied by |",
        "|---|---|",
    ]
    # requirement -> ["`task-1` — `a`, `b`", …]
    by_req: dict[str, list[str]] = {}
    for c in commits:
        cell = f"`task-{c['task']}` — " + ", ".join(f"`{p}`" for p in c["paths"])
        for req in c["requirements"]:
            by_req.setdefault(req, []).append(cell)

    spec_acs = _unique_acs(spec_content)
    rows = _ordered_requirements(spec_acs, by_req.keys())
    for req in rows:
        satisfied = "; ".join(by_req.get(req, [])) if req in by_req else "⚠️ unmapped"
        lines.append(f"| {req} | {satisfied} |")

    lines += [
        "",
        "## Definition of Done",
        "This PR is a **draft**. maestro opens the merge gate only when the DoD gates are green "
        "(spec-derived tests — US-0014; CI security / SBOM floors). The architect decides the merge "
        "and maestro executes it against the recorded approval ([ADR-0016]"
        "(../docs/architecture/decisions/0016-merge-after-workspace-approval.md)); \"done\" is the "
        "observed merge event, never an agent's claim.",
        "",
    ]
    return "\n".join(lines)


def _unique_acs(spec_content: str) -> list[str]:
    seen: dict[str, None] = {}
    for m in _AC_RE.findall(spec_content or ""):
        seen.setdefault(m, None)
    return list(seen)


def _ordered_requirements(spec_acs: list[str], referenced) -> list[str]:
    """All requirement labels to show, AC-N numerically first then any non-AC label (e.g. ``infra``)
    last, alphabetically. The union covers spec ACs (so an unmapped one is visible) and anything a
    commit referenced (so a stray reference is visible too)."""
    labels = set(spec_acs) | set(referenced)

    def key(label: str):
        m = re.fullmatch(r"AC-(\d+)", label)
        return (0, int(m.group(1)), "") if m else (1, 0, label)

    return sorted(labels, key=key)


def _ref_str(ref: dict) -> str:
    base = f"{ref.get('repo')}:{ref.get('path')}"
    commit = ref.get("commit")
    return f"{base}@{commit}" if commit else base


# --- model call + parsing --------------------------------------------------------------------------


def _call_model(model: ModelClient, prompt: Prompt, run_id: str, inputs: dict):
    user_message = _format_user_message(prompt, inputs)
    kwargs = {}
    if prompt.max_output_tokens is not None:
        kwargs["max_tokens"] = prompt.max_output_tokens
    return model.complete(
        agent=prompt.agent, run_id=run_id, tier=prompt.model_tier,
        system=prompt.body, prompt=user_message,
        prompt_template_id=prompt.template_id,
        prompt_template_version=prompt.template_version,
        **kwargs,
    )


def _format_user_message(prompt: Prompt, inputs: dict[str, Any]) -> str:
    """One block per declared input, in prompt order — deterministic so an audit can replay (same
    convention as :func:`orchestrator.agents.base._format_user_message`)."""
    lines: list[str] = [f"run_id: {inputs.get('task', {}).get('task_id', '')}", ""]
    for io in prompt.inputs:
        if io.name not in inputs:
            continue
        value = inputs[io.name]
        rendered = value if isinstance(value, str) else json.dumps(value, default=str, indent=2)
        lines += [f"## {io.name}", "", rendered, ""]
    return "\n".join(lines).rstrip() + "\n"


def _parse_build_plan(text: str) -> dict:
    match = _BUILD_BLOCK_RE.search(text)
    if match is None:
        raise BuildRejected(
            "missing_build_block",
            "the response did not end with a ```json maestro-build``` fenced block "
            "(standards/prompts/impl-agent.md §Output)",
        )
    try:
        plan = json.loads(match.group("body"))
    except json.JSONDecodeError as exc:
        raise BuildRejected("malformed_build_block",
                            f"the maestro-build JSON did not parse: {exc.msg} (line {exc.lineno})") \
            from None
    if not isinstance(plan, dict):
        raise BuildRejected("malformed_build_block", "maestro-build block is not a JSON object")
    return plan


def _validate_plan(plan: dict, *, feature_expected: str) -> None:
    feature = plan.get("feature")
    if feature != feature_expected:
        raise BuildRejected(
            "wrong_feature",
            f"maestro-build feature {feature!r} does not match the approved design's "
            f"{feature_expected!r}",
        )
    commits = plan.get("commits")
    if not isinstance(commits, list) or not commits:
        raise BuildRejected("no_commits", "maestro-build must carry a non-empty `commits` list")
    seen_tasks: set = set()
    for i, c in enumerate(commits):
        if not isinstance(c, dict):
            raise BuildRejected("bad_commit", f"commits[{i}] is not an object")
        task = c.get("task")
        if not isinstance(task, int):
            raise BuildRejected("bad_commit", f"commits[{i}].task must be an integer; got {task!r}")
        if task in seen_tasks:
            raise BuildRejected("bad_commit", f"duplicate task number {task} in commits")
        seen_tasks.add(task)
        if not isinstance(c.get("title"), str) or not c["title"].strip():
            raise BuildRejected("bad_commit", f"commits[{i}].title is required")
        reqs = c.get("requirements")
        if not isinstance(reqs, list) or not reqs or not all(isinstance(r, str) for r in reqs):
            raise BuildRejected("bad_commit",
                                f"commits[{i}].requirements must be a non-empty list of strings "
                                f"(use ['infra'] for scaffolding)")
        files = c.get("files")
        if not isinstance(files, list) or not files:
            raise BuildRejected("bad_commit", f"commits[{i}].files must be a non-empty list")
        for j, f in enumerate(files):
            if not isinstance(f, dict) or not isinstance(f.get("path"), str) or not f["path"].strip():
                raise BuildRejected("bad_file", f"commits[{i}].files[{j}].path is required")
            if not isinstance(f.get("content"), str):
                raise BuildRejected("bad_file",
                                    f"commits[{i}].files[{j}].content must be a string")


def _validate_inputs(prompt: Prompt, inputs: dict) -> None:
    missing = prompt.required_inputs() - set(inputs)
    if missing:
        raise ValueError(f"missing required inputs for impl agent: {sorted(missing)!r}")
    unknown = set(inputs) - prompt.known_inputs()
    if unknown:
        raise ValueError(f"unknown inputs for impl agent: {sorted(unknown)!r} "
                         f"(declare them in {DEFAULT_PROMPT_PATH})")


# --- event helpers ---------------------------------------------------------------------------------


def _latest_producer(events: EventLog, run_id: str, etype: str) -> dict:
    """The most recent event of ``etype`` for the task (the approved one at this stage; on a re-draft
    the latest supersedes). Symmetric with design.py's ``_latest_spec_drafted``."""
    candidates = [e for e in events.read(run_id) if e["type"] == etype]
    if not candidates:
        raise ValueError(
            f"no {etype} event for run {run_id!r} — was the upstream agent run before the builder?"
        )
    return candidates[-1]


def _find_dispatched(events: EventLog, run_id: str) -> dict:
    candidates = [e for e in events.read(run_id) if e["type"] == "task.dispatched"]
    if not candidates:
        raise ValueError(f"no task.dispatched event for run {run_id!r} — builder ran without a dispatch?")
    return candidates[-1]


def _existing_pr(events: EventLog, run_id: str) -> Optional[dict]:
    """The PR opened for this run, if any — so a re-build does not open a duplicate (idempotency)."""
    for e in reversed(events.read(run_id)):
        if e["type"] == "pr.opened":
            p = e["payload"]
            return {"repo": p.get("repo"), "number": p.get("pr_number"),
                    "url": p.get("pr_url"), "draft": p.get("draft", False)}
    return None


def _last_pr_opened_seq(events: EventLog, run_id: str) -> Optional[int]:
    for e in reversed(events.read(run_id)):
        if e["type"] == "pr.opened":
            return e["seq"]
    return None


def _active_feedback_bundle(events: EventLog, run_id: str, *, gate_type: str) -> Optional[dict]:
    """Latest unclosed ``feedback_bundle.created`` for this gate type — symmetric with the spec /
    design helpers (the merge-gate re-build's input)."""
    raw = events.read(run_id)
    closed_ids = {e["payload"].get("bundle_id") for e in raw
                  if e["type"] == "agent_response.posted"}
    for e in reversed(raw):
        if e["type"] != "feedback_bundle.created":
            continue
        p = e["payload"]
        if (p.get("gate") or {}).get("type") != gate_type:
            continue
        if p.get("bundle_id") in closed_ids:
            continue
        return p
    return None


def _read_content(reader: Any, ref: dict) -> str:
    """Fetch a committed artefact's content via the read-only client. Prefer the pinned commit; fall
    back to the branch (the commit may not be individually addressable in every reader)."""
    repo, path = ref["repo"], ref["path"]
    for candidate in (ref.get("commit"), ref.get("branch")):
        if not candidate:
            continue
        try:
            return reader.get_contents(repo, path, candidate)["content"]
        except Exception:
            continue
    raise ValueError(f"could not read {repo}:{path} (ref {ref!r}) for the builder")


def _load_prompt(prompt_path: str) -> Prompt:
    """Resolve ``prompt_path`` against the repo root if relative, with a package-root fallback — same
    logic as the spec/design agents' loader."""
    p = pathlib.Path(prompt_path)
    if not p.is_absolute():
        for c in (p, pathlib.Path(__file__).resolve().parents[2] / prompt_path):
            if c.exists():
                return load_prompt(c)
    return load_prompt(p)


def get_default_prompt(prompt_path: Optional[str] = None) -> Prompt:
    """Public accessor for the loaded impl prompt — handy for the boot path / a CLI."""
    return _load_prompt(prompt_path or DEFAULT_PROMPT_PATH)
