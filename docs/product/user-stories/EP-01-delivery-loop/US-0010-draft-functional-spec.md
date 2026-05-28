---
title: "US-0010: Draft a functional spec from intent and post it to the functional gate"
persona: architect
status: draft
complexity: L
milestone: M1
last_updated: 2026-05-28
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - docs/architecture/webapp-concept.md
  - docs/roadmap/m1-spec-to-design.md
---

## Story

As the architect,
I want to submit a unit of work as intent and have the crew turn it into a functional spec posted for review **in the workspace**,
so that *what* gets built is explicit and approved before any design or code happens.

## Context

The entry point of the delivery loop. The spec agent converts free-form intent into a functional spec with EARS acceptance criteria. The spec then waits at the functional gate, whose reviewer is resolved by `config/reviewers.yaml` (US-0012 covers the routing).

**Surface (M1).** The gate is **decided in the workspace** ([ADR-0015](../../../architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md) / [webapp-concept](../../../architecture/webapp-concept.md)); Slack/Telegram are demoted to optional notification channels (M3 — see EP-04). The story below is surface-neutral on the **intake** side (workspace "new task" affordance vs `maestro` CLI seeding the event log — see [M1 scoping](../../../roadmap/m1-spec-to-design.md) open question Q2, deferred to this story's acceptance).

## Acceptance criteria (EARS)

- WHEN the architect submits intent describing a unit of work against a named product and target repo, THE SYSTEM SHALL create a delivery task and produce a functional spec with summary, scope, user stories, and EARS acceptance criteria. (Intent intake mechanism — workspace affordance vs `maestro` CLI — is settled at acceptance per the M1 scoping open question.)
- WHEN a functional spec is produced, THE SYSTEM SHALL post it to the functional gate **in the workspace** with approve / request-changes / reject actions.
- WHEN the reviewer selects request-changes with feedback, THE SYSTEM SHALL revise the spec and re-post it to the same gate.
- WHEN the reviewer approves, THE SYSTEM SHALL advance the delivery task to the design stage and record the approval (who, when) as an attributed event ([ADR-0008](../../../architecture/decisions/0008-system-of-record-and-persistence.md) / [ADR-0009](../../../architecture/decisions/0009-attribution-of-decisions.md)).
- IF the intent is too vague to produce testable acceptance criteria, THEN THE SYSTEM SHALL ask one clarifying question **on the same intake surface** (the workspace task view, or the CLI session) rather than inventing requirements.

## Out of scope

- Who the reviewer is and how routing is decided (US-0012).
- The technical design stage that follows approval (US-0013).
- The workspace discuss/decide surface itself (US-0032 — the M1 slice of US-0030).
- Slack/Telegram notification of a freshly-opened gate (EP-04, M3).

## Notes

Spec shape follows the functional-spec template in [`docs/guides/sdlc.md`](../../../guides/sdlc.md), close enough that an approved spec can seed the target repo's `docs/product/`.
