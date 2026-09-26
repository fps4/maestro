---
title: Versions may be effective-dated, and a material change lapses an acceptance
status: proposed
date: 2026-08-06
deciders: [architect]
related:
  - ./0003-immutable-versions-mutable-drafts.md
  - ./0008-the-catalogue-is-a-workspace.md
---

# ADR-0010 — Effective dating, and acceptance lapse

## Context

A tenant artifact is accepted or it is not, and that has been enough. A standard is not like that in
two ways.

**Accepted and *in force* are different questions.** A regulation is approved in June and applies
from January. A collective agreement expires with nothing following it — a legislative gap, which is
the normal case rather than an error. The design had no answer for what an artifact resting on a
standard in that gap *is*.

**An acceptance is against a version, and versions move.** An advisor reads a standard and accepts
it on behalf of the tenant. If the standard is later changed materially, what was accepted is not
what is now in force — and nothing in the model noticed.

## Decision

**Three additions, all opt-in per type.**

1. **`effective_from` / `effective_to` on a version**, enabled by `effective_dating: true` on the
   type. A version reports `in_force`, `pending`, `lapsed` or `undated`, independently of its
   acceptance state.
2. **`lapse_behaviour`** — `fail` (default), `unregulated`, or `freeze_at_last` — stating what a
   claim resting on a lapsed standard becomes. The pack states it per standard because the honest
   answer differs: a safety instrument between versions is not a cost-coding convention between
   versions.
3. **Materiality on the publication decision**, enabled by `records_materiality: true` on the gate.
   **Only a material later version lapses an acceptance.** An immaterial one — a typo, a clarified
   example — does not.

Materiality is a **decision a person records**, not a diff the service computes. Inferring it from
the fact that something changed would lapse every acceptance on a corrected typo, and a control that
fires constantly is a control everyone learns to dismiss.

**A lapse is a state, not a notification.** It is recomputed and stored, so it survives being
ignored — which is the whole difference between a control and a message.

## Consequences

**A gate can now be blocked by something that happened in another workspace**, at a time nobody in
this one chose. That is correct and it is also new: it is declared per gate
(`catalogue_acceptances`), because a lapse that must block release legitimately need not block an
early gate. Where it does not block, it is still *shown and recorded*, so the decision carries the
fact that the reviewer knew.

**The version envelope grew.** Effective dating is on every version's shape even though only
catalogue types use it. Accepted: a second envelope would be worse.

**Nothing schedules the recomputation yet.** `refresh` is exposed and idempotent, and a consumer
drives it. In-service scheduling is deliberately not built — the service holds lifecycle state and
decisions, and a clock belongs to whoever owns the subject it fires on.
