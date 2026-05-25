---
title: "US-0010: Draft a functional spec from intent and post it to the functional gate"
persona: architect
status: draft
complexity: L
last_updated: 2026-05-25
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
---

## Story

As the architect,
I want to describe a unit of work in Slack and have the crew turn it into a functional spec posted for review,
so that *what* gets built is explicit and approved before any design or code happens.

## Context

The entry point of the delivery loop. The spec agent converts free-form intent into a functional spec with EARS acceptance criteria. The spec then waits at the functional gate, whose reviewer is resolved by `config/reviewers.yaml` (US-0012 covers the routing).

## Acceptance criteria (EARS)

- WHEN the architect submits a Slack message describing a unit of work against a named product and target repo, THE SYSTEM SHALL create a delivery task and produce a functional spec with summary, scope, user stories, and EARS acceptance criteria.
- WHEN a functional spec is produced, THE SYSTEM SHALL post it to the functional gate with approve / request-changes / reject actions.
- WHEN the reviewer selects request-changes with feedback, THE SYSTEM SHALL revise the spec and re-post it to the same gate.
- WHEN the reviewer approves, THE SYSTEM SHALL advance the delivery task to the design stage and record the approval (who, when).
- IF the intent is too vague to produce testable acceptance criteria, THEN THE SYSTEM SHALL ask one clarifying question in Slack rather than inventing requirements.

## Out of scope

- Who the reviewer is and how routing is decided (US-0012).
- The technical design stage that follows approval (US-0013).

## Notes

Spec shape follows the functional-spec template in [`docs/guides/sdlc.md`](../../../guides/sdlc.md), close enough that an approved spec can seed the target repo's `docs/product/`.
