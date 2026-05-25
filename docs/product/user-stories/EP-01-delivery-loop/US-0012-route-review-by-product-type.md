---
title: "US-0012: Route each gate to the right reviewer by product type"
persona: architect
status: draft
complexity: M
last_updated: 2026-05-25
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0003-split-review-routing-matrix.md
  - docs/architecture/decisions/0005-product-domain-model.md
  - docs/architecture/decisions/0008-system-of-record-and-persistence.md
  - docs/architecture/decisions/0011-multi-surface-human-control.md
---

## Story

As the architect,
I want functional and technical gates routed to the correct reviewer based on the product's type,
so that I personally review everything except the functional spec of commercial products, which goes to the functional reviewer.

## Context

Implements the split-review matrix (ADR-0003), driven by `config/reviewers.yaml`. `product_type` and the participant roster live on the product (ADR-0005); a delivery task inherits them from its product. The reviewer is always the architect, except: commercial product + functional gate → functional reviewer.

## Acceptance criteria (EARS)

- WHEN a gate fires for a delivery task whose product is `technical`, THE SYSTEM SHALL route it to the architect.
- WHEN the functional gate fires for a `commercial` product, THE SYSTEM SHALL route it to the functional reviewer; WHEN the technical gate fires for a `commercial` product, THE SYSTEM SHALL route it to the architect.
- WHEN a product lists its own participant roster in `config/products.yaml`, THE SYSTEM SHALL resolve the eligible reviewers from that roster ahead of the `config/reviewers.yaml` role defaults.
- WHEN a gate is resolved, THE SYSTEM SHALL select the surface from the role→surface policy (architect → Slack, functional_reviewer → Telegram) and the destination group from the register (the architect channel / the product's Telegram group + bot — ADR-0011).
- WHEN a gate is posted, THE SYSTEM SHALL deliver it to that destination group, and any participant holding the resolved role for the product MAY advance the task; the rest monitor silently (group decision semantics in US-0017).
- IF a product's `product_type` is missing or unknown, THEN THE SYSTEM SHALL default to `technical` (architect reviews everything) and log a warning rather than blocking.

## Out of scope

- The gate UI/interaction itself (US-0010 for functional, US-0011 for the PR technical gate).
- Surface delivery and the group-decision/authorisation semantics (US-0017).

## Notes

Routing is always resolved from `config/reviewers.yaml`, never hardcoded — so the matrix is auditable and changeable without a code change (semantic changes to the matrix require an ADR per ADR-0003).
