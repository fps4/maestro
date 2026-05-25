---
title: "0003: Split-review routing matrix — product type × gate → reviewer"
status: accepted
date: 2026-05-24
related:
  - 0001-architect-directed-agentic-delivery.md
  - 0005-product-domain-model.md
  - ../../../config/reviewers.yaml
  - ../../product/user-stories/EP-01-delivery-loop/US-0012-route-review-by-product-type.md
---

## Context

The architect's review requirement has two distinct shapes:

- **Functional review** (what is being built) — for *commercial* products this is owned by someone else (a product/business reviewer), so the architect's attention stays on technical correctness rather than commercial product definition.
- **Technical review** (architecture, code) — the architect does this for everything.

For *technical* products the architect does all reviews. So routing depends on two axes: the **product type** (`commercial` | `technical`) and the **gate** (`functional` | `technical`). A single on/off approval flag is too coarse to express "different reviewers for different gates depending on product type."

## Decision

Resolve `(product_type, gate) → reviewer` from a matrix configured in [`config/reviewers.yaml`](../../../config/reviewers.yaml):

| Gate ↓ / Product → | commercial | technical |
|---|---|---|
| **functional** | functional_reviewer | architect |
| **technical** | architect | architect |

The rule collapses to: **the reviewer is always the architect, except the functional gate on commercial products, which routes to the functional reviewer.**

- Routing is **always resolved from config, never hardcoded** in orchestrator or agent code.
- `product_type` and the participant roster live on the **product** (see [ADR-0005](0005-product-domain-model.md)); a delivery task inherits them. `product_type` defaults to `technical` when unspecified (architect reviews everything).
- Gate mechanics — approve / request-changes / reject, timeout, Slack surface — are uniform across both gates.
- **Semantic changes to the matrix** (adding an axis or a gate, changing who can be a default reviewer) require a new ADR. Routing *values* (which handle is the functional reviewer for a given product) are config, not ADR-level.

## Consequences

- **The architect's attention is protected exactly where intended.** The only review that leaves the architect is commercial functional sign-off.
- **Per-product configuration, not per-task.** Product type and participants are set once on the product; delivery tasks inherit them, keeping dispatch friction low.
- **Auditability.** Because routing is config-resolved and every gate decision is recorded, an auditor can reconstruct who was *supposed* to review and who *did*.
- **Failure mode chosen toward safety.** Unknown/missing `product_type` falls back to architect-reviews-everything rather than skipping a gate.
- **What this does not cover.** Multi-reviewer/quorum approval and roles beyond `architect` and `functional_reviewer` are out of scope until a real need appears.
