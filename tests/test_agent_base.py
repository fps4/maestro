"""The agent harness — input validation, the single ModelClient call, frontmatter validation,
audited commit, producer event emission.

End-to-end coverage with no sockets and no real LLM. The FakeProvider (conftest.py) lets us pin the
LLM's response text, so we can exercise both the happy artefact-shape path and every
ArtefactRejected reason a real agent would surface in production.
"""
import pytest

from adapters.github.adapter import GitHubAdapter
from orchestrator.agents.base import (
    Agent,
    ArtefactRejected,
    InputRejected,
    _format_user_message,
)
from orchestrator.agents.loader import Prompt, PromptIO
from orchestrator.projection import project_task

ARCH = "@arch"
REPO = "acme/widget"
BRANCH = "maestro/us-0042-csv-export"


# --- fixtures ------------------------------------------------------------------------------------

@pytest.fixture
def spec_prompt():
    """A minimal spec-agent prompt for the harness — same shape as the real file, smaller body."""
    return Prompt(
        agent="spec",
        model_tier="fast",                       # use fast in tests so we don't need real opus/sonnet
        max_output_tokens=4000,
        inputs=(
            PromptIO("task", True),
            PromptIO("product", True),
            PromptIO("intent", True),
            PromptIO("feedback_bundle", False),
        ),
        outputs=(
            PromptIO("artefact_commit", True),
            PromptIO("agent_response", False),
        ),
        body="# Spec agent\n\nProduce a spec.",
    )


class _SpecAgent(Agent):
    """A concrete agent subclass for tests — pins the two anchors the harness requires."""
    producer_event_type = "spec.drafted"
    artefact_kind = "functional_spec"

    def _default_target_path(self, *, feature_slug):
        return f"docs/product/specs/{feature_slug}.md"


def _good_artefact(feature="csv-export"):
    """A well-formed maestro artefact the FakeProvider will hand back to the harness."""
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

## Summary
Body content.

