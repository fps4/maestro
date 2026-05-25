---
title: maestro issues and known limitations
status: current
last_updated: 2026-05-25
owners: [architect]
related:
  - ../guides/documentation-standards.md
---

# Issues

Investigated defects and accepted operational constraints.

## Two document types

| Type | File | Purpose | Lifecycle |
|------|------|---------|-----------|
| **Issue with RCA** | `ISSUE-NNNN-*.md` | A defect or surprise that was investigated and explained | draft → confirmed → resolved → reopened |
| **Known limitation** | `LIMITATION-NNNN-*.md` | An understood-but-unfixed constraint we live with | current → deprecated |

Numbers are repo-local, zero-padded, sequentially assigned.

## Severity

`low` · `medium` · `high` · `critical` — the operator's read of impact at detection time, not a post-hoc estimate.

## When to write one

Open an issue file when an investigation produces a finding that took non-trivial work to diagnose, could plausibly recur, or surfaced a divergence between intent (PRDs, ADRs) and behaviour. Do **not** open one for one-off user errors or bugs caught during normal development before anything deployed was affected — a commit message suffices.

_No issues recorded yet._
