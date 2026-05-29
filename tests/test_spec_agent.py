"""The spec agent (US-0010) — the concrete subclass + the dispatch → spec wiring helper.

Two layers covered:

1. :class:`SpecAgent` — the three anchors the harness leaves to the concrete agent.
2. :func:`run_spec_for_run` — read a task.dispatched event, ensure the maestro/* branch exists
   (idempotent), run the agent, return the AgentRun. This is the synchronous entry point the
   LangGraph stage-wiring slice (M1 #7) will call from its spec stage node.

All offline: FakeGitHubClient + FakeProvider (conftest.py), no sockets, no real LLM.
"""
import pytest

from adapters.github.adapter import GitHubAdapter
from orchestrator.agents.spec import (
    DEFAULT_PROMPT_PATH,
    SpecAgent,
    _branch_for_task,
    run_spec_for_run,
)
from orchestrator.projection import project_task

ARCH = "@arch"
REPO = "acme/widget"


# --- fixtures -----------------------------------------------------------------------------------

def _well_formed_spec(feature="csv-export"):
    return f"""---
title: "CSV export"
status: draft
last_updated: 2026-05-29
owners: [architect]
maestro:
  feature: {feature}
  kind: functional_spec
  task: US-0042
  summary: |
    A CSV export endpoint that lets finance pull the last quarter's invoices
    in one paged, RFC-4180-quoted file, up to 50000 rows per request.
---

# CSV export

## Acceptance criteria
- AC-1. The system shall export to CSV.
"""


@pytest.fixture
def model_with_response(model_factory, audit):
    """Returns ``(model, provider)``; provider's response is the well-formed artefact above."""
    from tests.conftest import _Resp
    return model_factory(audit, resp=_Resp(text=_well_formed_spec(), input_tokens=100,
                                            output_tokens=200))


@pytest.fixture
def gh_adapter(events, register, routing, github_client):
    return GitHubAdapter(events, register, routing, github_client)


@pytest.fixture
def dispatched(write_api):
    """A real task.dispatched event from the workspace write API (M1 #1)."""
    out = write_api.dispatch_task(ARCH, "maestro", intent="Add a CSV export endpoint")
    return out["task_id"]


# --- SpecAgent class anchors --------------------------------------------------------------------

def test_spec_agent_pins_the_three_required_anchors():
    """The harness validates these at run time; this test pins them at the class level so a
    rename or typo breaks the build at import time too."""
    assert SpecAgent.producer_event_type == "spec.drafted"
    assert SpecAgent.artefact_kind == "functional_spec"
    assert SpecAgent(
        # construct just enough to exercise the path method
        prompt=type("P", (), {"agent": "spec", "model_tier": "fast",
                              "max_output_tokens": 4000, "inputs": (), "outputs": (),
                              "body": "x", "required_inputs": lambda self: set(),
                              "known_inputs": lambda self: set(),
                              "known_outputs": lambda self: set()})(),
        model=None, events=None, github=None,
    )._default_target_path(feature_slug="invoice-export") == "docs/product/specs/invoice-export.md"


# --- branch naming ------------------------------------------------------------------------------

def test_branch_for_task_strips_run_prefix():
    assert _branch_for_task("run-9c2e3f") == "maestro/task-9c2e3f"
    # A run id without the maestro 'run-' prefix is taken whole — defensive against an id format change.
    assert _branch_for_task("custom-id") == "maestro/task-custom-id"


# --- run_spec_for_run — happy path --------------------------------------------------------------

def test_run_spec_for_run_end_to_end(dispatched, events, register, model_with_response,
                                     gh_adapter, github_client):
    """The full dispatch → spec flow: branch opened, artefact committed, spec.drafted emitted,
    projection advances to functional_gate with open_gates populated."""
    model, _ = model_with_response
    out = run_spec_for_run(dispatched, events=events, register=register, model=model,
                            github=gh_adapter)

    # The branch follows naming.yaml's unbound-task pattern.
    expected_branch = _branch_for_task(dispatched)
    assert out.commit["branch"] == expected_branch
    [branch_evt] = [e for e in events.read() if e["type"] == "branch.created"]
    assert branch_evt["payload"]["branch"] == expected_branch
    assert branch_evt["payload"]["from_ref"] == "main"

    # The artefact landed on the expected path under the chosen branch.
    expected_path = "docs/product/specs/csv-export.md"
    assert (REPO, expected_branch, expected_path) in github_client.files
    assert out.artefact_path == expected_path

    # The producer event opens the gate; projection advances and exposes the seq for If-Match.
    state = project_task(events.read(), dispatched)
    assert state.stage == "functional_gate"
    assert "functional" in state.open_gates
    assert state.open_gates["functional"]["seq"] == out.event_seq


