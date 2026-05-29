---
title: "US-0032: Discuss and decide a gate in the workspace (M1 slice of US-0030, S2 + S3)"
persona: architect
status: done
complexity: L
milestone: M1
last_updated: 2026-05-29
accepted_on: 2026-05-28
accepted_by: "@farid (architect)"
done_on: 2026-05-29
done_by: CI on a green merge (M1 #2 + #3 + #4 + #10; literal diff-of-artefact deferred)
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/product/user-stories/EP-03-reviewer-surface/US-0030-reviewer-webapp-and-wiki.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0031-workspace-ux-design.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0010-draft-functional-spec.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0012-route-review-by-product-type.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0013-produce-technical-design.md
  - docs/architecture/contracts/workspace-read-api.md
  - docs/architecture/webapp-concept.md
  - docs/architecture/decisions/0008-system-of-record-and-persistence.md
  - docs/architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - docs/architecture/decisions/0018-workspace-read-api-and-frontmatter-index.md
  - docs/roadmap/m1-spec-to-design.md
---

## Story

As the architect,
I want the workspace to let me **discuss** a gated artefact (spec or design) in a per-gate thread and **decide** the gate (approve / request-changes / reject) — both recorded as attributed events through the orchestrator —
so that M1's functional and design gates close in the workspace, with every comment and decision in the event log and the spec/design refinement loop actually closable.

## Context

US-0030 spans the webapp steps S1–S6 across M0–M3. **S1 (Read) shipped in M0.** This story is the **M1 slice — S2 (Discuss) + S3 (Decide)** carved out as its own M1 deliverable, per the [M1 scoping doc](../../../roadmap/m1-spec-to-design.md) (open question Q4, resolved 2026-05-28). US-0030 remains the umbrella for the full webapp; this story is what M1 actually ships from it. Information layout, the refinement-loop interaction pattern, and per-screen content come from [US-0031](US-0031-workspace-ux-design.md) ([`workspace-ux-design.md`](../../../architecture/workspace-ux-design.md)).

**Contract.** The write path **extends the existing workspace read-API contract** ([`workspace-read-api.md`](../../../architecture/contracts/workspace-read-api.md)) additively — the contract doc already names S2/S3 as "extend the same base, additively" (resolution of M1 scoping Q3, 2026-05-28). One workspace ↔ orchestrator surface; the webapp holds no authoritative state.

## Acceptance criteria (EARS)

- WHEN maestro opens a **functional** or **design** gate (US-0010 / US-0013) for a product the caller participates in, THE SYSTEM SHALL present a gate page showing the gate context, the artefact rendered one-way from the product repo (S1), the per-gate discussion thread, and role-scoped decision controls.
- WHEN a participant posts a comment on a gate, THE SYSTEM SHALL forward it to the orchestrator over the extended workspace API; the orchestrator SHALL authorize it by product role (ADR-0011), append it to the event log (ADR-0008) as an attributed event (ADR-0009), and the webapp SHALL render it from the resulting projection — never from local state.
- WHEN a participant decides a gate (approve / request-changes / reject), THE SYSTEM SHALL accept the decision only from a participant holding the gate's resolved role for the product (US-0012), record the deciding identity (ADR-0009), append the decision event (ADR-0008), and resolve the stage through the orchestrator.
- WHEN the reviewer selects **request-changes**, THE SYSTEM SHALL collect the open anchored comments into a **feedback bundle** and deliver it to the responsible agent (spec or design) through the orchestrator, so the agent can re-draft against specific anchors rather than a free-form transcript (interaction pattern from [`workspace-ux-design.md`](../../../architecture/workspace-ux-design.md) §refinement-loop).
- WHEN a re-drafted artefact is published after a request-changes, THE SYSTEM SHALL show the reviewer a **diff of the artefact since their last review** alongside the agent's "what I changed and why" note, with the previously-anchored comments resolved/replied next to the change.
- THE SYSTEM SHALL scope visibility to the products the caller participates in (per-product isolation — ADR-0010/0011); a product the caller does not participate in SHALL return `404` (existence not disclosed — same rule as the read API).
- THE SYSTEM SHALL run behind the M0 **dev-stub identity** (`MAESTRO_DEV_IDENTITY`, ADR-0019) for M1; production rejects the stub path. The authenticated edge lands in M3.
- IF the orchestrator is unavailable, THEN THE SYSTEM SHALL show gate state read-only and SHALL NOT accept a decision it cannot record — no decision is lost or fabricated.

## Out of scope

- The full US-0030 surface (S4 artefacts browser, S6 inbox) — later milestones.
- The authenticated edge / Cloudflare Access + `component-auth` — M3 (ADR-0019).
- LLM-generated chat replies inside threads — a later story; here the thread carries human comments + agent messages relayed by the orchestrator.
- The wiki rendering mechanism (in-app MDX vs. sibling static site) — a build-time choice left open by ADR-0015.
- Group-decision semantics across multiple role-holders — US-0017 (M1 assumes the single architect / single functional-reviewer case).
- Slack/Telegram notifications of gate state — EP-04 (M3, US-0040 / US-0041).
- Specifying the agent contract for the feedback bundle and the agent's "what I changed and why" note — surfaced by [US-0031](US-0031-workspace-ux-design.md) for an ADR before US-0010 / US-0013 finalise; this story consumes whichever shape is decided.

## Notes

This is the **M1 join point** for the engine and surface streams: LangGraph's `interrupt()` gate ([ADR-0014](../../../architecture/decisions/0014-orchestration-runtime-langgraph.md)) is resolved by the decision event this story records, and the spec/design re-draft cycle (US-0010 / US-0013) is what the refinement loop actually drives. Everything else in M1 either feeds this story or is fed by it.
