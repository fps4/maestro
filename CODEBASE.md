# Codebase overview

maestro is an architect-directed agentic delivery platform: a crew of Claude-powered agents that take a unit of work from intent → functional spec → technical design → implementation → reviewed pull request on real GitHub, coordinated through Slack (architects) and Telegram (functional reviewers), with the right human approving at each gate. Work is organised around a **product** — one or more repositories and one or more human participants.

> **Status:** founding scaffold. The directory map below describes the *intended* structure; today only `docs/`, `config/`, and `standards/` exist. No agent code has been written yet.

## Directory map

| Path | Purpose |
|------|---------|
| `docs/` | Product intent, architecture, ADRs, and guides — the source of truth that precedes code |
| `standards/` | Machine-readable SDLC standards injected into agent prompts (naming, testing, security, docs) |
| `config/reviewers.yaml` | The split-review routing matrix: product type × gate → reviewer (public template) |
| `config/products.yaml` | Your **private** product register — gitignored; only `products.example.yaml` is public (ADR-0010) |
| `logs/test_reports/` | Timestamped acceptance-test evidence (git-ignored except README) |
| `.github/` | Merge-boundary enforcement: CODEOWNERS, PR template, the `dod` quality-gate workflow (see `docs/guides/repo-controls.md`) |
| `orchestrator/` | *(planned)* Sequences agents and owns gate state; performs no LLM inference |
| `agents/` | *(planned)* The crew — spec, architect, builder, test, reviewer, docs; LLM logic lives here |
| `model/` | *(planned)* The single `ModelClient` — the only place that calls Claude; records cost + audit |
| `adapters/github/` | *(planned)* GitHub integration — branches, PRs, Actions, Issues/Projects |
| `adapters/slack/` | *(planned)* Slack adapter — the **architect** surface: intent intake + architect-gate approvals |
| `adapters/telegram/` | *(planned)* Telegram adapter — the **functional-reviewer** surface: one bot + group per product (ADR-0011) |

## Entry points

- **Human intent (in):** Slack message (architect) → `adapters/slack/` → orchestrator *(planned)*
- **Human approval (in):** an architect's Slack action, or a functional reviewer's Telegram in-group action → orchestrator gate resolution; any role-holder in the group may decide (ADR-0011) *(planned)*
- **Work output (out):** GitHub pull request opened by the builder agent via `adapters/github/` *(planned)*
- **LLM calls:** every agent → `model/ModelClient` → Anthropic API (native prompt caching, extended thinking, tool use); every call is recorded to the audit log

## Naming notes

- **product** — the unit of work: one or more repos, one or more human participants, one `product_type` (`commercial` | `technical`). The architect is always a participant.
- **delivery task** — one unit of work inside a product, targeting one repo, moving through the loop.
- **gate** — a point where the pipeline pauses for a human decision. Two: functional (pre-code) and technical (design, and merge).
- **functional vs technical review** — the two review types; who performs each is resolved by `config/reviewers.yaml`.
- **the conductor** — informal name for the orchestrator. maestro conducts; agents play.

## Intentionally out of scope

- Building self-hosted apps for end users — maestro builds products *for the architect*, not for a layperson.
- Autonomous merge — humans merge; see `docs/architecture/decisions/0004-agents-propose-via-pr-humans-merge.md`.
- A bespoke web UI — the human surfaces are Slack, Telegram, and GitHub's own UI.
