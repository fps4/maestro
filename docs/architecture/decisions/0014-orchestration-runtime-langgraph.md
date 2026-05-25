---
title: "0014: Orchestration runtime — LangGraph, with maestro's event log authoritative"
status: accepted
date: 2026-05-25
related:
  - 0002-claude-api-direct-via-modelclient.md
  - 0008-system-of-record-and-persistence.md
  - 0009-audit-logging-and-observability.md
  - ../components/orchestrator.md
  - ../../../spikes/langgraph/README.md
---

## Context

The orchestrator needs a runtime for the gated delivery loop: durable, recoverable across restarts,
pausing for human decisions at gates, and free of LLM nondeterminism in the control flow
([`orchestrator.md`](../components/orchestrator.md)). That open "engine" question — Claude Agent SDK
vs Temporal-style durable execution vs a lightweight event-log + snapshot — was deferred pending a
prototype. LangGraph became the de-facto durable-agent runtime in 2025/2026 and was the obvious
candidate, but it overlaps with three decisions already made (the `ModelClient` egress, the
event-sourced system of record, the OTel observability stance), so we spiked it before deciding.

The spike ([`spikes/langgraph/`](../../../spikes/langgraph/)) ran the full loop end to end and
established: gates map cleanly to `interrupt()` / `Command(resume=...)` (incl. request-changes
loop-back); state resumes across **separate processes** via the checkpointer; the bounded-role crew
runs as nodes + subagents with **reviewer ≠ author** preserved; and full task state can be rebuilt
from the **event log alone**, with no checkpointer.

## Decision

Adopt **LangGraph** as the orchestration runtime, with three boundaries held firm so prior decisions survive:

1. **LangGraph runs the loop.** Gates are `interrupt()`/`Command(resume=...)`; durability is a
   checkpointer (**SQLite → Postgres**, matching ADR-0008's storage path); the crew runs as graph
   nodes with subagent fan-out (e.g. build → test + reviewer).
2. **The `ModelClient` stays the single LLM egress (ADR-0002).** Nodes reason only through it — never
   LangChain's LLM wrappers. (Spike-verified: five distinct agents, all via the `ModelClient`.)
3. **maestro's append-only event log stays the authoritative system of record and audit tier
   (ADR-0008/0009); the LangGraph checkpointer is a rebuildable *execution cache*, not a source of
   truth.** Domain state is projected from the event log (CQRS); the checkpointer only carries
   resumability of in-flight runs and may be rebuilt or discarded. (Spike-verified: `run.py project`
   reconstructs state from events alone.)
4. **Observability stays OTel (ADR-0009), not LangSmith as a dependency.** LangSmith may be used in
   dev; the audit/metrics tier remains OTel-GenAI for vendor portability (Datadog, etc.). LangGraph
   does not pull LangSmith onto the critical path.
5. The **reviewer ≠ author** boundary (ADR-0004) is enforced at the crew layer. (Spike-verified.)

## Consequences

- **Resolves the orchestrator's open "engine" question and the roadmap's pre-M0 runtime gate — M0 can start.**
- **Durable execution + human-in-the-loop come for free**; restart-resume is demonstrated, satisfying
  the orchestrator's recoverability requirement without bespoke machinery.
- **Two persistence layers by design:** the event log (authoritative, audited) and the checkpointer
  (execution cache). The standing contract — *never let the checkpointer become a second, divergent
  source of truth; rebuild/reconcile it from the event log.* A follow-up engineering note will pin the
  exact projection + reconciliation.
- **ADR-0002 / 0008 / 0009 are preserved, not overridden** — LangGraph is the runtime, the
  `ModelClient` the egress, the event log the record, OTel the observability.
- **Accepts a LangChain/LangGraph ecosystem coupling** — mitigated by holding the `ModelClient`, event
  log, and OTel boundaries, so a future runtime swap stays bounded.
- **What this does not cover:** LangGraph Platform for deployment (deferred); the precise
  projection/reconciliation contract (follow-up); and the reviewer surface / web-UI question
  (ADR-0013) — separate and still open.
