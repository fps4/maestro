---
title: "US-0031: UX design for the workspace — architect (technical) and functional reviewer (non-technical)"
persona: architect
status: accepted
complexity: M
milestone: M1
last_updated: 2026-05-28
accepted_on: 2026-05-28
accepted_by: "@farid (architect)"
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/workspace-ux-design.md
  - docs/architecture/webapp-concept.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0030-reviewer-webapp-and-wiki.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0010-draft-functional-spec.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0013-produce-technical-design.md
---

## Story

As the architect,
I want a UX design for the workspace that covers both the architect (technical) and the functional reviewer (non-technical) — driven by use-cases, with a designed end-to-end journey (idea → intake → spec → refine → design → refine → execution → merge) and explicit information-layout rules —
so that the implementation of [US-0030](US-0030-reviewer-webapp-and-wiki.md) (S1–S6) builds the right screens, in the right vocabulary, with a refinement loop that actually closes.

## Context

[`webapp-concept.md`](../../../architecture/webapp-concept.md) framed *what the workspace is* — surfaces, IA, two key flows. It did **not** design the **end-to-end journey** for either persona, did not treat the non-technical reviewer as a distinct design subject, and did not specify an interaction pattern for the **refinement loop** (comment → agent re-draft → re-review) that every spec/design review depends on. This story commissions that design work, with [`workspace-ux-design.md`](../../../architecture/workspace-ux-design.md) as the deliverable plan and product.

This is a **design-track** story — acceptance is "the design artefacts exist and have been reviewed," not "the system does X." Engineering acceptance for the screens themselves lives on US-0030 and the spec/design stories (US-0010, US-0013).

## Acceptance criteria (EARS)

- THE SYSTEM (the design artefact set) SHALL include **persona cards** for the architect and the functional reviewer — goals, vocabulary, context-of-use, what they decide, what they don't.
- THE SYSTEM SHALL include a **use-case index** that maps each job-to-be-done to its owning persona and the screen(s) that serve it; every job in [`workspace-ux-design.md`](../../../architecture/workspace-ux-design.md) §use-cases SHALL appear.
- THE SYSTEM SHALL include an **end-to-end journey map** covering idea → intake → functional spec → refinement → technical design → refinement → implementation → independent review → merge gate, naming who acts, what they see, what they decide, and how they're notified at each step.
- THE SYSTEM SHALL include **low-fi wireframes** for six key screens — idea-intake, inbox, spec-review, refinement (diff-of-spec), gate-decision, merge-gate — at layout-and-content-hierarchy resolution (not pixel-final).
- THE SYSTEM SHALL include an **interaction-patterns sheet** documenting the refinement loop, comment anchoring, gate-decision flow, and the "catch-up since you were last here" affordance.
- THE SYSTEM SHALL document **information-layout principles** (plain-language summary first; one primary action; progressive disclosure; anchored comments; activity as sidebar; catch-up marker) and SHALL apply each in the wireframes.
- WHEN the design is complete, THE ARCHITECT SHALL review and accept it, and the open questions raised by the design SHALL be tracked into ADR/story follow-ups (see [`workspace-ux-design.md`](../../../architecture/workspace-ux-design.md) §open-questions).
- IF the design surfaces a question that changes the engine contract (e.g. the feedback-bundle shape for `request-changes`, or whether the agent authors plain-language summaries), THEN it SHALL be raised as an ADR candidate against the relevant agent contract before US-0010 / US-0013 finalise.

## Out of scope

- **Visual / brand design.** Base is shadcn/ui + Next.js (ADR-0015); aesthetic direction is not in scope.
- **Component library / coded prototypes.** Implementation ships under [US-0030](US-0030-reviewer-webapp-and-wiki.md) (S1–S6); this is design input.
- **Accessibility audit.** Worth its own story; this design respects accessibility constraints (semantic structure, contrast, keyboard navigation) but does not deliver a WCAG audit.
- **Personas not in scope.** Stakeholders / observers / external read-only auditors / idea-havers without a maestro role — explicitly excluded (architect decision, 2026-05-28). Re-open when those personas land in the data model.
- **Mobile-first design.** Desktop is the assumed surface; mobile is "read + simple decide" only and not designed here.

## Notes

The two highest-leverage outputs are the **refinement-loop pattern** (currently implicit across US-0010 / US-0013 / US-0030) and the **plain-language-first layout rule** (which is what makes the workspace usable for the functional reviewer at all). If only those two land cleanly, the design has paid for itself.

`milestone: M1` because M1 ships the first refinement-capable surface (S2–S3 of US-0030) and the spec/design stories — the design is the precondition. The work itself happens *before* M1 engineering starts; tracking it under M1 makes the dependency visible.
