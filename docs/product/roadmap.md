---
title: maestro roadmap — build it up, adopt it stepwise
status: draft
last_updated: 2026-05-25
owners: [architect]
related:
  - docs/product/prd/0001-architect-directed-delivery-loop.md
  - docs/product/feature-board.md
  - docs/architecture/overview.md
  - docs/architecture/components/orchestrator.md
  - docs/guides/onboarding-a-product.md
---

# maestro roadmap

How maestro goes from today's founding scaffold to a running, adopted platform — in two parallel tracks:

- a **build track** — constructing the engine milestone by milestone (M0–M4);
- an **adoption track** — a ladder of ways to *use* maestro that ramps from manual to fully automated, so value lands before the whole engine exists.

Today the repo is docs, config, and standards; the orchestrator, crew, adapters, `ModelClient`, and `ArtifactStore` are all `planned`. Six stacked PRs hold the foundation and the design.

## Phase 0 — land the foundation (now)

Before any engine code, close out what's already drafted.

1. **Merge the foundation stack, in order** (each PR is stacked on the previous; GitHub retargets to `main` as they land):

   | PR | Lands |
   |---|---|
   | #1 | Merge-boundary controls + consistency fixes + ADR-0008/0009/0010 |
   | #2 | EP-02 epic + the filled delivery-loop stories |
   | #3 | ADR-0011 multi-surface human control |
   | #4 | ADR-0012 ArtifactStore (ds1/MinIO) |
   | #5 | This roadmap |
   | #6 | LangGraph spike + ADR-0013 web control UI |

   Merging the proposed ADRs (0011/0012/0013) **is** their ratification.

2. **Resolve the deferred decisions** — these are gates into the build track:
   - ~~**Orchestration runtime**~~ — **Decided: LangGraph** ([ADR-0014](../architecture/decisions/0014-orchestration-runtime-langgraph.md)), validated by the [spike](../../spikes/langgraph/) (interrupt gates, crew/subagents, event-log-authoritative). The M0 gate is **cleared**.
   - **Functional surface direction** — decide [ADR-0013](../architecture/decisions/0013-web-control-ui-for-reviewers.md): web control UI vs Google-Docs-comments vs Telegram. Only blocking for M4, but it shapes US-0017.

3. **Lock the pre-M0 engineering choices** (table at the bottom).

## The MVP, in one sentence

**maestro autonomously carries one delivery task on a single _technical_ product — itself — from a Slack intent to a human-merged pull request, with the architect approving at each gate and every LLM call audited.**

### Why a technical product first (the key scoping move)

Routing sends every gate on a **technical** product to the **architect** ([ADR-0003](../architecture/decisions/0003-split-review-routing-matrix.md)), so the MVP needs only the **Slack** surface — taking two whole subsystems **off the critical path**:

- **Telegram + per-product bots** ([ADR-0011](../architecture/decisions/0011-multi-surface-human-control.md)) → deferred to M4.
- **ArtifactStore + presigned sharing** ([ADR-0012](../architecture/decisions/0012-artifact-storage-and-sharing.md)) → deferred to M4; specs/designs are Markdown in the PR until then.

The first product is **maestro itself** — dogfooding, a codebase the crew's authors know, no external blast radius.

## Build track — milestones

M0–M2 are the MVP. M3–M4 build on it. Story-level scope is on the [feature board](feature-board.md).

| Milestone | Goal | Stories | Exit criteria |
|---|---|---|---|
| **M0 — Foundation** | An audited model egress and a control plane that boots | US-0021, US-0020 (core), US-0001 | maestro boots, connects GitHub + Slack + Claude, **verifies it cannot merge**, records an LLM call in the event log |
| **M1 — Spec → design** | Intent becomes an approved spec and design, gated in Slack | US-0010, US-0012, US-0013, US-0017 (Slack) | A real intent yields an architect-approved functional spec (EARS) then an approved design; all state event-sourced and replayable |
| **M2 — Build → merge** | The rest of the loop; **this is the MVP** | US-0011, US-0014 | maestro implements on a `maestro/*` branch, opens a PR with green DoD, posts the merge gate; the architect merges; task `done` on the observed merge |
| **M3 — Hardening & quality** | Better-vetted PRs and a compliant audit trail | US-0015, US-0016, US-0022 (full) | Independent reviewer + docs agents on every PR; audit tier WORM + hash-chained with retention |
| **M4 — Commercial onboarding** | Onboard the first *commercial* product with external functional reviewers | functional surface (ADR-0011 / ADR-0013 — under revision), US-0023 (ArtifactStore), knowledge agent | A commercial product's functional gate reaches its reviewers on the chosen surface with artefact access; per-product isolation verified |

## Adoption track — the stepwise ladder

Each rung delivers value and depends only on what's beneath it — so you don't wait for the whole engine.

| Step | Available when | What you can do | Still manual |
|---|---|---|---|
| **0 — Manual pilot** | Phase 0 merged | Run maestro's *own* SDLC by hand on the maestro repo: specs/designs as Markdown PRs; the GitHub controls (branch protection, CODEOWNERS, merge-less token, `dod.yml`) already enforce *agents-propose / humans-merge*; a human or Claude Code plays the crew | Everything except the GitHub-native gates |
| **1 — Assisted** | after **M0** | Agents draft specs/designs via the `ModelClient`; gates post to Slack; state is event-sourced and recoverable | The human still drives stage to stage |
| **2 — Automated loop (dogfood)** | after **M2** | maestro runs a delivery task on **itself** end to end; architect approves in Slack, merges in GitHub | New work still framed by the architect |
| **3 — Second technical product** | after M2 | Register another *technical* product; same Slack-only surface — no Telegram/ArtifactStore needed | — |
| **4 — First commercial product** | after **M3/M4** | Onboard external **functional reviewers** on the chosen surface (web UI / Google Docs), with artefact sharing + hardened audit. **This is when external users come on.** | — |

> Onboarding mechanics per product (register entry, repo controls, surfaces) are in [`onboarding-a-product.md`](../guides/onboarding-a-product.md).

## Engineering decisions to lock before M0

The "deferred to engineering" questions from [PRD-0001](prd/0001-architect-directed-delivery-loop.md) and [`orchestrator.md`](../architecture/components/orchestrator.md):

| Decision | Direction |
|---|---|
| Orchestration runtime | **Decided: LangGraph** ([ADR-0014](../architecture/decisions/0014-orchestration-runtime-langgraph.md)) — durable execution + `interrupt()` gates; `ModelClient` stays the egress and the event log stays authoritative (ADR-0002/0008/0009). |
| Persistence | **SQLite** event store to start; Postgres when concurrency/recovery demand it (ADR-0008) |
| Runtime language | **Python** (per `CODEBASE.md`) |
| GitHub integration | Fine-grained **PAT scoped without merge** for the MVP; GitHub App later |
| Slack integration | **Socket Mode** for dev simplicity |
| `merge_gate` UX | Architect merges in **GitHub**; maestro posts the gate to Slack and observes the merge |

## Risks and constraints

- **Throughput is bounded by human merge** — by design (ADR-0004); the leverage is in spec/design/build.
- **Keep the no-merge boundary verified at first run** — load-bearing, not a config nicety.
- **MinIO durability** becomes real at M4 — erasure coding + an offsite backup before real artefacts land (ADR-0012).
- **Deferring Telegram + ArtifactStore** holds only while the first product is technical; M4 lifts it.
- **Runtime decided (LangGraph, ADR-0014) — M0 is unblocked.** The functional-surface decision (ADR-0013) remains open but only gates M4, not M0.
