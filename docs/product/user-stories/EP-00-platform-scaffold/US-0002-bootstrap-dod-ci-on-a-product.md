---
title: "US-0002: Bootstrap the Definition-of-Done CI on an onboarded product"
persona: architect
status: draft
complexity: M
milestone: M4
last_updated: 2026-05-30
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/principles.md
  - docs/architecture/decisions/0006-spec-driven-sdlc.md
  - docs/guides/onboarding-a-product.md
  - docs/product/user-stories/EP-02-engine-foundation/US-0024-engine-hardening-review-gaps.md
---

## Story

As the architect onboarding a new product,
I want maestro to lay down the Definition-of-Done CI gates as a template,
so that "set up six CI gates correctly" isn't an undocumented onboarding tax that the loop's own DoD floor (principle 4) silently depends on.

## Context

For maestro itself the DoD workflows pre-exist; for the *second* product (adoption rung 3) there is no maestro story to stand them up — the onboarding guide lists them as a manual checklist item (`onboarding-a-product.md` §3). This story automates that lay-down (US-0024 M5). **Deferred to M4** (when the first non-dogfood product onboards); specified now so the dependency is explicit.

## Acceptance criteria (EARS)

- WHEN a product is onboarded, THE SYSTEM SHALL lay down a `.github/workflows/dod.yml` template wiring the principle-4 floor gates (SAST, secret scan, dependency scan, license/SBOM, the hallucinated-dependency check of US-0025) plus the spec-adherence test gate (US-0014).
- THE SYSTEM SHALL lay down the companion config the gates need (e.g. Renovate, the scanner configs) as templates the product can tune, not hard-coded values.
- WHERE a product already has a `dod.yml`, THE SYSTEM SHALL NOT overwrite it; it SHALL report the divergence for the architect to reconcile.
- THE onboarding flow SHALL record that the DoD CI was laid down (or skipped) so a product can't silently run with the floor gates absent.

## Out of scope

- Concrete tool selection per gate (CodeQL vs Semgrep, etc.) — downstream per ADR-0006; this ships sensible template defaults.
- Running the gates (that's the product's CI + the orchestrator's status poll, M2).

## Notes

The template is a starting point, not a lock-in: principle 4 names the *floors that are never disabled*; how each product implements them stays the product's choice. The point is that onboarding never leaves the floor un-wired by omission.
