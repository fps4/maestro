---
title: "US-0017: Approve a gate from a group surface (Slack team / per-product Telegram bot)"
persona: architect
status: draft
complexity: L
last_updated: 2026-05-25
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0011-multi-surface-human-control.md
  - docs/architecture/decisions/0003-split-review-routing-matrix.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0012-route-review-by-product-type.md
---

## Story

As the architect,
I want each gate delivered to the right group surface where any participant holding the gate's role can decide,
so that multi-person review teams work naturally and each product's functional reviewers stay isolated to that product.

## Context

Implements the surface layer of [ADR-0011](../../../architecture/decisions/0011-multi-surface-human-control.md): architect gates go to the shared architect Slack channel; functional gates go to the product's Telegram group via that product's own bot. Which role/surface a gate routes to is US-0012; this story is delivery and the group-decision semantics.

## Acceptance criteria (EARS)

- WHEN a gate fires, THE SYSTEM SHALL deliver it to the destination for the gate's role — architects to the shared architect Slack channel, functional reviewers to the product's Telegram group via that product's bot — with approve / request-changes / reject controls in-group.
- WHEN a participant who holds the gate's role for the product responds, THE SYSTEM SHALL record that participant as the decider and resolve the gate (quorum 1 — the first valid decision wins).
- IF a decision action comes from someone who does not hold the gate's role for that product, THEN THE SYSTEM SHALL ignore it and log the attempt, and the gate SHALL remain open.
- WHILE a gate is open, other role-holders MAY monitor without acting, and THE SYSTEM SHALL NOT require a specific named responder.
- WHEN resolving a Telegram action, THE SYSTEM SHALL map the responder's Telegram user id to a participant via the register; an unmapped id SHALL be treated as unauthorized.
- WHEN posting to Telegram, THE SYSTEM SHALL use the product's own bot, and a bot SHALL only ever address its own product's group (per-product isolation).

## Out of scope

- Resolving which role/surface a gate routes to (US-0012).
- The gate's effect on the delivery-task stage and event log (orchestrator, US-0020).
- Quorum greater than 1 or a named-lead sign-off (ADR-0011 open question).

## Notes

"Main responder vs silent monitor" is the group's own convention, not enforced by maestro. Per-product bots isolate products (ADR-0011 / ADR-0010); bot tokens are secrets referenced from the register, not stored in it.
