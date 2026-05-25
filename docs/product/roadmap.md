---
title: Engine MVP and delivery roadmap
status: draft
last_updated: 2026-05-25
owners: [architect]
related:
  - docs/product/prd/0001-architect-directed-delivery-loop.md
  - docs/product/feature-board.md
  - docs/architecture/overview.md
  - docs/architecture/components/orchestrator.md
---

# Engine MVP and delivery roadmap

Sequences the EP-00/01/02 user stories into a buildable MVP — the thinnest end-to-end loop that
delivers real value — and the phases after it. Today maestro is a founding scaffold: docs, config,
and standards, with the orchestrator, crew, adapters, `ModelClient`, and `ArtifactStore` all
`planned`. This is the plan to make the loop actually run.

## The MVP, in one sentence

**maestro autonomously carries one delivery task on a single _technical_ product — itself — from a
Slack intent to a human-merged pull request, with the architect approving at each gate and every
LLM call audited.**

## Why a technical product first (the key scoping move)

Routing sends every gate on a **technical** product to the **architect** ([ADR-0003](../architecture/decisions/0003-split-review-routing-matrix.md)).
So the MVP needs only the **Slack** surface — which takes two whole subsystems **off the critical path**:

- **Telegram + per-product bots** ([ADR-0011](../architecture/decisions/0011-multi-surface-human-control.md)) — only needed when a *commercial* product brings external functional reviewers. → deferred to M4.
- **ArtifactStore + presigned sharing** ([ADR-0012](../architecture/decisions/0012-artifact-storage-and-sharing.md)) — only needed to share artefacts with those external reviewers. For the MVP, specs/designs live as Markdown in the PR/repo. → deferred to M4.

The first product is **maestro itself** (already the technical product in the register): dogfooding,
a codebase the crew's authors know, and no external blast radius.

## Scope

**In the MVP**

- `ModelClient` (US-0021) — direct Anthropic API, prompt caching, a per-call cost/audit record.
- Orchestrator + event-sourced store on **SQLite** (US-0020) — the task/gate state machine and the
  append-only event log; this same log is the **minimal** audit trail (US-0022, minimal slice).
- **GitHub adapter** — open a `maestro/*` branch + PR, observe the merge; the **merge-less** token
  boundary (US-0001, ADR-0004).
- **Slack adapter** — the architect surface: intent in, gate approvals (buttons), status.
- Routing (US-0012) + group approval in its **Slack-only** form (US-0017 subset: post to the
  architect channel, any architect approves).
- Crew, minimum: **spec** (US-0010), **architect/planner** (US-0013), **builder** (US-0011),
  **test** (US-0014, minimal — generate + run spec-derived tests, coverage check).
- DoD gates on the PR (the existing `.github/workflows/dod.yml` floors + tests); merge gate to the
  architect; task `done` on the observed merge event.

**Out of the MVP (deferred — see milestones M3–M4)**

- Telegram adapter + per-product bots (ADR-0011); ArtifactStore + presigned sharing (ADR-0012).
- reviewer agent (US-0015), docs agent (US-0016), knowledge/context agent.
- Audit hardening (US-0022 full: WORM + hash-chain + redaction + retention).
- Risk tiers / graduated autonomy (principle 10), multi-repo-per-feature, Postgres cutover.

## Milestones

M0–M2 are the MVP. M3–M4 build on it.

| Milestone | Goal | Stories | Exit criteria |
|---|---|---|---|
| **M0 — Foundation** | An audited model egress and a control plane that boots | US-0021, US-0020 (core), US-0001 | maestro boots, connects GitHub + Slack + Claude, **verifies it cannot merge**, and records an LLM call in the event log |
| **M1 — Spec → design** | Intent becomes an approved spec and design, gated in Slack | US-0010, US-0012, US-0013, US-0017 (Slack) | A real intent yields an architect-approved functional spec (EARS) then an approved design; all state event-sourced and replayable |
| **M2 — Build → merge** | The rest of the loop; **this is the MVP** | US-0011, US-0014 | maestro implements on a `maestro/*` branch, opens a PR with green DoD, posts the merge gate; the architect merges; task marked `done` on the observed merge |
| **M3 — Hardening & quality** | Better-vetted PRs and a compliant audit trail | US-0015, US-0016, US-0022 (full) | Independent reviewer + docs agents run on every PR; audit tier is WORM + hash-chained with retention |
| **M4 — Commercial onboarding** | Onboard the first *commercial* product with external functional reviewers | functional surface (ADR-0011 / **ADR-0013** — under revision toward a web control UI + Google Docs), US-0023 (ArtifactStore), knowledge agent | A commercial product's functional gate reaches its reviewers on the chosen surface with artefact access; per-product isolation verified |

## Engineering decisions to lock before M0

These are the "deferred to engineering" questions in [PRD-0001](prd/0001-architect-directed-delivery-loop.md)
and [`orchestrator.md`](../architecture/components/orchestrator.md). Recommended MVP answers:

| Decision | Recommendation for the MVP |
|---|---|
| Crew foundation / orchestration runtime | **Deferred — prototyping [LangGraph](../../spikes/langgraph/)** (durable execution + `interrupt()` gates) vs Claude Agent SDK vs bespoke. The `ModelClient` boundary holds either way (ADR-0002); write the runtime ADR after the spike. |
| Persistence | **SQLite** event store to start; Postgres cutover when concurrency/recovery demand it (ADR-0008) |
| Runtime | **Python** (the planned runtime per `CODEBASE.md`) |
| GitHub integration | A fine-grained **PAT scoped without merge** for the MVP; a GitHub App later |
| Slack integration | **Socket Mode** for dev simplicity |
| `merge_gate` UX | Architect merges in **GitHub**; maestro posts the gate to Slack and observes the merge (the open PRD-0001 question) |

## Risks and constraints

- **Throughput is bounded by human merge** — by design (ADR-0004); the leverage is in spec/design/build, not in removing the merge.
- **Keep the no-merge boundary verified at first run** — it is load-bearing, not a config nicety.
- **MinIO durability** becomes real at M4 — needs erasure coding + an offsite backup before real artefacts land (ADR-0012).
- Deferring Telegram + ArtifactStore is the biggest scope saver and is only valid while the first product is technical; M4 lifts that.

## After the MVP

Once M2 ships, maestro builds maestro. M3 raises PR quality and audit posture; M4 unlocks commercial
products and external functional reviewers. Live story status is the [feature board](feature-board.md).
