---
title: "US-0020: Orchestrate a delivery task through its stages and gates"
persona: architect
status: draft
complexity: L
last_updated: 2026-05-25
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/components/orchestrator.md
  - docs/architecture/decisions/0008-system-of-record-and-persistence.md
  - docs/architecture/decisions/0004-agents-propose-via-pr-humans-merge.md
  - docs/architecture/data-model.md
---

## Story

As the architect,
I want the orchestrator to drive each delivery task through its stages and gates against durable state,
so that the pipeline is reliable, recoverable, and free of LLM nondeterminism — and a crashed run resumes where it left off.

## Context

The conductor ([`orchestrator.md`](../../../architecture/components/orchestrator.md)). It owns delivery-task and gate state as an append-only event log whose projection is current state ([ADR-0008](../../../architecture/decisions/0008-system-of-record-and-persistence.md)), resolves reviewer routing (US-0012), dispatches each stage to the right agent, and performs no LLM inference.

## Acceptance criteria (EARS)

- WHEN a delivery task changes state, THE SYSTEM SHALL append the transition to an immutable event log and derive current state as a projection of that log.
- WHEN the process restarts mid-task, THE SYSTEM SHALL rehydrate task and gate state by replaying the event log, and in-flight gates SHALL keep their already-resolved assignee.
- WHEN a stage completes, THE SYSTEM SHALL dispatch the next stage to the correct agent, and SHALL NOT advance past a gate without an explicit positive human decision.
- WHEN a reviewer selects request-changes at a gate, THE SYSTEM SHALL return the task to the stage that produced the artifact, carrying the feedback.
- IF a gate reaches its timeout with no decision, THEN THE SYSTEM SHALL act per `config/reviewers.yaml` `on_timeout` (escalate or cancel) and SHALL NEVER auto-approve.
- IF an agent or `ModelClient` call fails past its retry budget, THEN THE SYSTEM SHALL move the task to `blocked` and notify the architect in Slack.
- THE SYSTEM SHALL contain no code path that merges a pull request or pushes to a default branch (ADR-0004).

## Out of scope

- The LLM reasoning itself — the crew, via the `ModelClient` (US-0021).
- The audit tier's retention and tamper-evidence (US-0022).
- The durable-execution-engine choice (Agent SDK vs Temporal-style vs event-log+snapshot) — deferred (ADR-0008); event-sourcing holds either way.

## Notes

The orchestrator conducts; intelligence lives in the crew (`overview.md`). `StateStore` is event-sourced, starting on SQLite with a Postgres path (ADR-0008).
