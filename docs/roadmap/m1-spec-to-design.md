---
title: "M1 — Spec → design, in the workspace"
status: draft
last_updated: 2026-05-28
owners: [architect]
related:
  - docs/roadmap.md
  - docs/product/prd/0001-architect-directed-delivery-loop.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0010-draft-functional-spec.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0012-route-review-by-product-type.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0013-produce-technical-design.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0030-reviewer-webapp-and-wiki.md
  - docs/architecture/decisions/0014-orchestration-runtime-langgraph.md
  - docs/architecture/decisions/0016-merge-after-workspace-approval.md
  - docs/architecture/decisions/0018-workspace-read-api-and-frontmatter-index.md
---

## How to read this

Per-milestone scoping doc for **M1** as defined in [`roadmap.md`](../roadmap.md#build-track--milestones). The roadmap names *what* M1 ships; this doc decomposes it into user stories distributed across the **structural epics** under [`docs/product/user-stories/`](../product/user-stories/), defines dependency order, and lists the M1-specific open questions that surface in implementation.

Epics are **product-capability buckets that persist across milestones** — `EP-01-delivery-loop` outlives M1, M2, M3. Milestone slicing happens here, not in the epic structure. Each M1 story carries `milestone: M1` in its frontmatter; the same epics will accumulate `milestone: M2` stories when M2 opens.

M1 builds directly on the **M0 spine** (the audited `ModelClient`, the event-sourced `StateStore` + merge boundary, and the S1 read API). M1 turns that spine into the first two stages of the loop — **intent → approved functional spec → approved technical design** — with both gates *decided in the workspace* (steps **S2 Discuss** + **S3 Decide** of the [webapp concept](../architecture/webapp-concept.md)).

## M1 goal

A real intent yields a **workspace-approved** functional spec (EARS), then a workspace-approved technical design. Comments (S2) and gate decisions (S3) are recorded as events; all state is event-sourced and replayable (ADR-0008).

## M1 deliverables → user stories

The roadmap's M1 line maps to user stories as follows. Each row names the epic that owns the capability and the story id (repo-global, zero-padded per epic).

| Roadmap deliverable | Epic | Story |
|---|---|---|
| Spec agent: intent → functional spec (EARS), posted to the functional gate | `EP-01-delivery-loop` | [US-0010 — Draft a functional spec](../product/user-stories/EP-01-delivery-loop/US-0010-draft-functional-spec.md) (L) |
| Route each gate to the right reviewer by product type | `EP-01-delivery-loop` | [US-0012 — Route review by product type](../product/user-stories/EP-01-delivery-loop/US-0012-route-review-by-product-type.md) (M) |
| Architect/planner agent: approved spec → technical design + task list, posted to the design gate | `EP-01-delivery-loop` | [US-0013 — Produce a technical design](../product/user-stories/EP-01-delivery-loop/US-0013-produce-technical-design.md) (L) |
| Workspace **discuss + decide** (S2 + S3): per-gate comment thread and a role-authorized gate decision, both as events | `EP-03-reviewer-surface` | [US-0032 — Discuss and decide a gate in the workspace](../product/user-stories/EP-03-reviewer-surface/US-0032-workspace-discuss-and-decide-m1.md) (L; the M1 slice of US-0030 — S1 shipped in M0) |

**Cross-cutting engine work M1 must build** (rides under the stories above, not separate cards yet):

- **LangGraph stage-wiring** ([ADR-0014](../architecture/decisions/0014-orchestration-runtime-langgraph.md)) — the `spec` and `design` stages with `interrupt()` gates, on the M0 event log (already authoritative under it). Drives US-0010 + US-0013.
- **The workspace *write* path** — the S1 read API (`orchestrator/readapi.py`, read-only) gains a contract for **posting comments** and **recording gate decisions** as events, **extending the existing [`workspace-read-api.md`](../architecture/contracts/workspace-read-api.md) contract additively** (Q3 resolved, 2026-05-28). This is the orchestrator side of US-0032's acceptance criteria; the webapp consumes it. Per ADR-0008 the webapp holds no authoritative gate state — every comment and decision is an event.

## Dependency order

```
M0 spine (ModelClient · StateStore + merge boundary · S1 read API)   ← shipped
  ├── LangGraph stage-wiring (spec + design stages, interrupt() gates)
  │     ├── US-0010 (spec agent → functional spec → functional gate)
  │     │     └── US-0013 (planner agent → technical design → design gate)   ← depends on an approved spec
  │     └── US-0012 (gate routing)        ← both gates resolve their reviewer through this
  └── workspace write path (comments + decisions as events; extends workspace-read-api.md additively)
        └── US-0032 (discuss + decide in the workspace — M1 slice of US-0030)   ← consumes the write path; S1 read already live
```

**Parallel streams:**

- **Engine stream** — LangGraph stage-wiring + US-0012 routing develop against the M0 stores with a mocked `ModelClient` (contract layer, no network).
- **Agent stream** — US-0010 (spec agent) and US-0013 (planner agent) develop against fixture LLM responses; the real `ModelClient` egress already shipped in M0.
- **Surface stream** — US-0032 (the webapp discuss/decide UI, the M1 slice of US-0030) develops against the write-path contract; S1 read is already live on ds1.
- **Join** — a real intent driven end to end (intent → spec → functional gate → design → design gate) is the integration point.

## What M1 does NOT ship

Explicitly carved out — keeps scope tight at review time:

- **Build → merge** — M2. No implementation, no PR opening, no merge execution (US-0011, US-0014, US-0023). The ADR-0016 merge boundary stays as M0 shipped it: it refuses without an approval event, but no M1 flow reaches it.
- **The authenticated edge** — M3. M1 runs behind the M0 **dev-stub identity** (`MAESTRO_DEV_IDENTITY`, ADR-0019); `component-auth` over the Cloudflare Tunnel/Access lands in M3. US-0030's auth acceptance criteria are satisfied by the dev stub in M1 and by the real edge in M3.
- **Artefacts browser (S4) + inbox (S6)** — M2 / M3.
- **Independent reviewer + docs agents** — M3 (US-0015, US-0016).
- **Group-decision semantics across multiple role-holders** — US-0017; M1 assumes the single architect deciding their own technical product.

If any of these creep into an M1 PR, the PR is out of scope — open a follow-up story in the relevant epic instead.

## What M1 proves

- **[ADR-0014](../architecture/decisions/0014-orchestration-runtime-langgraph.md)** — LangGraph `interrupt()` gates work on the event-authoritative log: a stage pauses for a human gate decision and resumes from the recorded event.
- **[ADR-0016](../architecture/decisions/0016-merge-after-workspace-approval.md) (gate half)** — a gate decision made *in the workspace* is recorded as an attributed event and resolves the stage; the same event mechanism will authorize the merge in M2.
- **[ADR-0018](../architecture/decisions/0018-workspace-read-api-and-frontmatter-index.md) extends to writes** — the workspace can both read (S1) and write (S2/S3) through the orchestrator without holding authoritative state.
- **The spec/design agents produce gate-ready artefacts** — EARS acceptance criteria a tester (or US-0014's test agent, M2) can derive scenarios from.

## Definition of "M1 complete"

M1 is complete when, against the **maestro product itself** (the dogfood technical product):

1. An architect-submitted intent produces a functional spec with EARS acceptance criteria, posted to the functional gate **in the workspace**.
2. The architect **discusses (S2) and approves (S3)** the spec in the workspace; the decision is an attributed event.
3. The approved spec yields a technical design + ordered task list, posted to the design gate; the architect approves it the same way.
4. All of the above is **event-sourced and replayable** — re-running the projection reconstructs the task's stage and both gate decisions.

M1 completion is **not** the MVP. The MVP (adoption rung 2) requires M2 — build → PR → workspace-approved merge that maestro executes.

## Open questions specific to M1

| Question | Owner | Status |
|---|---|---|
| **Surface re-anchoring.** US-0010/US-0012 were written Slack-first ("submits a Slack message"; architect → Slack, functional_reviewer → Telegram). The re-baseline makes the **workspace** the M1 surface. Re-anchor these stories to workspace intake + workspace gates before they're `accepted`, or keep Slack intake and only move the *gate decision* to the workspace? | @architect | **Resolved 2026-05-28.** Workspace is the gate surface (S2/S3) and the default intake surface; Slack/Telegram are notification channels only (EP-04, M3). US-0010 and US-0012 re-anchored accordingly. |
| **Intent intake mechanism.** With Telegram/Slack off the M1 critical path, how does the architect submit intent — a workspace "new task" affordance, or a CLI/`maestro` command seeding the event log? | @architect | **Resolved 2026-05-28** (at US-0010 acceptance). A **minimal workspace "new task" affordance** — single form (product + free-text description) posting to the orchestrator's dispatch endpoint. Keeps every interaction on one surface from the start; a `maestro` CLI seed remains a valid ops back-door but is not the M1 critical-path intake. |
| **Write-path contract shape.** Does the comment/decision write path extend the existing read API contract ([`workspace-read-api.md`](../architecture/contracts/workspace-read-api.md)) or get its own contract doc? | @architect | **Resolved 2026-05-28.** Extend the existing contract additively (the contract doc already names S2/S3 as "extend the same base, additively"). One workspace ↔ orchestrator surface. |
| **US-0030 split.** The roadmap says US-0030 will split into per-step stories (S1…S6). Split out the S2/S3 slice as its own story (e.g. US-0031) for M1, or carry US-0030 with a `milestone` span? | @architect | **Resolved 2026-05-28.** Split landed as [US-0032](../product/user-stories/EP-03-reviewer-surface/US-0032-workspace-discuss-and-decide-m1.md) (US-0031 was used for the UX-design story); US-0030 stays as the multi-milestone umbrella. S4/S6 will split out as their milestones open. |
