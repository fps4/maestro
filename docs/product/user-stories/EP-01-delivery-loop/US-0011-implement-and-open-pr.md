---
title: "US-0011: Implement an approved design on a branch and open a pull request"
persona: architect
status: draft
complexity: L
last_updated: 2026-05-25
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
---

## Story

As the architect,
I want the builder agent to implement an approved design on a feature branch and open a pull request,
so that I review real, runnable code in GitHub and merge it myself.

## Context

The execution stage. After the technical (design) gate approves, the builder implements. The output is a pull request — never a direct push, never a merge. This story exercises the ADR-0004 safety boundary end to end, and the Definition of Done gates from ADR-0006.

## Acceptance criteria (EARS)

- WHEN a delivery task has an approved technical design, THE SYSTEM SHALL create a `maestro/*` feature branch (never the default branch) and commit the implementation to it.
- WHEN the implementation is complete, THE SYSTEM SHALL open a pull request targeting the default branch, with a description linking the delivery task and its approved spec/design and showing which requirement each change satisfies.
- WHILE the pull request is open, THE SYSTEM SHALL run all Definition-of-Done gates and SHALL post the PR to the technical (merge) gate only when they are green, with a triaged reviewer-agent review attached.
- WHEN the architect approves and merges in GitHub, THE SYSTEM SHALL mark the delivery task done on the observed merge event.
- IF any code path attempts to push to the default branch or merge programmatically, THEN THE SYSTEM SHALL refuse and log it — maestro has no code path that performs it.

## Out of scope

- Generating the technical design (precedes this story).
- CI configuration in the target repo (assumed present; runs on the PR).

## Notes

"Done" is driven by the observed merge event, never by an agent claiming completion.
