"""The **test agent** (US-0014, ``testgen``) — approved spec + the builder's implementation →
**spec-derived tests committed into the same** ``maestro/*`` **PR**.

Like the builder (:mod:`orchestrator.agents.impl`) and unlike the spec / design agents, the test
agent does **not** subclass :class:`orchestrator.agents.base.Agent`: it produces **many test files in
one commit**, not a single markdown artefact, so it mirrors the builder's standalone shape (read the
upstream events → derive refs → call the single :class:`~model.client.ModelClient` → write through the
audited :class:`~adapters.github.adapter.GitHubAdapter`) with its own parse/validate/commit path.

The LangGraph ``build_node`` (ADR-0014) calls :func:`run_testgen_for_run` **after** the builder, so the
generated tests land on the **same branch** and the builder's draft PR already includes them. The M2
commit-shape resolution (Q2) pins the boundary: the test agent **commits test files; the product's CI
runs them**, and the spec-adherence Definition-of-Done gate is "the test job is green" — which the CI
poll (US-0020) reads. So this slice's job is *generate + commit*, not *execute*.

What it enforces at generation time (the part that does not need CI):

* **Spec-adherence coverage** ([`standards/testing.yaml`](../../standards/testing.yaml)) — at least one
  test per EARS acceptance criterion (``AC-N``) in the functional spec. An uncovered criterion is a
  :class:`TestsRejected` — the gate cannot be green if a criterion has no test (US-0014 AC #1/#5).
* **Tests only, never production code** (US-0014 AC #4) — every emitted path must live under the
  product's **test root** (``tests/`` for the maestro dogfood); a path outside it is rejected so the
  test agent cannot refactor the code it is meant to verify ([`testing.yaml`](../../standards/testing.yaml)
  ``authoring``).

The ``tests.generated`` event the helper emits records, per criterion, which test files cover it — the
audit replays the spec-adherence claim, and US-0020's DoD orchestration reads it alongside the CI poll.
The test agent never opens a PR (the builder already did), never merges, and never writes a default
branch — the ``maestro/*`` guard lives in the adapter (ADR-0016).

**Independence (US-0024 H1).** The test agent derives its tests from the **same** EARS criteria the
builder consumed; until the independent reviewer agent (US-0015) lands in M3, the only independent
reading of intent before merge is the architect's. The cheapest interim mitigation named in the M2
scope is to run the test agent on a **different model variant** from the builder — wired through the
prompt's ``model_tier`` and left to deployment config, not hardcoded here.
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

DEFAULT_PROMPT_PATH = "standards/prompts/testgen-agent.md"
DEFAULT_TEST_ROOT = "tests/"

# Trailing ```json maestro-tests ... ``` block — the whole structured output. Anchored at the end
# (same discipline as impl._BUILD_BLOCK_RE) so test-file contents inside the block — which routinely
# contain their own code fences — never confuse the match.
_TESTS_BLOCK_RE = re.compile(
    r"```json\s+maestro-tests\s*\n(?P<body>.+?)\n```\s*$",
    re.DOTALL,
)
_AC_RE = re.compile(r"AC-\d+")


class TestsRejected(ValueError):
    """The LLM's response is not a valid maestro test plan (block shape, files, AC coverage, …).

    Symmetric with :class:`orchestrator.agents.impl.BuildRejected`: the helper raises rather than
    corrects — a malformed plan or an uncovered criterion is the agent's bug (fix the prompt), not the
    harness's parser. ``reason`` is a stable code the test suite can group by."""

    __test__ = False        # this is an exception, not a pytest test class (name starts with "Test")

    def __init__(self, reason: str, detail: str = ""):
        self.reason = reason
        super().__init__(f"{reason}: {detail}" if detail else reason)


@dataclass(frozen=True)
class TestgenRun:
    """One test-agent invocation's outcome — what was committed and the coverage it claims."""
    run_id: str
    repo: str
    branch: str
    feature: str
    files: list[dict]                 # [{path, criteria}]
    coverage: dict                    # {AC-N: [path, …]} — every spec AC mapped to its test files
    commit: Optional[dict]            # {commit_sha, …} — None only on an unexpected no-op
    event_seq: Optional[int]          # the tests.generated event's seq
    model_call: Any                   # the ModelClient's LLMCall record (cost/latency drill-down)


