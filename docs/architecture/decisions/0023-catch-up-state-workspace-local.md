---
title: "0023: Catch-up state — workspace-local per-fetch markers, not event-log entries"
status: proposed
date: 2026-05-28
related:
  - 0008-system-of-record-and-persistence.md
  - 0009-audit-logging-and-observability.md
  - 0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - 0017-github-app-and-webhook-ingestion.md
  - 0018-workspace-read-api-and-frontmatter-index.md
  - ../workspace-ux-design.md
  - ../components/workspace-backend.md
  - ../../product/user-stories/EP-03-reviewer-surface/US-0030-reviewer-webapp-and-wiki.md
  - ../../product/user-stories/EP-03-reviewer-surface/US-0031-workspace-ux-design.md
---

## Context

[`workspace-ux-design.md`](../workspace-ux-design.md) layout principle **P6 — Catch-up via "since you were last here"** needs a per-participant last-seen marker for every task they have access to. The inbox (US-0030 S6, M3) uses it to bubble tasks with unread changes ahead of read ones; the per-task view uses it to mark new comments / decisions / responses.

The open question (`workspace-ux-design.md` §open-questions) asked whether this marker lives in the **event log** (a `participant.viewed` event per fetch) or as **workspace-local state**. The choice has two real consequences: event-log churn and the [ADR-0015](0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md) invariant that the workspace holds no authoritative state.

Three options:

- **A — Event log.** Append a `participant.viewed` event whenever a participant loads a per-task view. Audit-complete; cold-start-survivable. Inflates the log 10–100× — most writes are not state changes — and adds a noisy event kind the projection has to filter out of business views.
- **B — Workspace-local table.** A `(participant, task) → last_seen_seq` table in the workspace backend, updated per fetch. Tiny, cheap, cold-start-empty (a fresh deployment shows "everything is new" for one cycle).
- **C — Derive from the log without writing.** Impossible — without a marker, there is nothing to compare a comment's `seq` against. Listed for completeness.

The question to answer is: *is the catch-up marker authoritative state?* If yes, it must live in the event log. If no, the workspace can own it.

## Decision

**Option B — workspace-local per-fetch markers, not event-log entries.** The catch-up marker is **not authoritative state**: it is a per-participant rendering convenience, like an email client's read/unread flag. Losing it on a cold start is a single-cycle annoyance, not a business correctness failure. The ADR-0015 invariant (workspace holds **no authoritative state**) is preserved; "authoritative" excludes per-user rendering caches.

### Schema (workspace backend)

```sql
participant_view_marker (
  participant_id  TEXT NOT NULL,
  task_id         TEXT NOT NULL,
  last_seen_seq   INTEGER NOT NULL,   -- max(event.seq) projected into the view the participant rendered
  last_seen_at    TEXT NOT NULL,      -- ISO 8601
  PRIMARY KEY (participant_id, task_id)
)
```

Lives in the **workspace backend's own SQLite/Postgres** ([`workspace-backend.md`](../components/workspace-backend.md)), beside the spec index and projection caches. **Not** in the event log. **Not** replicated across workspace instances in M1 (multi-instance shared cache lands when concurrency demands it, ADR-0008 staging).

### Update rule

WHEN a per-task view is rendered to a participant, the workspace backend records (upsert):

```
last_seen_seq := max(event.seq projected into the response)
last_seen_at  := now()
```

The marker advances **only forward** — a stale write (lower `last_seen_seq` than current) is ignored. Concurrent renders by the same participant on the same task converge correctly.

### Catch-up rule

An event with `event.seq > last_seen_seq` for `(participant, task)` is **"new since you were last here."** The workspace surfaces this in two places, per [`workspace-ux-design.md`](../workspace-ux-design.md):

- The **per-task view** marks new comments / decisions / responses with an "unread" indicator (P6).
- The **inbox** (S6, M3) sorts tasks with `unread > 0` ahead of those without, then chronologically.

### Cold-start behaviour

A fresh workspace deployment with an empty `participant_view_marker` table treats every event as "new." The participant sees their inbox as if returning from a long absence — surfaceable as a one-time banner ("welcome back — showing all unread") if it confuses, but not built in M1. This is **explicitly accepted**: the loss is a single-cycle rendering annoyance, not data loss.

## Consequences

- **Event log stays focused on state changes the business cares about** (dispatches, comments, decisions, responses, merges) — no inflation by per-page-view events.
- **The ADR-0015 invariant holds.** The catch-up table is a rendering cache, not a system-of-record store; the event log remains the only authoritative store of what happened on the task.
- **Catch-up state is per workspace instance** until multi-instance sharing lands (ADR-0008 Postgres cutover). Acceptable through M1–M3 dogfooding; revisit at the multi-architect / multi-reviewer point.
- **No new event kind, no new projection.** The marker reads `max(event.seq)` already projected into the view it just rendered — no separate query path against the event log.
- **The audit story is unchanged.** Audit cares about decisions and edits, not views. The omission of view tracking from the event log is by design — not a gap.

## Trade-offs explicit

- **Cold-start "everything is new" is the cost of B.** The alternative — A (events) — costs much more (log inflation, projection filtering) for an audit property nobody asked for. Accept the cold-start annoyance.
- **No cross-instance sync in M1.** If a participant opens the workspace from two instances (e.g. failover, dev/prod), each has its own marker. Negligible at single-architect dogfood; explicit to flag for multi-instance future.
- **A future migration to event-log is reversible.** If, post-MVP, the architect wants a view-audit, the `participant_view_marker` table can be replayed onto a new `participant.viewed` event stream without changing what's authoritative — the workspace would just start replaying the event log to populate the table as well as writing to it.

## Open questions

- **Inbox bucketing.** How `unread > 0` ranks against gate-pending state when a task has both is a UX call settled in [`workspace-ux-design.md`](../workspace-ux-design.md) (inline) — not in this ADR.
- **Per-anchor catch-up.** "New comment on AC-3 since last visit" is a finer grain than "task has unread items." M1 ships task-level only; per-anchor is a P6 refinement when the comment volume justifies it.
- **Persistence across instances.** When the M3 inbox lands, the marker may need to survive workspace failover. Solved by the SQLite → Postgres cutover (ADR-0008); not in M1.
