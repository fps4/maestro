---
title: "US-0015: Critique the diff with an independent reviewer agent"
persona: architect
status: draft
complexity: M
last_updated: 2026-05-25
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0004-agents-propose-via-pr-humans-merge.md
  - standards/git.yaml
---

## Story

As the architect,
I want an independent reviewer agent to critique the PR diff against `standards/` and post triaged, severity-tagged comments,
so that my technical merge gate sees pre-triaged work and the review is never an agent grading its own output.

## Context

A pre-merge step on the open PR from US-0011. Enforces the reviewer ≠ author rule ([ADR-0004](../../../architecture/decisions/0004-agents-propose-via-pr-humans-merge.md)) — independent checks, not self-grading.

## Acceptance criteria (EARS)

- WHEN a pull request is open for a delivery task, THE SYSTEM SHALL critique the diff against the machine-readable `standards/` and post severity-tagged, triaged comments on the PR.
- IF the reviewer agent authored any part of the feature under review, THEN THE SYSTEM SHALL refuse to review it and SHALL assign an agent that did not author it.
- WHEN the review is complete, THE SYSTEM SHALL attach a summary to the PR for the architect's technical (merge) gate.
- WHILE high-severity findings remain unresolved, THE SYSTEM SHALL surface them at the merge gate rather than suppressing them.

## Out of scope

- The human merge decision (architect, ADR-0004) and the orchestration that opens the gate (US-0020).
- Generating the tests (US-0014).

## Notes

Reviewer comments are advisory input to the human gate, not an auto-merge signal. "Independent checks, not self-grading" (principle 3 / ADR-0004).
