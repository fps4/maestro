"""Loader for `standards/prompts/<agent>.md` — frontmatter parsed into a typed :class:`Prompt`.

Covers the contract pinned in `standards/prompts/README.md`: agent enum, tier enum, optional
max_output_tokens, inputs/outputs lists with the trailing-``?`` optionality marker.
"""
import textwrap

import pytest

from orchestrator.agents.loader import (
    Prompt,
    PromptInvalid,
    PromptIO,
    _build_prompt,
    load_prompt,
)


def _meta(**over):
    base = {
        "agent": "spec",
        "model_tier": "standard",
        "max_output_tokens": 8000,
        "inputs": ["task", "product", "intent", "feedback_bundle?"],
        "outputs": ["artefact_commit", "agent_response?"],
    }
    base.update(over)
    return base


def test_io_parse_marks_trailing_question_as_optional():
    assert PromptIO.parse("task") == PromptIO(name="task", required=True)
    assert PromptIO.parse("feedback_bundle?") == PromptIO(name="feedback_bundle", required=False)
    # Whitespace tolerance — yaml may leave a trailing space.
    assert PromptIO.parse(" feedback_bundle? ") == PromptIO(name="feedback_bundle", required=False)


def test_build_prompt_happy_path():
    p = _build_prompt(_meta(), "# Spec agent\n\nYou produce a spec.\n", source="<test>")
    assert p.agent == "spec"
    assert p.model_tier == "standard"
    assert p.max_output_tokens == 8000
    assert p.required_inputs() == {"task", "product", "intent"}
    assert "feedback_bundle" in p.known_inputs()
    assert p.known_outputs() == {"artefact_commit", "agent_response"}
    assert p.body.startswith("# Spec agent")


def test_build_prompt_unknown_agent_is_rejected():
    with pytest.raises(PromptInvalid):
        _build_prompt(_meta(agent="seer"), "body", source="<test>")


def test_build_prompt_unknown_tier_is_rejected():
    with pytest.raises(PromptInvalid):
        _build_prompt(_meta(model_tier="lightning"), "body", source="<test>")


def test_build_prompt_max_tokens_nullable_but_typed():
    p = _build_prompt(_meta(max_output_tokens=None), "body", source="<test>")
    assert p.max_output_tokens is None
    with pytest.raises(PromptInvalid):
        _build_prompt(_meta(max_output_tokens=0), "body", source="<test>")
    with pytest.raises(PromptInvalid):
        _build_prompt(_meta(max_output_tokens="lots"), "body", source="<test>")


def test_build_prompt_outputs_must_have_at_least_one_entry():
    """An agent with no declared outputs is a silent LLM call — the harness has nothing to commit
    or emit. The contract requires at least one entry (typically ``artefact_commit``)."""
    with pytest.raises(PromptInvalid):
        _build_prompt(_meta(outputs=[]), "body", source="<test>")


def test_build_prompt_duplicate_inputs_rejected():
    with pytest.raises(PromptInvalid):
        _build_prompt(_meta(inputs=["task", "task"]), "body", source="<test>")


def test_build_prompt_inputs_must_be_strings():
    with pytest.raises(PromptInvalid):
        _build_prompt(_meta(inputs=[{"name": "task"}]), "body", source="<test>")


def test_build_prompt_empty_body_rejected():
    with pytest.raises(PromptInvalid):
        _build_prompt(_meta(), "\n\n   \n", source="<test>")


def test_load_prompt_file_round_trips(tmp_path):
    # Block style — the real prompts use this; YAML flow style ([a, b?]) chokes on the trailing
    # `?` because it is a reserved character in flow context. Block style is the only allowed
    # shape (worth knowing if you author a new prompt by hand).
    p = tmp_path / "spec-agent.md"
    p.write_text(textwrap.dedent("""\
        ---
        agent: spec
        model_tier: standard
        max_output_tokens: 4000
        inputs:
          - task
          - product
          - intent
          - feedback_bundle?
        outputs:
          - artefact_commit
          - agent_response?
        ---

        # Spec agent
        Body content stays exactly as written.
        """))
    loaded = load_prompt(p)
    assert loaded.body.startswith("# Spec agent")
    assert loaded.required_inputs() == {"task", "product", "intent"}


def test_load_prompt_missing_frontmatter_is_invalid(tmp_path):
    p = tmp_path / "no-fm.md"
    p.write_text("# Just a markdown file\n")
    with pytest.raises(PromptInvalid):
        load_prompt(p)


def test_load_prompt_missing_file_is_invalid(tmp_path):
    with pytest.raises(PromptInvalid):
        load_prompt(tmp_path / "absent.md")


# --- end-to-end against the real shipped prompts (standards/prompts/) ---------------------------

def test_real_spec_agent_prompt_loads():
    p = load_prompt("standards/prompts/spec-agent.md")
    assert p.agent == "spec"
    assert p.model_tier == "standard"
    assert {"task", "product", "intent"} <= p.required_inputs()
    assert "feedback_bundle" in p.known_inputs() and "feedback_bundle" not in p.required_inputs()
    assert "artefact_commit" in p.known_outputs()


def test_real_design_agent_prompt_loads():
    p = load_prompt("standards/prompts/design-agent.md")
    assert p.agent == "design"
    assert p.model_tier == "strong"
    assert {"task", "product", "spec_ref"} <= p.required_inputs()
    assert "proposed_adrs" in p.known_outputs()


# --- US-0024 M7: prompt provenance (template id + git blob SHA version) --------------------------

def test_loaded_prompt_carries_template_id_and_blob_sha(tmp_path):
    p = tmp_path / "spec-agent.md"
    p.write_text(textwrap.dedent("""\
        ---
        agent: spec
        model_tier: standard
        inputs:
          - task
        outputs:
          - artefact_commit
        ---

        # Spec agent
        body
        """))
    loaded = load_prompt(p)
    assert loaded.template_id == "spec-agent"
    assert len(loaded.template_version) == 40                      # git blob SHA is 40 hex chars
    assert all(c in "0123456789abcdef" for c in loaded.template_version)


def test_template_version_changes_iff_content_changes(tmp_path):
    def _write(body):
        f = tmp_path / "spec-agent.md"
        f.write_text("---\nagent: spec\nmodel_tier: standard\ninputs:\n  - task\n"
                     "outputs:\n  - artefact_commit\n---\n\n" + body)
        return load_prompt(f).template_version

    v1 = _write("# Spec\none")
    v1_again = _write("# Spec\none")
    v2 = _write("# Spec\ntwo")
    assert v1 == v1_again                                          # stable for identical bytes
    assert v1 != v2                                                # changes when the prompt changes


def test_blob_sha_matches_git_hash_object_vector():
    # `printf '' | git hash-object --stdin` → the well-known empty-blob SHA. Pins our local
    # computation to git's so the recorded version is the same id a reviewer can `git cat-file`.
    from orchestrator.agents.loader import _git_blob_sha
    assert _git_blob_sha("") == "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"


def test_real_spec_prompt_stamps_a_version():
    p = load_prompt("standards/prompts/spec-agent.md")
    assert p.template_id == "spec-agent"
    assert len(p.template_version) == 40
