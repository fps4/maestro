"""The design agent (US-0013) — the concrete subclass + the design-stage wiring helper.

Two layers covered, same shape as :mod:`tests.test_spec_agent`:

1. :class:`DesignAgent` — the three anchors the harness leaves to the concrete agent.
2. :func:`run_design_for_run` — reads the latest ``spec.drafted`` event, derives the spec_ref +
   branch from it, runs the agent on the **same branch** as the spec. Production wires it into the
   LangGraph ``design_node`` (M1 #7), so when the runtime routes to design (after the functional
   gate approves), this helper fires.

All offline: FakeGitHubClient + FakeProvider (conftest.py), no sockets, no real LLM.
"""
import pytest

from adapters.github.adapter import GitHubAdapter
from orchestrator.agents.design import (
    DEFAULT_PROMPT_PATH,
    DesignAgent,
    run_design_for_run,
)
from orchestrator.projection import project_task

ARCH = "@arch"
REPO = "acme/widget"
BRANCH = "maestro/task-9c2e3f"               # the spec agent's branch — design uses the SAME one


# --- fixtures -----------------------------------------------------------------------------------

def _well_formed_design(feature="csv-export"):
    return f"""---
title: "CSV export — technical design"
status: draft
last_updated: 2026-05-29
owners: [architect]
maestro:
  feature: {feature}
  kind: technical_design
  task: US-0042
  summary: |
    A small HTTP endpoint that streams the last quarter's invoices as a single
    paged CSV. The data path reuses the existing reporting tables and runs
    through the existing auth and rate limit layers.
---

# CSV export — technical design

## Requirements traceability
| AC | Satisfied by |
|---|---|
| AC-1 | The /reports/csv endpoint emits an RFC-4180 stream |

## Architecture
A single endpoint on the reports service.

## Task list
| # | Task | Targets | Requirements | Depends on |
|---|---|---|---|---|
| 1 | Add /reports/csv endpoint | acme/widget | AC-1 | — |
"""


@pytest.fixture
def model_with_response(model_factory, audit):
    """Returns ``(model, provider)``; provider's response is the well-formed design above."""
    from tests.conftest import _Resp
    return model_factory(audit, resp=_Resp(text=_well_formed_design(), input_tokens=200,
                                            output_tokens=400))


@pytest.fixture
def gh_adapter(events, register, routing, github_client):
    return GitHubAdapter(events, register, routing, github_client)


@pytest.fixture
def spec_drafted(write_api, events):
    """A dispatched task + a seeded ``spec.drafted`` event — the state when the LangGraph
    ``design_node`` runs. Returns the task id; the spec.drafted event carries ``feature`` and
    ``ref`` so the design helper can read both."""
    out = write_api.dispatch_task(ARCH, "maestro", intent="Add a CSV export endpoint")
    task_id = out["task_id"]
    events.append(run_id=task_id, actor="spec-agent", type="spec.drafted",
                  target=f"{REPO}:{BRANCH}:docs/product/specs/csv-export.md",
                  payload={"task_id": task_id, "agent": "spec",
                           "kind": "functional_spec", "feature": "csv-export",
                           "ref": {"repo": REPO, "branch": BRANCH,
                                   "path": "docs/product/specs/csv-export.md",
                                   "commit": "abc1234"}})
    return task_id


# --- DesignAgent class anchors ------------------------------------------------------------------

def test_design_agent_pins_the_three_required_anchors():
    """The harness validates these at run time; this test pins them at the class level so a
    rename or typo breaks the build at import time too."""
    assert DesignAgent.producer_event_type == "design.produced"
    assert DesignAgent.artefact_kind == "technical_design"
    assert DesignAgent(
        prompt=type("P", (), {"agent": "design", "model_tier": "strong",
                              "max_output_tokens": 12000, "inputs": (), "outputs": (),
                              "body": "x", "required_inputs": lambda self: set(),
                              "known_inputs": lambda self: set(),
                              "known_outputs": lambda self: set()})(),
        model=None, events=None, github=None,
    )._default_target_path(feature_slug="invoice-export") == \
        "docs/architecture/invoice-export-design.md"


# --- run_design_for_run — happy path ------------------------------------------------------------

def test_run_design_for_run_end_to_end(spec_drafted, events, register, model_with_response,
                                        gh_adapter, github_client):
    """The full design-stage flow: read spec.drafted → run design agent → commit to SAME branch as
    spec → emit design.produced → projection advances to technical_gate with open_gates populated."""
    model, _ = model_with_response
    out = run_design_for_run(spec_drafted, events=events, register=register, model=model,
                              github=gh_adapter)

    # The design landed on the spec's branch (not a fresh maestro/task-... — same as spec).
    assert out.commit["branch"] == BRANCH
    assert out.commit["repo"] == REPO

    # No branch.created event was emitted — the spec agent already opened the branch.
    assert not any(e["type"] == "branch.created" for e in events.read())

    # The artefact landed at the expected design path.
    expected_path = "docs/architecture/csv-export-design.md"
    assert (REPO, BRANCH, expected_path) in github_client.files
    assert out.artefact_path == expected_path

    # The producer event opens the technical_design gate (and carries the design's ref).
    [producer] = [e for e in events.read() if e["type"] == "design.produced"]
    payload = producer["payload"]
    assert payload["agent"] == "design"
    assert payload["kind"] == "technical_design"
    assert payload["feature"] == "csv-export"
    assert payload["ref"]["path"] == expected_path
    assert payload["ref"]["branch"] == BRANCH

    state = project_task(events.read(), spec_drafted)
    assert state.stage == "technical_gate"
    assert "technical_design" in state.open_gates
    assert state.open_gates["technical_design"]["seq"] == out.event_seq


