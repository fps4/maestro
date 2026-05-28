---
title: maestro workspace — UX design (use-cases, journey, layout)
status: draft
last_updated: 2026-05-28
owners: [architect]
related:
  - docs/architecture/webapp-concept.md
  - docs/architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - docs/architecture/decisions/0011-multi-surface-human-control.md
  - docs/architecture/decisions/0003-split-review-routing-matrix.md
  - docs/product/vision.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0010-draft-functional-spec.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0013-produce-technical-design.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0030-reviewer-webapp-and-wiki.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0031-workspace-ux-design.md
---

## Purpose

[`webapp-concept.md`](webapp-concept.md) framed *what the workspace is* — personas, surfaces, information architecture, two flows (gate decision, merge gate). This document is its **UX design** companion: it designs *how the human gets through the whole loop end-to-end*, with the use-cases that drive each screen and the information-layout choices that follow.

It is **not** an ADR. Visual brand, component library, and accessibility are out of scope (see *Out of scope*); the focus is **use-cases → flow → layout → interaction patterns**, in that order.

## Personas in scope

Two personas, distinguished by **what they need to read and what they need to decide**:

| Persona | Technical? | Scope of access | Their job in the workspace |
|---|---|---|---|
| **Architect** | yes | every product (by membership) | direction-holder: dispatches intent, reads/refines specs and designs, approves design + merge gates, watches the inbox across products |
| **Functional reviewer** | **no** | their commercial product(s) only | domain owner: validates *what* is being built (functional spec) on their product — without needing to read code, designs, or test reports |

Other roles ([`data-model.md`](data-model.md) participants) inherit from these two — they consume one of these two design tracks; the design doesn't multiply per-role.

> **What "non-technical" actually means here.** Not "less smart" — *different vocabulary*. The functional reviewer thinks in domain terms (customers, invoices, policies, claims), not in spec-section ids, EARS keywords, or diff hunks. The design's job is to surface domain meaning first and EARS/structure second, so the reviewer can decide whether the spec matches their intent without learning maestro's vocabulary.

## Use-cases (jobs-to-be-done)

Organised by the question the persona is trying to answer in that moment.

| Job | Architect | Functional reviewer | Touched by today's stories |
|---|---|---|---|
| **"Get my idea into the system"** (intent → delivery task) | ✓ | — | US-0010 (intake), webapp-concept §intent-dispatch |
| **"Did the agent understand my idea?"** (read the draft functional spec) | ✓ (technical products) | ✓ (commercial products) | US-0010, US-0030 |
| **"This isn't quite right — refine it"** (comment + agent re-draft loop) | ✓ | ✓ | not yet designed — *this doc* |
| **"Does the plan match my intent?"** (read the technical design) | ✓ | — | US-0013, US-0030 (S2–S3) |
| **"Approve this stage, move on"** (functional / design gate decision) | ✓ | ✓ (functional only) | US-0017, US-0030 |
| **"What needs me right now?"** (cross-product inbox) | ✓ | ✓ (their products) | US-0030 S6, M3 |
| **"What's happening on this task right now?"** (per-task activity) | ✓ | ✓ | US-0022 (audit log), S2 thread |
| **"Catch up — what changed while I was away?"** (diff-since-last-visit) | ✓ | ✓ | not yet designed — *this doc* |
| **"Approve this PR and merge it"** (read diff + merge gate) | ✓ | — | US-0011, ADR-0016 |
| **"Something is stuck — what's wrong?"** (blocked task, failed agent) | ✓ | (informational only) | US-0020 (blocked-task notify) |

The two **not-yet-designed** rows are the centre of this doc: the **refinement loop** and the **catch-up affordance**. Both stay implicit in the existing stories; both need an interaction pattern before M1 ships.

## The end-to-end journey

The flow the architect described: idea → intake → spec → review/refine → design → review/refine → execution → review diff → merge. Rendered as a swimlane so it's clear **who acts at each step** and **what they see**.

```mermaid
sequenceDiagram
  actor A as Architect
  actor R as Functional reviewer<br/>(commercial only)
  participant W as Workspace
  participant C as Crew (intake / spec / design / impl / reviewer)
  participant L as Event log

  Note over A,W: 1. Idea capture
  A->>W: New task — product, free-text idea
  W->>C: dispatch intent
  Note over C: 2. Intake & clarify
  C-->>W: clarifying question (if intent under-specified)
  A->>W: answer
  Note over C: 3. Spec drafting
  C-->>W: draft functional spec (plain-language summary + EARS)
  Note over W: 4. Functional review (architect for technical; reviewer for commercial)
  alt commercial product
    R->>W: read · comment · request-changes
    C-->>W: re-drafted spec + "what I changed" note
    R->>W: approve
  else technical product
    A->>W: read · comment · request-changes / approve
  end
  L-->>W: spec approved (event)
  Note over C: 5. Design drafting (architect-only review)
  C-->>W: technical design (plain-language summary up top)
  A->>W: read · comment · request-changes / approve
  L-->>W: design approved (event)
  Note over C: 6. Implementation
  C-->>W: PR opened (notification to Slack per US-0041)
  Note over C: 7. Independent review + DoD
  C-->>W: reviewer-agent report + green DoD
  Note over W: 8. Merge gate
  A->>W: read diff + report · approve & merge
  W->>L: merge-approval event
  C->>W: maestro executes the merge (ADR-0016) · task done
```