def run_testgen_for_run(run_id: str, *, events: EventLog, register: Register,
                        model: ModelClient, github: GitHubAdapter, reader: Any,
                        prompt_path: str = DEFAULT_PROMPT_PATH,
                        test_root: str = DEFAULT_TEST_ROOT) -> TestgenRun:
    """Drive the test agent for a task whose implementation has just landed on its ``maestro/*`` branch.

    ``reader`` is the read-only repo-content client (the ``HttpGitHubClient`` the read API uses) — the
    test agent fetches the approved spec + design **and the builder's implementation** content to write
    tests against, because the model has no repo access of its own.
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

    product = register.product(product_id)
    if product is None:
        raise ValueError(f"product {product_id!r} not in register (task {run_id!r})")

    spec_content = _read_content(reader, spec_ref)
    design_content = _read_content(reader, design_ref)
    implementation = _read_implementation(events, run_id, repo, branch, reader)
    spec_acs = _unique_acs(spec_content)
    if not spec_acs:
        raise TestsRejected(
            "no_criteria",
            f"the functional spec for run {run_id!r} declares no AC-N acceptance criteria — "
            f"nothing to derive tests from",
        )

    prompt = _load_prompt(prompt_path)
    inputs: dict = {
        "task": {"task_id": run_id, "product_id": product_id, "repo": repo, "stage": "test",
                 "test_root": test_root},
        "product": {"id": product.id, "name": product.name,
                    "product_type": product.product_type, "repos": list(product.repos)},
        "spec": {"ref": spec_ref, "content": spec_content, "criteria": spec_acs},
        "design": {"ref": design_ref, "content": design_content},
        "implementation": implementation,
    }
    _validate_inputs(prompt, inputs)
    result = _call_model(model, prompt, run_id, inputs)
    plan = _parse_tests_plan(result.text)
    coverage = _validate_plan(plan, feature_expected=feature, spec_acs=spec_acs, test_root=test_root)

    files = [{"path": f["path"], "content": f["content"]} for f in plan["files"]]
    message = f"tests: spec-derived tests for {feature}"
    commit = github.commit_change(run_id, repo, branch, files, message,
                                  requirements=sorted(coverage.keys()))

    out_files = [{"path": f["path"], "criteria": list(f.get("criteria", []))} for f in plan["files"]]
    event = events.append(
        run_id=run_id, actor="testgen-agent", type="tests.generated",
        target=f"{repo}:{branch}",
        payload={"task_id": run_id, "agent": "testgen", "feature": feature,
                 "repo": repo, "branch": branch,
                 "paths": [f["path"] for f in out_files],
                 "coverage": coverage,
                 "commit_sha": commit.get("commit_sha"),
                 "model": result.call.model},
    )
    return TestgenRun(run_id=run_id, repo=repo, branch=branch, feature=feature,
                      files=out_files, coverage=coverage, commit=commit,
                      event_seq=event["seq"], model_call=result.call)


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
    convention as :func:`orchestrator.agents.impl._format_user_message`)."""
    lines: list[str] = [f"run_id: {inputs.get('task', {}).get('task_id', '')}", ""]
    for io in prompt.inputs:
        if io.name not in inputs:
            continue
        value = inputs[io.name]
        rendered = value if isinstance(value, str) else json.dumps(value, default=str, indent=2)
        lines += [f"## {io.name}", "", rendered, ""]
    return "\n".join(lines).rstrip() + "\n"


def _parse_tests_plan(text: str) -> dict:
    match = _TESTS_BLOCK_RE.search(text)
    if match is None:
        raise TestsRejected(
            "missing_tests_block",
            "the response did not end with a ```json maestro-tests``` fenced block "
            "(standards/prompts/testgen-agent.md §Output)",
        )
    try:
        plan = json.loads(match.group("body"))
    except json.JSONDecodeError as exc:
        raise TestsRejected("malformed_tests_block",
                            f"the maestro-tests JSON did not parse: {exc.msg} (line {exc.lineno})") \
            from None
    if not isinstance(plan, dict):
        raise TestsRejected("malformed_tests_block", "maestro-tests block is not a JSON object")
    return plan


def _validate_plan(plan: dict, *, feature_expected: str, spec_acs: list[str],
                   test_root: str) -> dict:
    """Validate the plan and return the ``{AC-N: [path, …]}`` coverage map.

    Raises :class:`TestsRejected` on a drifted feature, a malformed file, a path outside the test root
    (would let the agent edit production code — US-0014 AC #4), or any spec criterion left without a
    test (US-0014 AC #1)."""
    feature = plan.get("feature")
    if feature != feature_expected:
        raise TestsRejected(
            "wrong_feature",
            f"maestro-tests feature {feature!r} does not match the approved design's "
            f"{feature_expected!r}",
        )
    files = plan.get("files")
    if not isinstance(files, list) or not files:
        raise TestsRejected("no_files", "maestro-tests must carry a non-empty `files` list")

    coverage: dict[str, list[str]] = {ac: [] for ac in spec_acs}
    seen_paths: set = set()
    for i, f in enumerate(files):
        if not isinstance(f, dict):
            raise TestsRejected("bad_file", f"files[{i}] is not an object")
        path = f.get("path")
        if not isinstance(path, str) or not path.strip():
            raise TestsRejected("bad_file", f"files[{i}].path is required")
        if not _under_test_root(path, test_root):
            raise TestsRejected(
                "production_code_write",
                f"files[{i}].path {path!r} is outside the test root {test_root!r}; the test agent "
                f"writes tests only, never production code (standards/testing.yaml)",
            )
        if path in seen_paths:
            raise TestsRejected("bad_file", f"duplicate test path {path!r}")
        seen_paths.add(path)
        if not isinstance(f.get("content"), str) or not f["content"].strip():
            raise TestsRejected("bad_file", f"files[{i}].content must be a non-empty string")
        criteria = f.get("criteria")
        if not isinstance(criteria, list) or not criteria or not all(isinstance(c, str) for c in criteria):
            raise TestsRejected(
                "bad_file",
                f"files[{i}].criteria must be a non-empty list of AC-N strings the file tests",
            )
        for c in criteria:
            if c not in coverage:
                raise TestsRejected(
                    "unknown_criterion",
                    f"files[{i}].criteria references {c!r}, which is not an acceptance criterion in "
                    f"the spec (spec has {sorted(spec_acs)})",
                )
            coverage[c].append(path)

    uncovered = sorted(ac for ac, paths in coverage.items() if not paths)
    if uncovered:
        raise TestsRejected(
            "uncovered_criterion",
            f"every EARS acceptance criterion needs at least one test (standards/testing.yaml); "
            f"uncovered: {uncovered}",
        )
    return coverage


