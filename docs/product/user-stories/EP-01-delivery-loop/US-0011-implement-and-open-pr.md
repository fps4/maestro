---
title: "US-0011: Implement an approved design on a branch and open a pull request"
persona: architect
status: accepted
complexity: L
milestone: M2
last_updated: 2026-05-29
accepted_on: 2026-05-29
accepted_by: "@farid (architect)"
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0016-merge-after-workspace-approval.md
  - docs/roadmap/m2-build-to-merge.md
---

## Story

As the architect,
I want the builder agent to implement an approved design on a feature branch and open a pull request,
so that I review real, runnable code and approve its merge (maestro then executes it — [ADR-0016](../../../architecture/decisions/0016-merge-after-workspace-approval.md)).

## Context

The builder's execution stage. After the technical (design) gate approves (US-0013), the builder implements and opens a pull request — never a direct push to a default branch; the builder never merges (maestro executes the merge later, only on a recorded approval — [ADR-0016](../../../architecture/decisions/0016-merge-after-workspace-approval.md)). This story is the builder's slice; the tests (US-0014), independent review (US-0015), and doc updates (US-0016) that complete the Definition of Done on the open PR, and the orchestration that opens the merge gate when they are green (US-0020), are their own stories. It exercises the ADR-0016 safety boundary end to end.

## Acceptance criteria (EARS)

- WHEN a delivery task has an approved technical design, THE SYSTEM SHALL create a `maestro/*` feature branch (never the default branch) and commit the implementation to it, one branch per delivery task.
- WHEN the implementation is complete, THE SYSTEM SHALL open a draft pull request targeting the default branch, with a description linking the delivery task and its approved spec/design and showing which requirement each change satisfies.
- WHEN all Definition-of-Done gates are green (spec-derived tests US-0014, independent review US-0015, docs US-0016, and the security/SBOM floors), THE SYSTEM SHALL mark the PR ready for the technical (merge) gate.
- WHEN the architect approves the merge gate and maestro executes the merge against that recorded approval ([ADR-0016](../../../architecture/decisions/0016-merge-after-workspace-approval.md)), THE SYSTEM SHALL mark the delivery task done on the observed merge event.
- IF any code path attempts to push to a default branch, or to merge without a valid, role-authorized merge-approval event, THEN THE SYSTEM SHALL refuse and log it ([ADR-0016](../../../architecture/decisions/0016-merge-after-workspace-approval.md)).

## Out of scope

- Generating the technical design (US-0013).
- Generating tests (US-0014), the independent diff review (US-0015), and doc updates (US-0016).
- Opening/sequencing the merge gate and observing the merge event mechanics (orchestrator, US-0020).
- CI configuration in the target repo (assumed present; runs on the PR).

## Notes

"Done" is driven by the observed merge event, never by an agent claiming completion.

**M2 scoping resolution (Q3, 2026-05-29).** The builder agent commits **one commit per task-list entry**, message format `task-{n}: <task title>`, ordered by dependency. Iteration noise is squashed so the final commit set is the task list, not its drafts. Supports `git bisect` on later DoD failures. See [`m2-build-to-merge.md`](../../../roadmap/m2-build-to-merge.md#open-questions-specific-to-m2).