For **each step** the design specifies four things: *who acts · what they see (primary) · what they decide · how they're notified*. Those four answer "is this screen designed for this persona's vocabulary and decision?" — the checkable criterion.

### Step-by-step UX brief

| # | Step | Who acts | Primary content | Decision | Notification |
|---|---|---|---|---|---|
| 1 | Idea capture | Architect | a single free-text field + product selector; no required structure | "send it" | — |
| 2 | Intake & clarify | Architect | the agent's clarifying question; the original idea visible alongside | answer or "skip, draft what you have" | inbox badge + Slack (US-0041) |
| 3 | Spec drafting | (Crew) | progress indicator on the task card | — | — |
| 4 | Functional review | Architect / Reviewer | **plain-language summary** at the top; EARS criteria below; comment anchors per criterion | approve / request-changes / reject | inbox + Slack |
| 4a | Refinement loop | Architect / Reviewer | **diff-of-spec since last review** + agent's "what I changed" note | re-review | inbox + Slack |
| 5 | Design review | Architect | plain-language design summary; diagrams; ADR-style decisions; comment anchors | approve / request-changes / reject | inbox + Slack |
| 6 | Implementation | (Crew) | task card shows "implementing" + branch name | — | Slack on PR-opened |
| 7 | Indep. review + DoD | (Crew) | reviewer-agent findings + DoD status on the task card | — | Slack on findings |
| 8 | Merge gate | Architect | PR title · diff · DoD report · reviewer-agent summary · "approve & merge" | approve & merge / request-changes / reject | inbox + Slack |

> **The functional reviewer's whole journey is step 4 (+ 4a).** Every other step either doesn't involve them or is informational. That's the design constraint: their experience must be **excellent at one screen** rather than competent across many.

## Information layout principles

The screen-level rules that keep the technical and non-technical journeys legible from the same store.

### P1 — Plain-language summary first, structure below

Every spec, design, and PR view opens with a **plain-language summary** (one paragraph, no jargon) authored by the agent. Structured detail (EARS criteria, diagrams, diff hunks) lives below the fold. The functional reviewer often acts on the summary alone; the architect scrolls.

### P2 — One primary action per screen

A gate screen has **one** primary button (approve), with secondary affordances (request-changes, reject) given equal-but-quieter weight. Read-only screens (wiki, activity) have **no** primary action. This is what stops a non-technical reviewer second-guessing what they're supposed to do.

### P3 — Progressive disclosure, never hidden

Technical detail (code-shaped content, agent reasoning, internal ids, raw event payloads) is **collapsed by default for the functional reviewer**, **expanded by default for the architect**, never removed. A "show full detail" affordance is always present; a "show me the plain version" affordance is always present. The same artefact serves both personas.

### P4 — Anchored comments, not free-floating chat

Comments attach to **artefact anchors** (a spec criterion, a design section, a diff hunk). A free-text comment is a fallback, not the default. This is what makes the refinement loop tractable: the agent receives a feedback bundle keyed to anchors, not a chat transcript.

### P5 — Activity is a sidebar, not a screen

The audit/activity timeline is **always available** as a per-task sidebar, never the user's main destination. The destination is the decision; activity is context.

### P6 — Catch-up via "since you were last here"

Every per-task view marks **what's new since the participant last visited** (new comments, new revisions, gate state changes). The inbox surfaces tasks with unread changes ahead of those without. This is the "I've been away for 2 days" affordance.

## Interaction pattern — the refinement loop

The most under-designed moment in the current stories. Spec/design review is **not** a single approve/reject — it's an iterative refinement until the human can approve in good conscience. The pattern:

1. **Anchored comments**: the reviewer leaves comments anchored to specific criteria / design sections (P4).
2. **Bundle on `request-changes`**: choosing *request-changes* converts the open comments into a **feedback bundle** addressed to the responsible agent (the spec/design agent that drafted), preserving anchors.
3. **Agent re-drafts**: the agent reads the bundle, re-drafts the affected sections, and publishes a new revision with a **"what I changed and why"** note that addresses each anchor.
4. **Diff-of-artefact**: the reviewer's next visit defaults to the **diff since their last review** (only the changed sections), with the agent's note visible at the top, and the anchored comments resolved/replied next to the change.
5. **Cycle or approve**: the reviewer either approves, or repeats from (1) with new comments.