def _under_test_root(path: str, test_root: str) -> bool:
    """True iff ``path`` is repo-relative and lives under ``test_root`` (no traversal). The guard is
    deliberately strict — the test agent never edits production code (US-0014 AC #4)."""
    norm = pathlib.PurePosixPath(path)
    if norm.is_absolute() or ".." in norm.parts:
        return False
    root = test_root.rstrip("/") + "/"
    return path.startswith(root)


def _unique_acs(spec_content: str) -> list[str]:
    seen: dict[str, None] = {}
    for m in _AC_RE.findall(spec_content or ""):
        seen.setdefault(m, None)
    return sorted(seen, key=lambda s: int(s.split("-")[1]))


def _validate_inputs(prompt: Prompt, inputs: dict) -> None:
    missing = prompt.required_inputs() - set(inputs)
    if missing:
        raise ValueError(f"missing required inputs for testgen agent: {sorted(missing)!r}")
    unknown = set(inputs) - prompt.known_inputs()
    if unknown:
        raise ValueError(f"unknown inputs for testgen agent: {sorted(unknown)!r} "
                         f"(declare them in {DEFAULT_PROMPT_PATH})")


# --- event + content helpers -----------------------------------------------------------------------


def _latest_producer(events: EventLog, run_id: str, etype: str) -> dict:
    candidates = [e for e in events.read(run_id) if e["type"] == etype]
    if not candidates:
        raise ValueError(
            f"no {etype} event for run {run_id!r} — was the upstream agent run before the test agent?"
        )
    return candidates[-1]


def _find_dispatched(events: EventLog, run_id: str) -> dict:
    candidates = [e for e in events.read(run_id) if e["type"] == "task.dispatched"]
    if not candidates:
        raise ValueError(f"no task.dispatched event for run {run_id!r} — test agent ran without a dispatch?")
    return candidates[-1]


def _read_implementation(events: EventLog, run_id: str, repo: str, branch: str,
                         reader: Any) -> list[dict]:
    """The builder's committed implementation — every distinct path from this run's ``commit.created``
    events (latest content wins), read back through ``reader``. This is what the test agent writes
    tests against; an empty list (builder produced nothing) is surfaced upstream by the no-files guard.
    """
    paths: list[str] = []
    for e in events.read(run_id):
        if e["type"] != "commit.created":
            continue
        for p in e["payload"].get("paths") or []:
            if p not in paths:
                paths.append(p)
    out: list[dict] = []
    for path in paths:
        try:
            content = reader.get_contents(repo, path, branch)["content"]
        except Exception:
            continue
        out.append({"path": path, "content": content})
    return out


def _read_content(reader: Any, ref: dict) -> str:
    """Fetch a committed artefact's content via the read-only client. Prefer the pinned commit; fall
    back to the branch (same logic as :func:`orchestrator.agents.impl._read_content`)."""
    repo, path = ref["repo"], ref["path"]
    for candidate in (ref.get("commit"), ref.get("branch")):
        if not candidate:
            continue
        try:
            return reader.get_contents(repo, path, candidate)["content"]
        except Exception:
            continue
    raise ValueError(f"could not read {repo}:{path} (ref {ref!r}) for the test agent")


def _load_prompt(prompt_path: str) -> Prompt:
    """Resolve ``prompt_path`` against the repo root if relative, with a package-root fallback — same
    logic as the spec/design/impl agents' loader."""
    p = pathlib.Path(prompt_path)
    if not p.is_absolute():
        for c in (p, pathlib.Path(__file__).resolve().parents[2] / prompt_path):
            if c.exists():
                return load_prompt(c)
    return load_prompt(p)


def get_default_prompt(prompt_path: Optional[str] = None) -> Prompt:
    """Public accessor for the loaded testgen prompt — handy for the boot path / a CLI."""
    return _load_prompt(prompt_path or DEFAULT_PROMPT_PATH)
