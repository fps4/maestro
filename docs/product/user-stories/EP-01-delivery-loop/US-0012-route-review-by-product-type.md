---
title: "US-0012: Route each gate to the right reviewer by product type"
persona: architect
status: accepted
complexity: M
milestone: M1
last_updated: 2026-05-28
accepted_on: 2026-05-28
accepted_by: "@farid (architect)"
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0003-split-review-routing-matrix.md
  - docs/architecture/decisions/0005-product-domain-model.md
  - docs/architecture/decisions/0008-system-of-record-and-persistence.md
  - docs/architecture/decisions/0011-multi-surface-human-control.md
  - docs/architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - docs/architecture/webapp-concept.md
---

## Story

As the architect,
I want functional and technical gates routed to the correct reviewer based on the product's type,
so that I personally review everything except the functional spec of commercial products, which goes to the functional reviewer.

## Context

Implements the split-review matrix (ADR-0003), driven by `config/reviewers.yaml`. `product_type` and the participant roster live on the product (ADR-0005); a delivery task inherits them from its product. The reviewer is always the architect, except: commercial product + functional gate → functional reviewer.

**Surface (M1).** Both gates are **decided in the workspace** ([ADR-0015](../../../architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md) / [webapp-concept](../../../architecture/webapp-concept.md)); routing therefore resolves to a `(role, product)` audience whose members see the gate in their workspace inbox. Slack/Telegram are **notification + deep-link** channels (M3, EP-04), not the decision surface — ADR-0011's role→surface policy is preserved as the *notification* policy, not the gate-delivery policy.

## Acceptance criteria (EARS)

- WHEN a gate fires for a delivery task whose product is `technical`, THE SYSTEM SHALL route it to the architect.
- WHEN the functional gate fires for a `commercial` product, THE SYSTEM SHALL route it to the functional reviewer; WHEN the technical gate fires for a `commercial` product, THE SYSTEM SHALL route it to the architect.
- WHEN a product lists its own participant roster in `config/products.yaml`, THE SYSTEM SHALL resolve the eligible reviewers from that roster ahead of the `config/reviewers.yaml` role defaults.
- WHEN a gate is resolved, THE SYSTEM SHALL open the gate **in the workspace** for the participants holding the resolved role for the product (per-product isolation, ADR-0010/0011).
- WHEN a gate is open in the workspace, any participant holding the resolved role for the product MAY advance the task; the rest monitor silently (group decision semantics — the M1 single-architect case is trivial; multi-reviewer in US-0017).
- WHEN a notification surface is enabled for the product (Slack/Telegram per ADR-0011 + EP-04 channel topology), THE SYSTEM SHALL post a notification deep-linking to the workspace gate; the notification SHALL NOT carry decision controls.
- IF a product's `product_type` is missing or unknown, THEN THE SYSTEM SHALL default to `technical` (architect reviews everything) and log a warning rather than blocking.

## Out of scope

- The gate UI/interaction itself in the workspace (US-0032 — the M1 discuss+decide slice of US-0030).
- Group-decision/authorisation semantics for multi-role-holder products (US-0017).
- Notification channel resolution and PR-lifecycle notifications (EP-04: US-0040, US-0041 — M3).

## Notes

Routing is always resolved from `config/reviewers.yaml`, never hardcoded — so the matrix is auditable and changeable without a code change (semantic changes to the matrix require an ADR per ADR-0003).
