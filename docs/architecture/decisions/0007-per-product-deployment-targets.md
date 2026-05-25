---
title: "0007: Per-product deployment targets"
status: accepted
date: 2026-05-25
related:
  - 0001-architect-directed-agentic-delivery.md
  - 0005-product-domain-model.md
  - ../../principles.md
---

## Context

maestro builds products with different needs. Some are happy on a lab server; some need a specific cloud because their technology requires it (a managed service, a region, a compliance constraint) from day one. Forcing a single hosting target would either waste the lab capacity or block products that need a particular cloud. There is also a development/self-hosting need: maestro itself, and the products it builds, must be runnable somewhere by default without ceremony.

## Decision

Deployment target is a **per-product setting**, chosen in preference order but kept open:

- **Default — lab servers (`ds1` / `ds2`):** development and self-hosting. maestro itself can run here.
- **Production option — AWS:** the standard target when a product goes to production.
- **Exception, from day one — AWS / Azure / GCP:** if the product's technology requires a specific cloud up front, that cloud is the product's infra platform. The choice and its rationale are written up in the product's own docs.

The target is recorded on the product (see [ADR-0005](0005-product-domain-model.md)); the provisioning/deploy capability itself is a **later build phase** — this ADR records the model, not an implementation.

## Consequences

- **No platform lock-in.** A product picks the target that fits; the default keeps lab servers useful and zero-ceremony.
- **Cloud-from-day-one is a first-class, documented exception** — not a workaround. When chosen, the product's infra docs become the source of truth for that target.
- **maestro is self-hostable** on the lab servers, consistent with the "deploy where it needs" principle.
- **Deferred build.** Until the provisioning/deploy phase lands, deployment is manual; the per-product target is still recorded so the future capability has a contract to implement.
- **What this does not cover.** The provisioning mechanism (IaC tool, CI deploy step, runners) and per-target specifics are downstream decisions, captured when the deploy phase is built.
