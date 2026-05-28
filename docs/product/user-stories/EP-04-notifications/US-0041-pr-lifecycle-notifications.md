---
title: "US-0041: Slack notifications for PR lifecycle events (deep-link into the workspace)"
persona: architect
status: draft
complexity: M
milestone: M3
last_updated: 2026-05-28
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0011-multi-surface-human-control.md
  - docs/architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - docs/architecture/decisions/0017-github-app-and-webhook-ingestion.md
  - docs/architecture/webapp-concept.md
  - docs/product/user-stories/EP-04-notifications/US-0040-notification-channel-topology.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0011-implement-and-open-pr.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0017-group-surface-gate-approval.md
---

## Story

As the architect,
I want a short Slack message in the right channel when one of maestro's PRs moves through its lifecycle (opened, merge gate pending, changes requested, approved, merged, blocked) — each one deep-linking into the workspace —
so that I don't have to poll GitHub or the workspace to know something needs me, and the workspace stays the place I actually act.

## Context

Implements the M3 line of [`roadmap.md`](../../../roadmap.md): *"Slack/Telegram demoted to notification channels that deep-link into the workspace,"* refining the surface model from [`webapp-concept.md`](../../../architecture/webapp-concept.md) (Slack/Telegram are notification + deep-link, not the decision surface). The workspace remains the gate surface ([ADR-0015](../../../architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md) / ADR-0016).

Destination resolution is **US-0040**'s job; this story is the lifecycle event set and the message contract. PR state can be sourced either from the [ADR-0017](../../../architecture/decisions/0017-github-app-and-webhook-ingestion.md) webhook ingest (preferred — already the spec index's source of truth) or from maestro-internal events the orchestrator emits; this story consumes either, it does not pick the producer.

## Acceptance criteria (EARS)

- WHEN maestro opens a PR on behalf of a delivery task (US-0011), THE SYSTEM SHALL post **one** Slack notification to the resolved channel (US-0040) containing: product, task id, PR title, PR URL, **workspace task URL**, and the producing agent.
- WHEN the **merge gate** opens for a task in the workspace, THE SYSTEM SHALL post a "needs your decision" notification to the architect's resolved channel with the workspace gate URL; the notification SHALL **not** carry approve/reject controls (the decision happens in the workspace per ADR-0015/0016).
- WHEN a PR transitions to **changes-requested**, **approved**, or **merged**, THE SYSTEM SHALL post one notification per transition, each carrying the workspace task URL alongside the PR URL.
- WHEN a delivery task transitions to **`blocked`** (US-0020), THE SYSTEM SHALL post one notification naming the blocking reason and the workspace task URL.
- THE SYSTEM SHALL **deduplicate**: replaying the same lifecycle event SHALL NOT produce a duplicate notification; the notifier SHALL key on `(task_id, event_kind, source_event_id)` and skip already-sent keys.
- THE SYSTEM SHALL record each sent notification (channel_id, message_ts, event_kind, task_id) in the audit log, so a missing or duplicated notification is replayable / debuggable from the event store ([ADR-0008](../../../architecture/decisions/0008-system-of-record-and-persistence.md)).
- IF the resolved Slack channel is unreachable (network, auth, channel archived), THEN THE SYSTEM SHALL retry with backoff, fall back to the shared architect channel per US-0040, and SHALL NOT block the underlying delivery task on a notification failure.
- THE SYSTEM SHALL render the notification using a compact template (one line + a fields block) that fits one Slack viewport on desktop and mobile; the message SHALL include the product id so the architect can tell products apart without opening the link.
- WHILE the workspace is unreachable, THE SYSTEM SHALL still send the GitHub URL but SHALL mark the workspace deep-link as "workspace offline — try later"; the notification SHALL NOT be suppressed.

## Out of scope

- **Interactive controls inside Slack** (approve / request-changes / reject as Slack buttons). Decisions live in the workspace (ADR-0015/0016). A future "lightweight ack from Slack" story can plug into the same notifier.
- **Telegram lifecycle notifications.** The functional-reviewer audience still receives gates via Telegram (ADR-0011); a Telegram notification track can reuse the resolver from US-0040 but is its own story.
- **CI-status notifications** (build green/red). Definition-of-Done gates live on the PR; if/when CI status crosses into Slack, it joins this notifier rather than reinventing one.
- **Cross-product digests** (e.g. "here's what shipped today"). The inbox (S6, US-0030) covers cross-product visibility in the workspace.
- **Producing the PR events themselves** — covered by US-0011 (PR open) and the [ADR-0017](../../../architecture/decisions/0017-github-app-and-webhook-ingestion.md) webhook reconciler (PR updates / merges). This story consumes them.

## Notes

The deep-link discipline ("notify in Slack, decide in the workspace") is what keeps Slack from drifting back into being a decision surface. Every notification should answer two questions in the first line: *"which product / task?"* and *"do I need to do something?"* — the rest is supporting detail.

The notifier reads the **same event log** the workspace reads (ADR-0008); it is a projection consumer, not a parallel state machine. That keeps the audit story simple (one log, one truth) and makes the dedup key trivially correct.
