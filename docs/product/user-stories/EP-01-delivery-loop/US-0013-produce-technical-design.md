---
title: "US-0013: Produce a technical design from an approved spec and post it to the design gate"
persona: architect
status: draft
complexity: L
milestone: M1
last_updated: 2026-05-27
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0006-spec-driven-sdlc.md
  - docs/architecture/decisions/0003-split-review-routing-matrix.md
  - docs/guides/sdlc.md
---

## Story

As the architect,
I want the architect/planner agent to turn an approved functional spec into a technical design and an ordered task list, posted to the technical (design) gate,
so that I approve *how* it will be built before any code is written.

## Context

The middle of the delivery loop — between functional approval (US-0010) and implementation (US-0011), which both already assume it. Implements artifact 3 of the spine and the technical (design) gate ([ADR-0006](../../../architecture/decisions/0006-spec-driven-sdlc.md), [ADR-0003](../../../architecture/decisions/0003-split-review-routing-matrix.md)). The architect/planner agent proposes; it does not approve.

## Acceptance criteria (EARS)

- WHEN a delivery task's functional spec is approved, THE SYSTEM SHALL produce a technical design (architecture, data and API contracts) and an ordered, dependency-aware task list, where each task references the requirement(s) it satisfies and targets a repo.
- WHEN a significant architectural trade-off is required, THE SYSTEM SHALL propose an ADR and stop for the decision rather than deciding silently.
- WHEN the design and tasks are produced, THE SYSTEM SHALL run a read-only clarify pass for spec ↔ design ↔ tasks drift and surface targeted questions one at a time before a human is asked to review.
- WHEN the design is ready, THE SYSTEM SHALL post it to the technical (design) gate routed to the architect (US-0012), offering approve / request-changes / reject.
- WHEN the architect selects request-changes with feedback, THE SYSTEM SHALL revise the design and re-post it to the same gate.
- WHEN the architect approves, THE SYSTEM SHALL advance the delivery task to the build stage and record the approval (who, when).

## Out of scope

- Implementing the design (US-0011) and generating tests from it (US-0014).
- Producing the functional spec (US-0010).

## Notes

Design shape follows the technical-design artifact in [`docs/guides/sdlc.md`](../../../guides/sdlc.md). A single delivery task targets one repo in v1 (PRD-0001); cross-repo features are modelled (ADR-0005) but realised later.
