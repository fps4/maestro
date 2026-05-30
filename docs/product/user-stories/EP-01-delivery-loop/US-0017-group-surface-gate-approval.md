---
title: "US-0017: Notify a gate to the group surface with a deep-link to the workspace decision"
persona: architect
status: proposed
complexity: M
milestone: M3
last_updated: 2026-05-30
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0011-multi-surface-human-control.md
  - docs/architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - docs/architecture/decisions/0003-split-review-routing-matrix.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0012-route-review-by-product-type.md
  - docs/product/user-stories/EP-04-notifications/US-0040-notification-channel-topology.md
---

## Story

As the architect,
I want each open gate announced to the right group surface (the shared architect Slack channel / the product's Telegram group) with a deep-link to the workspace where the decision is actually made,
so that multi-person review teams are notified naturally and each product's functional reviewers stay isolated — **without** the decision ever happening on a chat surface.

## Context

Implements the surface layer of [ADR-0011](../../../architecture/decisions/0011-multi-surface-human-control.md) **as notification, not decision** ([ADR-0015](../../../architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md)): the gate is **decided in the workspace** ([US-0012](US-0012-route-review-by-product-type.md): *"Slack/Telegram are notification + deep-link channels, not the decision surface"*). This story delivers the announcement + deep-link and the group semantics (who may decide, resolved in the workspace); routing of `(role, surface)` is US-0012; the notification topology proper is EP-04 (US-0040/US-0041).

**Reframed 2026-05-30 (US-0024 M10).** The earlier draft put approve/request-changes/reject controls *in-group*, which contradicted ADR-0015 / US-0012 (a notification SHALL NOT carry decision controls). Reframed to notification + deep-link so the contract has one answer for "where decisions happen": the workspace.

## Acceptance criteria (EARS)

- WHEN a gate opens, THE SYSTEM SHALL post a notification to the destination for the gate's role — architects to the shared architect Slack channel, functional reviewers to the product's Telegram group via that product's bot — carrying a **deep-link to the gate in the workspace** and NO decision controls.
- WHEN a recipient follows the deep-link, THE SYSTEM SHALL open the gate in the workspace, where any participant holding the gate's role for the product may decide (quorum 1 — the first valid workspace decision wins, US-0012 / workspace-write-api).
- WHILE a gate is open, other role-holders MAY follow the link and monitor without acting, and THE SYSTEM SHALL NOT require a specific named responder.
- WHEN posting to Telegram, THE SYSTEM SHALL use the product's own bot, and a bot SHALL only ever address its own product's group (per-product isolation, ADR-0011 / ADR-0010).
- WHEN a gate is resolved (in the workspace) or times out, THE SYSTEM SHALL update or annotate the prior group notification so the surface does not show a stale "needs decision" prompt.

## Out of scope

- Resolving which role/surface a gate routes to (US-0012).
- The decision write itself and its effect on the delivery-task stage / event log (workspace-write-api, US-0020).
- The full notification channel topology and PR-lifecycle notifications (EP-04 — US-0040 / US-0041).
- Quorum greater than 1 or a named-lead sign-off (ADR-0011 open question).

## Notes

The decision surface is the workspace, full stop (ADR-0015). Chat surfaces are where you're *told* a gate is waiting and from which you *jump* to decide — never where the decision is recorded. Per-product bots isolate products (ADR-0011 / ADR-0010); bot tokens are secrets referenced from the register, not stored in it.
