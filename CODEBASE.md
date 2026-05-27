# Codebase overview

maestro is an architect-directed agentic delivery platform: a crew of Claude-powered agents that take a unit of work from intent → functional spec → technical design → implementation → reviewed pull request on real GitHub, coordinated through Slack (architects) and Telegram (functional reviewers), with the right human approving at each gate. Work is organised around a **product** — one or more repositories and one or more human participants.

> **Status:** the **M0 engine spine** has landed — the first real engine code. Built and tested: the audited `ModelClient` egress (`model/`), the event-sourced `StateStore` (hash-chained event log + projection) and fail-fast boot (`orchestrator/`), and the GitHub adapter's event-gated merge boundary (`adapters/github/`). Still `planned`: the crew (`agents/`), the `ArtifactStore` (`storage/`), the Slack/Telegram adapters, and the LangGraph wiring of the delivery-loop stages (the event log is already authoritative under it — ADR-0014). `docs/`, `config/`, `standards/`, the reviewer `web/` app, and `infra/docker/` exist as before.

## Directory map

| Path | Purpose |
|------|---------|
| `docs/` | Product intent, architecture, ADRs, and guides — the source of truth that precedes code |
| `standards/` | Machine-readable SDLC standards injected into agent prompts (naming, testing, security, docs) |
| `config/reviewers.yaml` | The split-review routing matrix: product type × gate → reviewer (public template) |
| `config/products.yaml` | Your **private** product register — gitignored; only `products.example.yaml` is public (ADR-0010) |
| `logs/test_reports/` | Timestamped acceptance-test evidence (git-ignored except README) |
| `.github/` | Merge-boundary enforcement: CODEOWNERS, PR template, the `dod` quality-gate workflow (see `docs/guides/repo-controls.md`) |
| `orchestrator/` | The conductor: the event-sourced `StateStore` (hash-chained event log + projection), register loader, `RoutingResolver`, fail-fast boot + CLI. Owns gate state; performs no LLM inference. *(LangGraph stage-wiring planned — ADR-0014)* |
| `agents/` | *(planned)* The crew — spec, architect, builder, test, reviewer, docs; LLM logic lives here |
| `model/` | The single `ModelClient` — the only place that calls Claude (tier-selected, `base_url`-configurable); records per-call cost + audit (ADR-0002/0009) |
| `storage/` | *(planned)* The single S3-compatible `ArtifactStore` — stores artefacts (specs, designs, test reports, SBOMs) and mints short-TTL presigned share links; MinIO on ds1 by default, AWS S3 per-product opt-in (ADR-0012) |
| `adapters/github/` | GitHub integration — branches, PRs, and the **event-gated merge** that refuses without a valid, role-authorized, unconsumed approval event (ADR-0016). *(Actions, Issues/Projects planned)* |
| `tests/` | The engine test suite (pytest) — contract layer: mocked LLM, no network |
| `adapters/slack/` | *(planned)* Slack adapter — the **architect** surface: intent intake + architect-gate approvals |
| `adapters/telegram/` | *(planned)* Telegram adapter — an *optional* functional-reviewer surface (ADR-0011; demoted by ADR-0015) |
| `web/` | The **reviewer webapp** — read specs, discuss, decide gates (ADR-0015 / US-0030); MIT/open base (shadcn/ui + Next.js). A surface, not the system of record |
| `infra/docker/` | Deployment stack (Compose) — sibling to the other fps4 stacks on ds1; today runs `web/` |

## Entry points

- **Human intent (in):** Slack message (architect) → `adapters/slack/` → orchestrator *(planned)*
- **Human approval (in):** an architect's Slack action, or a functional reviewer's Telegram in-group action → orchestrator gate resolution; any role-holder in the group may decide (ADR-0011) *(planned)*
- **Work output (out):** GitHub pull request opened by the builder agent via `adapters/github/` *(planned)*
- **Artefact sharing (out):** an agent's artefact → `storage/ArtifactStore` → short-TTL presigned URL posted to the reviewer's surface (ADR-0012) *(planned)*
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
- A bespoke web UI *for architects* — architects work in Slack + GitHub. Functional reviewers, however, get a maestro-owned chat webapp + a repo-linked docs wiki (ADR-0015); the repo stays the source of truth (ADR-0008).
