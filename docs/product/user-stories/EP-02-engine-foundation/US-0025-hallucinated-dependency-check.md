---
title: "US-0025: Hallucinated-dependency check as a named DoD gate"
persona: architect
status: draft
complexity: S
milestone: M3
last_updated: 2026-05-30
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/principles.md
  - docs/architecture/decisions/0006-spec-driven-sdlc.md
  - docs/product/user-stories/EP-02-engine-foundation/US-0024-engine-hardening-review-gaps.md
---

## Story

As the architect,
I want a concrete tool behind the "hallucinated-dependency check" DoD floor,
so that AI code's signature failure mode (importing a package that doesn't exist, or a typosquat of one that does) is actually caught — not listed as a floor that ships as vapour.

## Context

Principle 4 and ADR-0006 name "hallucinated-dependency check — every added package exists and is the intended one" as a floor that is **never disabled**, but no tool is pinned (US-0024 M6). Vulnerability scanners (`pip-audit`, `osv-scanner`) check *known-bad*, not *exists-at-all* or *typosquat* — a different check. **Decision:** pin/implement a registry-presence + typosquat checker. **Deferred to M3** (DoD hardening); specified now so the floor isn't mistaken for already-covered.

## Acceptance criteria (EARS)

- WHEN a PR adds or changes a dependency, THE SYSTEM SHALL verify each added package **exists** in its registry index (PyPI / npm / etc. per ecosystem) and fail the gate if it does not.
- WHEN an added package name is within a small edit distance of a top-popularity package it is not, THE SYSTEM SHALL flag it as a possible typosquat for human review.
- THE check SHALL run as a named DoD gate (distinct from the vuln scan) so a green vuln scan never masks a missing/typosquatted package.
- THE check SHALL be deterministic and offline-cacheable enough to run in CI without a per-run network dependency on the full registry.

## Out of scope

- Vulnerability scanning (the separate, existing dep-scan floor).
- License/SBOM (its own floor).

## Notes

Implementation is small (~parse the manifest → query the registry index → fuzzy-match against a bundled top-1k popular-packages list for the typosquat signal). The value is that the floor stops being aspirational: a named gate, not a side effect of the vuln scanner. Consumed by the DoD-CI template (US-0002).
