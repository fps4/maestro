---
title: maestro roadmap — build it up, adopt it stepwise
status: current
last_updated: 2026-05-29
owners: [architect]
related:
  - docs/product/prd/0001-architect-directed-delivery-loop.md
  - docs/roadmap/m1-spec-to-design.md
  - docs/product/user-stories/
  - docs/architecture/overview.md
  - docs/architecture/webapp-concept.md
  - docs/architecture/components/orchestrator.md
  - docs/architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - docs/architecture/decisions/0016-merge-after-workspace-approval.md
  - docs/guides/onboarding-a-product.md
---

# maestro roadmap

How maestro goes from today's founding scaffold to a running, adopted platform — in two parallel tracks:

- a **build track** — constructing the engine *and its one human surface, the maestro workspace*, milestone by milestone (M0–M4);
- an **adoption track** — a ladder of ways to *use* maestro that ramps from manual to fully automated, so value lands before the whole engine exists.

Today the repo is docs, config, standards, and a **webapp scaffold** (`web/`); the orchestrator, crew, adapters, `ModelClient`, and `ArtifactStore` are all `planned`.

## How to read this

This roadmap stays **milestone-level only**. It names *what* each milestone ships, what it proves, and how the milestones sequence — it does **not** decompose milestones into user stories. Speculative per-story decomposition for later milestones gets stale faster than it pays off.

When a milestone **opens for engineering**, its scoping doc lands at [`docs/roadmap/<milestone>.md`](roadmap/) and decomposes the milestone into user stories distributed across the **structural epics** under [`docs/product/user-stories/`](product/user-stories/). Epics are product-capability buckets that **persist across milestones** (`EP-01-delivery-loop` outlives M1, M2, …); milestone slicing happens in the scoping doc, not in the epic structure. Each story carries `milestone: M<n>` in its frontmatter, so the same epic accumulates stories as milestones open.

Per-story build/review status is **not** tracked in a markdown board — it lives in the **maestro workspace** (the UI), read from each story's `status:` frontmatter and the event-log status (ADR-0018). The lifecycle (`draft → accepted → in-progress → done → blocked`) is unchanged; only the surface moved. `draft → accepted` stays human-only (the architect locks scope); `in-progress → done` stays CI-only on a green merge.

**Currently open scoping docs:**

| Milestone | Goal | Scoping doc | Status |
|---|---|---|---|
| M0 | Foundation + surface backbone | — (predates this convention) | **✅ closed 2026-05-27** — spine + S1 read API shipped on ds1; GitHub + Claude verified live |
| M1 | Spec → design, in the workspace | [`roadmap/m1-spec-to-design.md`](roadmap/m1-spec-to-design.md) | **✅ closed 2026-05-29** — spec & design agents on LangGraph; gates decided in the workspace with `If-Match`; refinement loop closes via `agent_response.posted` (ADR-0020/0022); US-0010/0012/0013/0032 done |
| M2 | Build → merge (the MVP) | [`roadmap/m2-build-to-merge.md`](roadmap/m2-build-to-merge.md) | **accepted; open for engineering** — scoping accepted 2026-05-29 with all 8 open questions resolved; stories US-0011, US-0014, US-0023, US-0033 accepted |
| M3 | Hardening, quality & the inbox | not yet written | open when M2 exits |
| M4 | Commercial onboarding | not yet written | open when M3 exits |

> **Re-baselined (2026-05-27).** This roadmap previously scoped the MVP to a **Slack-only** surface and deferred the webapp + ArtifactStore to M4. Two decisions inverted that: the **maestro workspace** is now the primary human surface for *all* roles and both spec types ([`webapp-concept.md`](architecture/webapp-concept.md), extending [ADR-0015](architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md)); and the **merge happens after a workspace approval**, executed by maestro against a recorded approval event ([ADR-0016](architecture/decisions/0016-merge-after-workspace-approval.md)). The webapp now builds up across M0–M3 in steps (S1–S6 from the concept); Telegram leaves the critical path.