def test_run_design_for_run_pins_feature_slug_from_spec(spec_drafted, events, register,
                                                         model_factory, audit, gh_adapter):
    """The design's ``maestro.feature`` MUST match the spec's. If the LLM emits a drifted slug
    (the spec is for csv-export, the design says invoice-export), the harness's ``feature_slug``
    check raises ``ArtefactRejected`` (wrong_feature) — pinned by the helper."""
    from tests.conftest import _Resp

    from orchestrator.agents.base import ArtefactRejected
    drifted = _well_formed_design(feature="something-different")
    model, _ = model_factory(audit, resp=_Resp(text=drifted))
    with pytest.raises(ArtefactRejected) as ei:
        run_design_for_run(spec_drafted, events=events, register=register, model=model,
                            github=gh_adapter)
    assert ei.value.reason == "wrong_feature"


def test_run_design_for_run_uses_the_latest_spec_drafted_on_a_redraft(
    spec_drafted, events, register, model_with_response, gh_adapter,
):
    """After a request_changes cycle the spec agent re-drafts and emits another spec.drafted
    event. The design helper must read the LATEST event — the just-approved version — and
    design against its commit."""
    # Append a second spec.drafted (the re-drafted, just-approved spec) with a different commit.
    events.append(run_id=spec_drafted, actor="spec-agent", type="spec.drafted",
                  target=f"{REPO}:{BRANCH}:docs/product/specs/csv-export.md",
                  payload={"task_id": spec_drafted, "agent": "spec",
                           "kind": "functional_spec", "feature": "csv-export",
                           "ref": {"repo": REPO, "branch": BRANCH,
                                   "path": "docs/product/specs/csv-export.md",
                                   "commit": "redraft9876"}})
    model, _ = model_with_response
    run_design_for_run(spec_drafted, events=events, register=register, model=model,
                        github=gh_adapter)

    # The harness's input rendering is deterministic — we asserted earlier (test_agent_base.py)
    # that inputs surface in prompt order. Here we verify the spec_ref the helper passed in was
    # the LATEST commit, not the first one.
    [provider_call] = _provider(model).calls
    user_msg = provider_call["messages"][0]["content"]
    assert "redraft9876" in user_msg
    assert "abc1234" not in user_msg


def _provider(model):
    """Reach the FakeProvider under the ModelClient — used in one test that asserts on the
    structured user message the harness rendered for the LLM."""
    factory = model._client_factory
    return factory.__self__ if hasattr(factory, "__self__") else model._provider()


# --- run_design_for_run — failure modes ---------------------------------------------------------

def test_run_design_for_run_without_spec_drafted_is_an_error(events, register,
                                                              model_with_response, gh_adapter,
                                                              write_api):
    """The design helper can only run after the spec helper has emitted spec.drafted. The
    LangGraph runtime guarantees the order (design_node runs only after functional-gate approve);
    a CLI / test misuse must fail loudly, not silently."""
    out = write_api.dispatch_task(ARCH, "maestro", intent="Add CSV export")
    model, _ = model_with_response
    with pytest.raises(ValueError) as ei:
        run_design_for_run(out["task_id"], events=events, register=register, model=model,
                            github=gh_adapter)
    assert "spec.drafted" in str(ei.value)


def test_run_design_for_run_unknown_product_is_an_error(events, model_with_response, gh_adapter):
    """task.dispatched and spec.drafted both land, but the product vanishes from the register
    between then and the design call — loud failure, no silent substitution."""
    events.append(run_id="run-orphan", actor=ARCH, type="task.dispatched",
                  target="task:run-orphan",
                  payload={"task_id": "run-orphan", "product_id": "ghost",
                           "repo": "acme/ghost", "intent": "x"})
    events.append(run_id="run-orphan", actor="spec-agent", type="spec.drafted",
                  target="acme/ghost:maestro/task-orphan:docs/product/specs/x.md",
                  payload={"task_id": "run-orphan", "agent": "spec",
                           "kind": "functional_spec", "feature": "x",
                           "ref": {"repo": "acme/ghost",
                                   "branch": "maestro/task-orphan",
                                   "path": "docs/product/specs/x.md", "commit": "abc"}})
    from orchestrator.register import Register
    empty = Register(products={})
    model, _ = model_with_response
    with pytest.raises(ValueError) as ei:
        run_design_for_run("run-orphan", events=events, register=empty, model=model,
                            github=gh_adapter)
    assert "not in register" in str(ei.value)


def test_run_design_for_run_missing_feature_in_spec_event_is_an_error(
    events, register, model_with_response, gh_adapter, write_api,
):
    """A spec.drafted event without a ``feature`` field is a defect upstream — the spec agent's
    emit always carries it. The helper refuses rather than guessing a slug."""
    out = write_api.dispatch_task(ARCH, "maestro", intent="x")
    events.append(run_id=out["task_id"], actor="spec-agent", type="spec.drafted",
                  target=f"{REPO}:{BRANCH}:docs/product/specs/x.md",
                  payload={"task_id": out["task_id"], "agent": "spec",
                           "kind": "functional_spec",
                           "ref": {"repo": REPO, "branch": BRANCH,
                                   "path": "docs/product/specs/x.md", "commit": "abc"}})
    model, _ = model_with_response
    with pytest.raises(ValueError) as ei:
        run_design_for_run(out["task_id"], events=events, register=register, model=model,
                            github=gh_adapter)
    assert "feature" in str(ei.value)


# --- run_design_for_run picks up the SHIPPED prompt ---------------------------------------------

def test_default_prompt_path_points_at_the_shipped_file():
    """Symmetric with the spec agent's pinned default."""
    assert DEFAULT_PROMPT_PATH == "standards/prompts/design-agent.md"
