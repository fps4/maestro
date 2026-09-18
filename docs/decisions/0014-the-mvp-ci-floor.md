# ADR-0014 · The MVP CI floor: secret scan, dependency audit, SBOM

**Status:** accepted · 2026-09-18

## Context

The earlier standards layer defined build standards in four classes with a conformance job. The MVP is non-regulated and needs a floor that every repository meets from the first commit, without a standards registry.

## Decision

Every maestro repository's CI runs, on every PR: a **secret scan** (with the tenant-name custom pattern kept outside the repository), a **dependency audit** that fails on high and critical advisories, and **SBOM emission** for every built artifact. Plus the repository-shape checks in [build-standards.md](../build-standards.md). Nothing else from the earlier standards layer.

## Consequences

- The advisory lane has a source from day one: the audit's findings are signals.
- The SBOM is what lets runtime-service answer "which deployed images carry this dependency".
- A check the substrate makes unrepresentable gets a manifest entry naming what enforces it, not a silent absence.

## What would reopen it

Branch R, which adds classes and a registry above this floor and never lowers it.