> **M0 closed (2026-05-27).** All M0 exit criteria are met: the spine landed (`ModelClient`, event-sourced `StateStore`, the ADR-0016 merge boundary), the S1 read API + Specs view shipped and deployed on ds1, and the **GitHub + Claude connections are verified live** (`maestro boot --probe` → GitHub `/user` as `fgurbanov`; a 1-token Claude call on `claude-haiku-4-5`, recorded to the audit). **The authenticated edge moved out of M0 to M3** (architect decision): M0 ships the workspace behind a **dev-stub identity** (`MAESTRO_DEV_IDENTITY`, ADR-0019), and `component-auth` over the Cloudflare Tunnel/Access lands in M3 alongside the per-participant inbox (S6) that needs it. This keeps M0 to the engine + read surface and defers the auth build to where a real participant identity is first required.

## Phase 0 — land the foundation (now)

Before the engine code, close out what's already drafted.

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

2. **Deferred decisions — now resolved** (the gates into the build track):
   - ~~**Orchestration runtime**~~ — **LangGraph** ([ADR-0014](architecture/decisions/0014-orchestration-runtime-langgraph.md)), spike-validated (interrupt gates, crew/subagents, event-log-authoritative). The M0 gate is **cleared**.
   - ~~**Functional surface direction**~~ — **the maestro workspace** ([ADR-0015](architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md) + [`webapp-concept.md`](architecture/webapp-concept.md)), superseding the ADR-0013 options. It is now the **primary** surface for all roles — not a deferred M4 add-on.
   - ~~**Merge model**~~ — **merge after workspace approval** ([ADR-0016](architecture/decisions/0016-merge-after-workspace-approval.md)): the human decides in the workspace; maestro executes the merge against the recorded approval event (single-layer — the event is the sole authority).

3. **Lock the pre-M0 engineering choices** (table at the bottom).

## The MVP, in one sentence

**maestro autonomously carries one delivery task on a single _technical_ product — itself — from intent in the maestro workspace, through workspace-decided gates, to a workspace-approved merge that maestro executes — with every gate decision attributed and every LLM call audited.**

### Why a technical product first (the key scoping move)

Routing sends every gate on a **technical** product to the **architect** ([ADR-0003](architecture/decisions/0003-split-review-routing-matrix.md)), so the MVP needs only **one human** — the architect — and **no external functional reviewers** yet. The first product is **maestro itself**: dogfooding, a codebase the crew's authors know, no external blast radius.

