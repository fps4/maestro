---
title: "US-0014: Generate and run spec-derived tests as a Definition-of-Done gate"
persona: architect
status: draft
complexity: L
milestone: M2
last_updated: 2026-05-29
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0006-spec-driven-sdlc.md
  - standards/testing.yaml
---

## Story

As the architect,
I want the test agent to generate and run tests derived from the functional spec's EARS acceptance criteria,
so that "spec adherence" is machine-verified and I can trust a green check instead of reading code.

## Context

A Definition-of-Done gate ([ADR-0006](../../../architecture/decisions/0006-spec-driven-sdlc.md), [`standards/testing.yaml`](../../../../standards/testing.yaml)). The test agent acts on the open PR from US-0011; the orchestrator (US-0020) opens the technical merge gate only when this and the other DoD gates are green.

## Acceptance criteria (EARS)

- WHEN a delivery task reaches the build stage, THE SYSTEM SHALL generate at least one test for every EARS acceptance criterion in the functional spec.
- WHEN tests run, THE SYSTEM SHALL execute unit and integration suites — and e2e where the product has user-facing flows — and report pass/fail per scenario.
- IF coverage would regress below the maintained threshold, THEN THE SYSTEM SHALL fail the gate rather than lower the threshold.
- WHILE acting on a delivery task, THE SYSTEM SHALL write and run tests only and SHALL NOT modify production code.
- IF any spec-derived test fails, THEN THE SYSTEM SHALL report the failing criterion and SHALL NOT report the spec-adherence gate as green.

## Out of scope

- The SAST / secret / dependency / license-SBOM floors (`standards/security.yaml`, run in CI — see `.github/workflows/dod.yml`).
- The independent diff review (US-0015) and doc updates (US-0016).

## Notes

The test agent does not refactor production code (`testing.yaml`). Spec-adherence is the first DoD gate in order; the security floors are never disabled.
