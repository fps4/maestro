---
title: "US-0018: Revert a merged PR through an attributed revert task"
persona: architect
status: draft
complexity: M
milestone: M5
last_updated: 2026-05-30
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0016-merge-after-workspace-approval.md
  - docs/architecture/data-model.md
  - docs/product/user-stories/EP-02-engine-foundation/US-0020-orchestrate-delivery-task.md
  - docs/product/user-stories/EP-02-engine-foundation/US-0024-engine-hardening-review-gaps.md
---

## Story

As the architect,
I want to revert a merged PR through maestro with a single workspace affordance that opens an attributed revert task,
so that the first post-merge defect (inevitable for AI-generated code) hits a defined flow that the audit chain captures — not a manual scramble outside the loop.

## Context

ADR-0016 makes the merge attributed and permanent; the vision's lagging metric ("share of merged PRs with no post-merge revert") presumes reverts happen, yet no revert flow exists. This story defines it (US-0024 H5). **Deferred to M5** — placed here so the gap is specified, not silent; until it lands the architect reverts manually on GitHub.

## Acceptance criteria (EARS)

- WHEN the architect chooses "revert merged PR" on a done task in the workspace, THE SYSTEM SHALL open a `revert_task` of kind `revert`, on a `maestro/revert-*` branch, referencing the original `merge.executed` event.
- WHEN a revert task runs, THE SYSTEM SHALL open a revert PR (the inverse diff) through the normal agent-proposes path and route it through a **single technical merge gate** (no spec/design stages — the change is mechanical).
- WHEN the architect approves the revert gate, THE SYSTEM SHALL merge via the same event-gated ADR-0016 boundary and emit `revert.requested` → `revert.executed`, both linked to the original `merge.executed`.
- THE SYSTEM SHALL leave the reverted feature re-enterable as a fresh delivery task (a revert is not a cancellation of the feature's history).

## Out of scope

- Auto-detecting which merge to revert (the architect names it).
- Rollback of side effects beyond the repo (migrations, deploys) — a deploy-rollback concern, not this loop.

## Notes

A revert is a delivery task with a degraded single-gate flow, not a new primitive — it reuses the merge boundary, the event log, and attribution. The `revert.*` events linked to `merge.executed` keep the audit chain continuous across the defect → revert → re-file lifecycle.