What the re-baseline changed: the surface is the **maestro workspace** from M0 (not Slack-only, not deferred). The old plan scoped the webapp + ArtifactStore *out* of the MVP; building around the workspace (the architect's decision) brings the webapp surface and the artefacts browser **into M0–M2**. **Telegram leaves the critical path entirely** — an optional notification channel, never required. The cost is more UI + auth built before the MVP; the gain is one coherent surface from the start.

## Build track — milestones

M0–M2 are the MVP. M3–M4 build on it. The webapp is delivered in the concept's steps **S1 Read → S2 Discuss → S3 Decide → S4 Artefacts → S6 Inbox**, woven across milestones. The table below stays milestone-level; story-level scope for an open milestone lives in its [scoping doc](roadmap/) (M1: [`m1-spec-to-design.md`](roadmap/m1-spec-to-design.md); M2: [`m2-build-to-merge.md`](roadmap/m2-build-to-merge.md)).

| Milestone | Goal | Stories | Exit criteria |
|---|---|---|---|
| **M0 — Foundation + surface backbone** ✅ **(closed 2026-05-27)** | An audited model egress, a control plane that boots, and the workspace reachable | US-0021, US-0020 (core), US-0001, US-0030 (**S1**) | maestro boots, connects **GitHub + Claude** (both verified live — `maestro boot --probe`); the GitHub adapter **refuses to merge without a valid approval event** (ADR-0016); the workspace **renders a repo-sourced spec read-only** (S1, served on ds1 behind a **dev-stub identity**); an LLM call is recorded. The **authenticated edge** (`component-auth` over the Cloudflare Tunnel/Access, ADR-0019) **moves to M3** — see the M3 row |
| **M1 — Spec → design, in the workspace** | Intent becomes an approved spec and design, decided in the workspace | US-0010, US-0012, US-0013, US-0030 (**S2–S3**) | a real intent yields a **workspace-approved** functional spec (EARS) then an approved design; comments (S2) + gate decisions (S3) are events; all state event-sourced and replayable |
| **M2 — Build → merge (the MVP)** | The rest of the loop; merge executed on a workspace approval | US-0011, US-0014, US-0023 (ArtifactStore), US-0033 (**S4**) | maestro implements on a `maestro/*` branch, opens a PR with green DoD, posts the **merge gate in the workspace**; on approval **maestro executes the merge** (ADR-0016); task `done` on the observed merge; diffs/test reports browsable (S4) |
| **M3 — Hardening, quality & the inbox** | Better-vetted PRs, a compliant audit trail, the cross-product inbox, the **authenticated edge**, an **incremental spec index** | US-0015, US-0016, US-0022 (full), US-0030 (**S6**) | independent reviewer + docs agents on every PR; audit tier WORM + hash-chained with retention; the **workspace gets its authenticated edge** — `component-auth` over the Cloudflare Tunnel/Access (ADR-0019) replaces the M0 dev-stub identity, so the caller is a real participant (the precondition for the per-participant inbox); one **inbox + activity timeline** across a participant's products (S6); **Slack/Telegram demoted to notification channels** that deep-link into the workspace; the **spec index becomes incremental** — the [ADR-0017](architecture/decisions/0017-github-app-and-webhook-ingestion.md) webhook `push` reconciler + crew-event seeding maintain it (persisted across restarts), so the workspace list path makes **no per-request repo scans** ([`workspace-backend.md`](architecture/components/workspace-backend.md), [LIMITATION-0001](issues/LIMITATION-0001-spec-index-not-incremental.md)) |
| **M4 — Commercial onboarding** | Onboard the first *commercial* product with external functional reviewers | external-auth in `component-auth`, knowledge agent | a commercial product's functional gate reaches **external reviewers in the workspace** with artefact access; per-product isolation verified; Telegram optional |

> **US-0030 spans the surface steps.** It now covers the architect + **technical** specs (not just functional), and is delivered in steps S1–S6 across M0–M3; it will be split into per-step stories in the story phase. The **inbox (S6)** is in the concept but the architect deferred it past the v1 first cut (specs + threads + artefacts).

> **The spec index ships in two phases.** **Phase 1 (M0, shipped with S1):** the index is rebuilt only when a branch's head commit changes and content-addresses frontmatter by blob SHA — sub-second reads, no per-request full scans. **Phase 2 (M3):** the webhook `push` reconciler ([ADR-0017](architecture/decisions/0017-github-app-and-webhook-ingestion.md)) + crew-event seeding maintain a **persisted** index incrementally, so the list path touches GitHub zero times. Phase 1 is adequate through the MVP at dogfood scale; Phase 2 is hardening ([LIMITATION-0001](issues/LIMITATION-0001-spec-index-not-incremental.md)).

## Adoption track — the stepwise ladder

Each rung delivers value and depends only on what's beneath it — so you don't wait for the whole engine.

| Step | Available when | What you can do | Still manual |
|---|---|---|---|
| **0 — Manual pilot** | Phase 0 merged | Run maestro's *own* SDLC by hand on the maestro repo: specs/designs as Markdown PRs; a human or Claude Code plays the crew. The ADR-0016 merge boundary is an **engine capability not yet running**, so the pilot relies on human discipline (work on `maestro/*`, open PRs, a human approves the merge) | Everything except the human gates |
| **1 — Assisted** | after **M0** | Agents draft specs/designs via the `ModelClient`; specs **render in the workspace** (S1); state is event-sourced and recoverable | The human still drives stage to stage |
| **2 — Automated loop (dogfood)** | after **M2** | maestro runs a delivery task on **itself** end to end; the architect **decides the gates in the workspace**, and maestro **executes the merge** on approval | New work still framed by the architect |
| **3 — Second technical product** | after M2 | Register another *technical* product; same workspace surface | — |
| **4 — First commercial product** | after **M3/M4** | Onboard external **functional reviewers in the workspace** (per-product isolation, external auth), with artefact access. **This is when external users come on.** | — |

> Onboarding mechanics per product (register entry, repo controls, surfaces) are in [`onboarding-a-product.md`](guides/onboarding-a-product.md).

## Engineering decisions to lock before M0

The "deferred to engineering" questions from [PRD-0001](product/prd/0001-architect-directed-delivery-loop.md) and [`orchestrator.md`](architecture/components/orchestrator.md):

| Decision | Direction |
|---|---|
| Orchestration runtime | **Decided: LangGraph** ([ADR-0014](architecture/decisions/0014-orchestration-runtime-langgraph.md)) — durable execution + `interrupt()` gates; `ModelClient` stays the egress and the event log stays authoritative (ADR-0002/0008/0009). |
| Persistence | **SQLite** event store to start; Postgres when concurrency/recovery demand it (ADR-0008) |
| Runtime language | **Python** (per `CODEBASE.md`) |
| Human surface | The **maestro workspace** — `component-auth` + the Cloudflare Tunnel/Access (ADR-0012/0015), an MIT/open base (shadcn/ui + Next.js). The authenticated **edge** lands in **M3** (ADR-0019); M0–M2 run behind a dev-stub identity. Slack/Telegram are **optional notification channels** (M3), not the MVP surface |
| GitHub integration | Fine-grained **PAT (or App) with merge**; maestro merges **only** against a recorded approval event ([ADR-0016](architecture/decisions/0016-merge-after-workspace-approval.md)) — no branch-protection backstop (single-layer) |
| `merge_gate` UX | Architect **approves in the workspace**; maestro executes the merge against the recorded approval event ([ADR-0016](architecture/decisions/0016-merge-after-workspace-approval.md)) — the event is the sole authority |

## Risks and constraints

- **Throughput is bounded by the human *decision*** — by design; maestro executes the merge on approval (ADR-0016), but nothing merges without the human's gate decision. The leverage is in spec/design/build.
- **Verify the merge boundary at first run** — maestro **refuses to merge without a valid, role-authorized approval event** (ADR-0016). The boundary is now **maestro-internal (single-layer)**: the event log's integrity (WORM + hash-chain, ADR-0009) and the adapter's check are load-bearing — there is **no** GitHub backstop, so a maestro compromise is detectable (tamper-evident log) but not independently prevented.
- **The webapp front-loads UI into M0–M2** — more to build before the MVP than the old Slack-only plan; accepted for one coherent surface. The **authenticated edge is *not* front-loaded** — it lands in M3 (ADR-0019); through the MVP the workspace runs behind a dev-stub identity, adequate for single-architect dogfooding. **Telegram leaves the critical path** (optional notification).
- **MinIO durability becomes real at M2** (ArtifactStore moved earlier for the artefacts browser, S4) — erasure coding + an offsite backup before real artefacts land (ADR-0012).
- **The spec index is head-commit-cached, not yet incremental** (Phase 1, M0). It rebuilds on a new commit or a cold start; fine at dogfood scale, but a product with a large `docs/` tree pays a cold-build cost until the M3 webhook reconciler ([LIMITATION-0001](issues/LIMITATION-0001-spec-index-not-incremental.md)).
- **Runtime decided (LangGraph, ADR-0014) — M0 is unblocked.** The functional-surface (ADR-0015) and merge-model (ADR-0016) decisions are settled too; no open decision gates M0.
