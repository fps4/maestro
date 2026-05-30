# prompts

Agent prompt templates. **Read by the crew on every task** — the prompt the spec / design / reviewer / docs agent runs is the file in this directory, not a string embedded in Python.

This separation is principle 9 ([`docs/principles.md`](../../docs/principles.md)): the SDLC and the agents' behaviour are *standards*, not memory. Standards are files; files diff cleanly; PRs can review changes to agent behaviour without touching code.

## Convention

| Rule | Value |
|---|---|
| One file per agent | `<agent-name>.md` |
| Format | Markdown with YAML frontmatter |
| Loaded by | `orchestrator/agents/<agent>.py` via the agent harness (M1 work) |
| Editable by | architect / functional reviewer (non-coder edit path) |
| Reviewed via | PR diff like any other doc |

## Frontmatter shape

```yaml
---
agent: spec                       # spec | design | reviewer | docs | impl
model_tier: standard              # fast | standard | strong  (matches model/client.py)
max_output_tokens: 8000           # per-call budget; nullable to use the tier default
inputs:                           # what the harness must hand the agent (named, not free-form)
  - task                          # the DeliveryTask record
  - product                       # the product register entry
  - intent                        # the original dispatch text (spec) — or upstream artefact ref (design, reviewer)
  - feedback_bundle?              # OPTIONAL — present on a request_changes cycle (ADR-0020)
outputs:                          # what the agent must emit (validated at the harness boundary)
  - artefact_commit               # ref of the new commit on the maestro/* branch
  - agent_response?               # OPTIONAL — present iff feedback_bundle was an input (ADR-0022)
---
```

Then the prompt body — instructions, examples, constraints — in markdown. Keep it readable; the file is meant to be reviewed by humans, not just consumed by the LLM.

## M1 agents

| File | Status | Backs |
|---|---|---|
| [`spec-agent.md`](spec-agent.md)     | drafted 2026-05-29 | US-0010 |
| [`design-agent.md`](design-agent.md) | drafted 2026-05-29 | US-0013 |

## M2 agents

| File | Status | Backs |
|---|---|---|
| [`impl-agent.md`](impl-agent.md) | drafted 2026-05-30 | US-0011 |
| [`testgen-agent.md`](testgen-agent.md) | drafted 2026-05-30 | US-0014 |

## M3 agents

| File | Status | Backs |
|---|---|---|
| `reviewer-agent.md` | _to be written (M3)_ | US-0015 |
| `docs-agent.md` | _to be written (M3)_ | US-0016 |