def test_run_spec_for_run_is_idempotent_against_a_previous_branch(
    dispatched, events, register, model_with_response, gh_adapter, github_client,
):
    """A previous partial run left a ``branch.created`` event — re-running the helper must not
    re-call open_branch (GitHub would 422 on a duplicate ref). Mirrors a retry after a crash
    between branch creation and spec commit."""
    # Seed a prior branch.created event for this task, as if the previous run had crashed.
    expected_branch = _branch_for_task(dispatched)
    events.append(run_id=dispatched, actor="github-adapter", type="branch.created",
                  target=f"{REPO}:{expected_branch}",
                  payload={"repo": REPO, "branch": expected_branch, "from_ref": "main"})
    before = len(github_client.branches)

    model, _ = model_with_response
    run_spec_for_run(dispatched, events=events, register=register, model=model,
                     github=gh_adapter)

    # The helper did NOT call create_branch a second time.
    assert len(github_client.branches) == before
    # Only one branch.created event in the log; one spec.drafted; one artefact.committed.
    assert sum(1 for e in events.read() if e["type"] == "branch.created") == 1
    assert sum(1 for e in events.read() if e["type"] == "spec.drafted") == 1


# --- run_spec_for_run — failure modes -----------------------------------------------------------

def test_run_spec_for_run_without_dispatched_event_is_an_error(events, register,
                                                                model_with_response,
                                                                gh_adapter):
    """A run id the harness sees no task.dispatched for is a real error — we don't invent one or
    guess. (The LangGraph stage-wiring will only ever invoke this after observing the event, but
    the helper is also reachable from a CLI / test that may be wrong.)"""
    model, _ = model_with_response
    with pytest.raises(ValueError) as ei:
        run_spec_for_run("run-ghost", events=events, register=register, model=model,
                          github=gh_adapter)
    assert "task.dispatched" in str(ei.value)


def test_run_spec_for_run_unknown_product_is_an_error(events, model_with_response, gh_adapter):
    """Dispatch landed for a product that vanished from the register since (M1 dogfood doesn't
    expect this, but the failure must be loud — don't pick a different product)."""
    # Append a dispatch for a product NOT in the register fixture.
    events.append(run_id="run-orphan", actor=ARCH, type="task.dispatched",
                  target="task:run-orphan",
                  payload={"task_id": "run-orphan", "product_id": "ghost",
                           "repo": "acme/ghost", "intent": "x"})
    from orchestrator.register import Register
    empty = Register(products={})
    model, _ = model_with_response
    with pytest.raises(ValueError) as ei:
        run_spec_for_run("run-orphan", events=events, register=empty, model=model,
                          github=gh_adapter)
    assert "not in register" in str(ei.value)


def test_run_spec_for_run_loads_the_default_prompt_from_repo_root(
    dispatched, events, register, model_with_response, gh_adapter, monkeypatch, tmp_path,
):
    """The prompt path defaults to the repo's standards/prompts/ — but the helper resolves it
    against the package root too, so a deployment that has cwd elsewhere still finds it."""
    # Move cwd somewhere unrelated; the helper must still resolve standards/prompts/spec-agent.md
    # via the package-root fallback.
    monkeypatch.chdir(tmp_path)
    model, _ = model_with_response
    out = run_spec_for_run(dispatched, events=events, register=register, model=model,
                            github=gh_adapter)
    assert out.frontmatter["maestro"]["kind"] == "functional_spec"


# --- run_spec_for_run picks up the SHIPPED prompt -----------------------------------------------

def test_default_prompt_path_points_at_the_shipped_file():
    """The constant is the operator's escape hatch (env var / CLI flag would override it). Pin it
    so a typo doesn't ship silently."""
    assert DEFAULT_PROMPT_PATH == "standards/prompts/spec-agent.md"