## Acceptance criteria
- AC-1. The system shall export to CSV.
"""


@pytest.fixture
def harness(spec_prompt, events, register, routing, github_client, audit, model_factory):
    """Wire up an :class:`_SpecAgent` against the fake github client + a stub model that returns
    a well-formed artefact. Returns ``(agent, model, provider, github_adapter, github_client)``."""
    from tests.conftest import _Resp
    model, provider = model_factory(audit, resp=_Resp(text=_good_artefact(),
                                                     input_tokens=100, output_tokens=200))
    gh_adapter = GitHubAdapter(events, register, routing, github_client)
    return _SpecAgent(spec_prompt, model, events, gh_adapter), model, provider, gh_adapter


# --- happy path ----------------------------------------------------------------------------------

def test_run_validates_inputs_calls_model_commits_and_emits_event(harness, events, github_client):
    agent, _, provider, _ = harness
    out = agent.run(
        run_id="run-1", repo=REPO, branch=BRANCH,
        inputs={"task": {"task_id": "run-1", "product_id": "maestro"},
                "product": {"id": "maestro", "product_type": "technical"},
                "intent": "Add CSV export"},
        feature_slug="csv-export",
    )

    # The model received system=prompt body + user message naming inputs (deterministic for audit).
    [call] = provider.calls
    assert call["system"].startswith("# Spec agent")
    assert "## task" in call["messages"][0]["content"]
    assert "## intent" in call["messages"][0]["content"]

    # The artefact landed on the expected path of the maestro/* branch.
    file_record = github_client.files[(REPO, BRANCH, "docs/product/specs/csv-export.md")]
    assert "# CSV export" in file_record["content"]
    assert file_record["file_sha"].startswith("blob-")

    # The producer event is emitted with the artefact ref + feature.
    [producer] = [e for e in events.read() if e["type"] == "spec.drafted"]
    payload = producer["payload"]
    assert payload["agent"] == "spec"
    assert payload["kind"] == "functional_spec"
    assert payload["feature"] == "csv-export"
    assert payload["ref"]["path"] == "docs/product/specs/csv-export.md"
    assert payload["ref"]["branch"] == BRANCH
    assert payload["ref"]["commit"] == out.commit["commit_sha"]
    # Also: artefact.committed was emitted by the adapter underneath.
    assert any(e["type"] == "artefact.committed" for e in events.read())

    # The AgentRun mirrors what landed on the wire.
    assert out.run_id == "run-1"
    assert out.agent == "spec"
    assert out.artefact_kind == "functional_spec"
    assert out.frontmatter["maestro"]["feature"] == "csv-export"
    assert out.event_seq == producer["seq"]


def test_run_advances_projection_to_functional_gate(harness, events):
    """The spec.drafted event the harness emits opens the functional gate in the projection — so a
    decide_gate call could land immediately afterwards (the M1 #4 endpoint reads from this)."""
    agent, *_ = harness
    # The spec.drafted event needs a prior task to advance from. The harness alone doesn't dispatch.
    events.append(run_id="run-1", actor=ARCH, type="task.dispatched",
                  payload={"task_id": "run-1", "product_id": "maestro", "repo": REPO,
                           "intent": "Add CSV export"})
    agent.run(
        run_id="run-1", repo=REPO, branch=BRANCH,
        inputs={"task": {"task_id": "run-1"},
                "product": {"id": "maestro"},
                "intent": "Add CSV export"},
        feature_slug="csv-export",
    )
    state = project_task(events.read(), "run-1")
    assert state.stage == "functional_gate"
    assert "functional" in state.open_gates
    assert state.open_gates["functional"]["seq"] >= 2          # after task.dispatched


# --- input validation ----------------------------------------------------------------------------

def test_missing_required_input_is_rejected(harness):
    agent, *_ = harness
    with pytest.raises(InputRejected):
        agent.run("run-1", REPO, BRANCH,
                  inputs={"task": {}, "product": {}},     # missing 'intent'
                  feature_slug="csv-export")


def test_unknown_input_is_rejected(harness):
    """Catches a caller passing an input the prompt did not declare — the prompt is the contract."""
    agent, *_ = harness
    with pytest.raises(InputRejected):
        agent.run("run-1", REPO, BRANCH,
                  inputs={"task": {}, "product": {}, "intent": "x", "secret_knob": "no"},
                  feature_slug="csv-export")


def test_optional_input_can_be_omitted(harness, github_client):
    """``feedback_bundle?`` is optional — omitting it is the M1 first-draft case."""
    agent, *_ = harness
    agent.run("run-1", REPO, BRANCH,
              inputs={"task": {}, "product": {}, "intent": "x"},
              feature_slug="csv-export")
    assert (REPO, BRANCH, "docs/product/specs/csv-export.md") in github_client.files


# --- artefact validation -------------------------------------------------------------------------

def _run_with_response(text, harness):
    """Helper: replace the FakeProvider's response, run, return the raised ArtefactRejected."""
    agent, _, provider, _ = harness
    provider._resp.content[0].text = text
    return agent


def test_no_frontmatter_is_rejected(harness):
    agent = _run_with_response("# Just a markdown file\nNo frontmatter.\n", harness)
    with pytest.raises(ArtefactRejected) as ei:
        agent.run("run-1", REPO, BRANCH,
                  inputs={"task": {}, "product": {}, "intent": "x"},
                  feature_slug="csv-export")
    assert ei.value.reason == "no_frontmatter"


def test_no_maestro_block_is_rejected(harness):
    agent = _run_with_response(
        "---\ntitle: x\n---\n\n# body\n",
        harness,
    )
    with pytest.raises(ArtefactRejected) as ei:
        agent.run("run-1", REPO, BRANCH,
                  inputs={"task": {}, "product": {}, "intent": "x"},
                  feature_slug="csv-export")
    assert ei.value.reason == "no_maestro_block"


def test_wrong_kind_is_rejected(harness):
    """A spec agent producing a technical_design is the agent contract failing — not the harness."""
    artefact = _good_artefact().replace("kind: functional_spec", "kind: technical_design")
    agent = _run_with_response(artefact, harness)
    with pytest.raises(ArtefactRejected) as ei:
        agent.run("run-1", REPO, BRANCH,
                  inputs={"task": {}, "product": {}, "intent": "x"},
                  feature_slug="csv-export")
    assert ei.value.reason == "wrong_kind"


def test_wrong_feature_is_rejected(harness):
    """The harness pins ``feature_slug`` so the agent cannot drift onto a different artefact path."""
    agent = _run_with_response(_good_artefact(feature="something-else"), harness)
    with pytest.raises(ArtefactRejected) as ei:
        agent.run("run-1", REPO, BRANCH,
                  inputs={"task": {}, "product": {}, "intent": "x"},
                  feature_slug="csv-export")
    assert ei.value.reason == "wrong_feature"


def test_bad_feature_slug_is_rejected(harness):
    artefact = _good_artefact().replace("feature: csv-export", "feature: NotASlug")
    agent = _run_with_response(artefact, harness)
    with pytest.raises(ArtefactRejected) as ei:
        agent.run("run-1", REPO, BRANCH,
                  inputs={"task": {}, "product": {}, "intent": "x"})
    assert ei.value.reason == "bad_feature"


def test_missing_summary_is_rejected(harness):
    """ADR-0021: maestro.summary is required on functional_spec and technical_design."""
    artefact = _good_artefact()
    # Strip the summary block (everything from `summary:` to `---`).
    head, tail = artefact.split("  summary: |\n", 1)
    rest = tail.split("---", 1)[1]
    agent = _run_with_response(head + "---" + rest, harness)
    with pytest.raises(ArtefactRejected) as ei:
        agent.run("run-1", REPO, BRANCH,
                  inputs={"task": {}, "product": {}, "intent": "x"})
    assert ei.value.reason == "missing_summary"


def test_oversize_summary_is_rejected(harness):
    """The ≤120 words / ≤800 chars envelope (ADR-0021) is enforced at the harness boundary."""
    long = " ".join(["word"] * 150)
    artefact = _good_artefact().replace(
        "A CSV export endpoint that lets finance pull the last quarter's invoices\n    "
        "in one paged, RFC-4180-quoted file, up to 50000 rows per request.",
        long,
    )
    agent = _run_with_response(artefact, harness)
    with pytest.raises(ArtefactRejected) as ei:
        agent.run("run-1", REPO, BRANCH,
                  inputs={"task": {}, "product": {}, "intent": "x"})
    assert ei.value.reason == "oversize_summary"


def test_jargon_in_summary_is_rejected(harness):
    """ADR-0021: no AC ids, no EARS keywords, no code fences in the plain-language summary."""
    artefact = _good_artefact().replace(
        "A CSV export endpoint that lets finance pull the last quarter's invoices\n    "
        "in one paged, RFC-4180-quoted file, up to 50000 rows per request.",
        "AC-1 says WHEN you export THE SYSTEM SHALL produce a file.",
    )
    agent = _run_with_response(artefact, harness)
    with pytest.raises(ArtefactRejected) as ei:
        agent.run("run-1", REPO, BRANCH,
                  inputs={"task": {}, "product": {}, "intent": "x"})
    assert ei.value.reason == "jargon_in_summary"


def test_empty_body_is_rejected(harness):
    """A frontmatter-only file is not an artefact — the spec/design has a body the reviewer reads."""
    artefact = _good_artefact()
    head = artefact.split("---", 2)
    only_fm = "---" + head[1] + "---\n"
    agent = _run_with_response(only_fm, harness)
    with pytest.raises(ArtefactRejected) as ei:
        agent.run("run-1", REPO, BRANCH,
                  inputs={"task": {}, "product": {}, "intent": "x"})
    assert ei.value.reason == "empty_body"


# --- subclass-anchor enforcement ----------------------------------------------------------------

def test_unconfigured_subclass_is_rejected(spec_prompt, events, register, routing,
                                            github_client, audit, model_factory):
    """A subclass that does not set producer_event_type or artefact_kind cannot run — protect
    against a future agent slice forgetting either anchor."""
    from tests.conftest import _Resp
    model, _ = model_factory(audit, resp=_Resp(text=_good_artefact()))
    adapter = GitHubAdapter(events, register, routing, github_client)
    bare = Agent(spec_prompt, model, events, adapter)            # no subclass anchors
    with pytest.raises(NotImplementedError):
        bare.run("run-1", REPO, BRANCH,
                 inputs={"task": {}, "product": {}, "intent": "x"})


# --- user-message rendering --------------------------------------------------------------------

def test_user_message_renders_inputs_in_prompt_order(spec_prompt):
    """The harness's user message is deterministic — same inputs, same string — so an audit replay
    sees what the agent saw (ADR-0009)."""
    msg = _format_user_message(spec_prompt, {
        "intent": "Add CSV export",
        "task": {"task_id": "run-9c2e", "product_id": "maestro"},
        "product": {"id": "maestro", "product_type": "technical"},
    })
    # Order matches the prompt's inputs:, not the dict insertion order.
    pos_task = msg.index("## task")
    pos_product = msg.index("## product")
    pos_intent = msg.index("## intent")
    assert pos_task < pos_product < pos_intent
    # run_id surfaces in the header for the audit log.
    assert "run-9c2e" in msg
