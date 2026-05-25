---
title: "0006: Spec-driven SDLC and Definition of Done"
status: accepted
date: 2026-05-25
related:
  - 0001-architect-directed-agentic-delivery.md
  - 0003-split-review-routing-matrix.md
  - 0004-agents-propose-via-pr-humans-merge.md
  - ../../guides/sdlc.md
  - ../../principles.md
---

## Context

maestro needs one standardised way to take work from intent to merge — otherwise each delivery task reinvents its process and quality is inconsistent. The industry has converged (2024–2026) on **spec-driven development**: tools like GitHub Spec Kit, AWS Kiro, and Tessl all make a written specification the primary artifact and code its expression, with a consistent artifact spine and human checkpoints between phases.

Two facts make this a strong fit for maestro specifically: its **split functional/technical review** (ADR-0003) maps onto the natural seam in the spec spine, and AI-generated code carries materially higher defect/vulnerability rates — so quality must be *gated by machines* before a human reviews, not left to the human to catch.

## Decision

maestro standardises a **spec-driven SDLC** with a fixed artifact spine and a machine-enforced **Definition of Done**. The method (templates, gate mechanics, the human/agent protocol) lives in [`docs/guides/sdlc.md`](../../guides/sdlc.md); this ADR records the decision and its invariants.

**Artifact spine** (each phase produces a markdown artifact that feeds the next):

1. **Charter** — product-level durable principles ([`docs/principles.md`](../../principles.md) plus product additions).
2. **Functional spec** — what & why: user stories + **acceptance criteria in EARS form** ("WHEN [condition] THE SYSTEM SHALL [behaviour]"). Owned by the functional track. → functional gate.
3. **Technical design + tasks** — architecture, data/contracts, ordered tasks. Owned by the technical track. → technical (design) gate.
4. **Implementation** — code on a `maestro/*` branch, expressed from the design.

**Invariants:**

- **EARS acceptance criteria are the contract.** Tests are generated *from* them, so "spec adherence" is automatically verifiable and the functional reviewer can trust a green check instead of reading code.
- A read-only **consistency/clarify pass** runs between spec → design → tasks to catch drift and ambiguity *before* a human is asked to approve.
- **Definition of Done — non-bypassable machine gates**, all green before the human technical (merge) gate opens, in order:
  1. spec-adherence tests (from acceptance criteria)
  2. unit / integration / e2e with a coverage threshold
  3. SAST (CodeQL or Semgrep) — block on high severity
  4. dependency + secret scanning
  5. **hallucinated-dependency check** — every added package exists and is the intended one
  6. license + SBOM check
- **Risk tiers may relax *human* review** for low-blast-radius changes, but **SAST, secret, and dependency scans are a floor that is never disabled**.

## Consequences

- **The SDLC is uniform and auditable** across every product and delivery task; standards are machine-injected (see the `standards/` package), not tribal.
- **The two gates fall out naturally:** functional reviewer owns the spec (pre-code, cheap to change); architect owns design + the vetted diff (pre-merge).
- **Humans review vetted work.** Because the DoD gates run first, the architect's technical gate sees pre-tested, pre-scanned, pre-triaged changes.
- **Hallucinated dependencies are caught as a named gate** — AI code's most distinctive failure mode — not as a side effect.
- **What this does not cover.** Concrete tool selection (CodeQL vs Semgrep; Dependabot vs Renovate; coverage thresholds) is downstream engineering, captured per product.
