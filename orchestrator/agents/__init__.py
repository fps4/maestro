"""The maestro agent harness — one place every crew agent runs through.

A crew agent (spec, design, reviewer, docs, impl — `standards/prompts/README.md`) is a thin Python
file that names its prompt + its producer event; the harness here handles input validation, the
single `ModelClient` call (ADR-0002), parsing the artefact out of the model response, validating
its `maestro:` frontmatter (ADR-0018 + ADR-0021), committing it to a `maestro/*` branch via
:class:`adapters.github.adapter.GitHubAdapter`, and emitting the producer event into the
append-only log (ADR-0008/0009).

This package is deliberately **agent-agnostic**: it ships the harness + a prompt loader + typed
errors. The concrete spec / design agents land in follow-up slices, each ~30 lines because the
harness owns everything reusable.
"""
from orchestrator.agents.base import Agent, AgentRun, ArtefactRejected, InputRejected
from orchestrator.agents.design import DesignAgent, run_design_for_run
from orchestrator.agents.loader import Prompt, PromptIO, load_prompt
from orchestrator.agents.spec import SpecAgent, run_spec_for_run

__all__ = [
    "Agent", "AgentRun", "ArtefactRejected", "InputRejected",
    "Prompt", "PromptIO", "load_prompt",
    "SpecAgent", "run_spec_for_run",
    "DesignAgent", "run_design_for_run",
]