> **Why this matters for non-technical reviewers.** The diff-of-spec view (4) is what makes refinement legible *without* re-reading the whole spec each cycle. The "what I changed and why" note is what makes the agent feel like a teammate and not an oracle. Without these, the loop collapses into "approve and hope" or "reject and rewrite from scratch."

## What this design produces (deliverables)

The story this doc backs ([US-0031](../product/user-stories/EP-03-reviewer-surface/US-0031-workspace-ux-design.md)) is acceptance-gated on these artefacts existing and having been reviewed by the architect:

1. **Persona cards** — one page per persona (architect, functional reviewer): goals, vocabulary, context-of-use, what they decide, what they don't.
2. **Use-case index** — the table above, expanded with one acceptance-style sentence per row ("the reviewer can answer X without reading Y").
3. **Journey map** — the swimlane above, plus a per-step UX brief expanding the four-column table.
4. **Low-fi wireframes** — six key screens: idea-intake · inbox · spec-review · refinement (diff-of-spec) · gate-decision · merge-gate. Resolution: layout + content hierarchy, not pixel-pushed.
5. **Interaction-patterns sheet** — refinement loop, comment-anchoring, gate-decision flow, catch-up affordance. One pattern per page.
6. **Open questions log** — feeds back into [`webapp-concept.md`](webapp-concept.md) (where decisions land) and surfaces ADRs needed.

## Out of scope

- **Visual / brand design.** The base is **shadcn/ui + Next.js** (ADR-0015 / webapp-concept §architecture-fit). Aesthetic direction is not litigated here.
- **Component library implementation.** This doc commissions design artefacts, not React code.
- **Accessibility audit.** Worth its own story; this design respects accessibility constraints (semantic structure, contrast, keyboard nav) but does not deliver a WCAG audit.
- **Personas not in scope.** Designing for stakeholders / observers / external read-only auditors / idea-havers without a maestro role — out of scope by the architect's decision (2026-05-28). Add back when those personas land in the data model.
- **Mobile-first design.** Desktop-first is assumed (the audience reviews on a laptop); mobile is "read + simple decide" only and not designed here.
- **Coded prototypes.** The webapp itself ships under US-0030 (S1–S6); this is design input to it, not parallel implementation.

## Open questions (raised here, decided elsewhere)

- ~~**Plain-language summary: agent-authored vs on-the-fly toggle?**~~ **Resolved by [ADR-0021](decisions/0021-plain-language-summary-on-artefacts.md)** (2026-05-28): agent-authored at draft time, in the artefact's `maestro:` frontmatter (`summary:` field, ≤ 120 words / 800 chars), re-written on every revision. One source of truth in the repo; no on-the-fly LLM call path in the workspace.
- ~~**Feedback-bundle contract.**~~ **Resolved by [ADR-0020](decisions/0020-feedback-bundle-payload-shape.md)** (2026-05-28): structured anchored list (`items[]` of `{anchor, comments[], suggested_change?}`) plus the reviewer's top-level `rationale`. Server-side composition at `request_changes` time from the existing `comment.posted` + `gate.decided` events. The bundle is a snapshot; the agent's response (`agent_response.posted`) is named there, shaped in the engine spine.
- **Diff-of-artefact mechanics.** Spec diffs are easy if the artefact is committed (git); design diffs likewise; *un*-committed work-in-progress revisions need a story — does the workspace render in-flight revisions, or only committed ones?
- **Catch-up state per participant.** "Since you were last here" requires a per-participant last-seen marker. Does that live in the event log (a `viewed` event per participant per artefact) or as workspace-local state? Affects audit completeness.
- **Inbox prioritisation across products** when the architect is in many. Date-sorted? Pinned-product? Risk-tiered? Deferred to US-0030 S6 (M3) but the design needs to propose a default.
- **Anchoring on free-form text.** Spec criteria are addressable; a design "section" is less so. Markdown headings as anchors? Block-level ids assigned by the renderer?

## Notes

This doc is design input to the engineering. It does not move the architecture — every event still goes through the orchestrator, the repo is still the source of truth for specs/designs, the event log is still the system of record (the [workspace-concept invariant](webapp-concept.md#the-one-invariant-that-does-not-change)). What it does change is which questions a screen has to answer in the first second it's on the user's display — and that, more than any framework choice, is what separates a workspace a non-technical reviewer can use from one they can't.
