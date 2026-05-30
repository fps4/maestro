"""Load and validate a `standards/prompts/<agent>.md` file (see `standards/prompts/README.md`).

The prompt file is the **standard** the crew reads on every task (principle 9): YAML frontmatter
names the agent, the model tier, the per-call output budget, the inputs the harness must hand in,
and the outputs the harness will validate. The body is the system prompt the LLM reads.

Keeping this parsing in one place means the prompt contract is exercised by a single test surface
and the `standards/prompts/README.md` table of M1/M3 agents stays the authoritative source for what
shapes are legal — there is no hidden second contract embedded in code.
"""
import hashlib
import pathlib
from dataclasses import dataclass
from typing import Optional, Union

from orchestrator.specindex import parse_frontmatter

# Allowed model tiers (model/client.py — must stay aligned; the loader validates against this set
# rather than importing ModelClient so the loader is testable without a model dependency).
_TIERS = {"fast", "standard", "strong"}

# Allowed agent names (standards/prompts/README.md). Adding one is adding the agent's prompt file
# and a row in the README — the loader's set is the gate that flags an unknown agent at load time.
_AGENTS = {"spec", "design", "reviewer", "docs", "impl"}


class PromptInvalid(Exception):
    """The prompt file's frontmatter does not honour the contract in
    `standards/prompts/README.md`. Surfaced at load time so the misconfigured prompt fails fast
    at boot, not silently mid-task."""


@dataclass(frozen=True)
class PromptIO:
    """One named input or output entry from the prompt's ``inputs:`` / ``outputs:`` block.

    The contract uses a trailing ``?`` to mark optional entries (e.g. ``feedback_bundle?``); we
    parse that off so the harness can check ``required`` without re-parsing the string.
    """
    name: str
    required: bool

    @classmethod
    def parse(cls, raw: str) -> "PromptIO":
        raw = raw.strip()
        if raw.endswith("?"):
            return cls(name=raw[:-1].strip(), required=False)
        return cls(name=raw, required=True)


@dataclass(frozen=True)
class Prompt:
    """The loaded prompt — frontmatter + body, with the body usable verbatim as the system prompt."""
    agent: str                       # spec | design | reviewer | docs | impl
    model_tier: str                  # fast | standard | strong
    max_output_tokens: Optional[int]
    inputs: tuple[PromptIO, ...]
    outputs: tuple[PromptIO, ...]
    body: str                        # the system prompt the LLM reads (markdown after frontmatter)
    # US-0024 M7: prompt provenance stamped onto every LLM call this prompt drives (ADR-0009/0014).
    template_id: str = ""            # stable logical id, e.g. 'spec-agent'
    template_version: str = ""       # git blob SHA of the prompt file — changes iff the file changes

    def required_inputs(self) -> set[str]:
        return {io.name for io in self.inputs if io.required}

    def known_inputs(self) -> set[str]:
        return {io.name for io in self.inputs}

    def known_outputs(self) -> set[str]:
        return {io.name for io in self.outputs}


def load_prompt(path: Union[str, pathlib.Path]) -> Prompt:
    """Load and validate one prompt file. Raises :class:`PromptInvalid` if anything is off; the
    caller (the boot path, or a test) decides whether to log and continue or abort.

    The body is the markdown *after* the closing ``---`` of the frontmatter, returned exactly as
    written (no trimming) so heading anchors and indentation in the prompt survive.
    """
    p = pathlib.Path(path)
    if not p.exists():
        raise PromptInvalid(f"prompt file not found: {p}")
    text = p.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)
    if meta is None:
        raise PromptInvalid(f"{p}: no YAML frontmatter block")
    return _build_prompt(meta, body, source=str(p),
                         template_id=p.stem, template_version=_git_blob_sha(text))


def _git_blob_sha(text: str) -> str:
    """The git blob SHA of ``text`` — the same id ``git hash-object`` produces, computed locally so
    no git invocation or commit is needed. It changes iff the prompt's bytes change, which is exactly
    the "which version of the prompt" identity US-0024 M7 wants for replay/traceability."""
    data = text.encode("utf-8")
    blob = b"blob " + str(len(data)).encode("ascii") + b"\x00" + data
    return hashlib.sha1(blob).hexdigest()


def _build_prompt(meta: dict, body: str, *, source: str,
                  template_id: str = "", template_version: str = "") -> Prompt:
    """Validate ``meta`` against the prompt contract (`standards/prompts/README.md`)."""
    agent = meta.get("agent")
    if agent not in _AGENTS:
        raise PromptInvalid(
            f"{source}: agent must be one of {sorted(_AGENTS)!r}; got {agent!r}"
        )
    tier = meta.get("model_tier")
    if tier not in _TIERS:
        raise PromptInvalid(
            f"{source}: model_tier must be one of {sorted(_TIERS)!r}; got {tier!r}"
        )
    max_tokens = meta.get("max_output_tokens")
    if max_tokens is not None and (not isinstance(max_tokens, int) or max_tokens <= 0):
        raise PromptInvalid(
            f"{source}: max_output_tokens must be a positive integer or null; got {max_tokens!r}"
        )
    inputs = _parse_io_list(meta.get("inputs"), field="inputs", source=source)
    outputs = _parse_io_list(meta.get("outputs"), field="outputs", source=source)
    if not outputs:
        # An agent with no outputs would be a silent LLM call — nothing for the harness to commit
        # or emit. The contract requires at least one output (typically ``artefact_commit``).
        raise PromptInvalid(f"{source}: outputs must declare at least one entry")
    body = body.lstrip("\n")
    if not body.strip():
        raise PromptInvalid(f"{source}: prompt body is empty")
    return Prompt(agent=agent, model_tier=tier, max_output_tokens=max_tokens,
                  inputs=inputs, outputs=outputs, body=body,
                  template_id=template_id or f"{agent}-agent", template_version=template_version)


def _parse_io_list(raw, *, field: str, source: str) -> tuple[PromptIO, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise PromptInvalid(f"{source}: {field} must be a YAML list; got {type(raw).__name__}")
    seen: set[str] = set()
    out: list[PromptIO] = []
    for item in raw:
        if not isinstance(item, str):
            raise PromptInvalid(
                f"{source}: {field} entries must be strings; got {item!r}"
            )
        io = PromptIO.parse(item)
        if not io.name:
            raise PromptInvalid(f"{source}: {field} entry must have a name; got {item!r}")
        if io.name in seen:
            raise PromptInvalid(
                f"{source}: duplicate {field} entry {io.name!r}"
            )
        seen.add(io.name)
        out.append(io)
    return tuple(out)
