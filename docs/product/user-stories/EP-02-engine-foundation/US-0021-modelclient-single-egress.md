---
title: "US-0021: Route every LLM call through the single audited ModelClient"
persona: architect
status: draft
complexity: M
last_updated: 2026-05-25
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0002-claude-api-direct-via-modelclient.md
  - docs/architecture/decisions/0009-audit-logging-and-observability.md
---

## Story

As the architect,
I want every agent's LLM call to go through one internal `ModelClient` that calls Claude directly and records the call,
so that maestro keeps native Claude features and owns a complete per-call cost and audit trail.

## Context

The only LLM egress ([ADR-0002](../../../architecture/decisions/0002-claude-api-direct-via-modelclient.md), principle 8). The `ModelClient` is transport + audit, not reasoning; no agent imports a provider SDK directly.

## Acceptance criteria (EARS)

- WHEN any agent reasons with a model, THE SYSTEM SHALL route the call through the single `ModelClient`, and no agent SHALL call a provider SDK directly.
- WHEN the `ModelClient` makes a call, THE SYSTEM SHALL call the Anthropic API directly by default and preserve native prompt caching, extended thinking, and tool use.
- WHEN a call completes, THE SYSTEM SHALL record agent identity, model, input/output tokens, cache-read and cache-write tokens as distinct keys, computed cost, latency, finish reason, and the `run_id` (US-0022).
- WHEN `MAESTRO_MODEL_BASE_URL` is set, THE SYSTEM SHALL route through that compatible endpoint by configuration, with no code change.
- IF a call fails, THEN THE SYSTEM SHALL still record the attempt (agent, error, latency) before surfacing the failure.

## Out of scope

- The audit store's retention, tamper-evidence, and observability aggregates (US-0022).
- Whether the crew is built on the Claude Agent SDK — deferred (ADR-0002); the `ModelClient` boundary holds either way.

## Notes

Pick one cache-accounting convention to avoid the known Anthropic cache-token double-count (ADR-0009). Native-feature preservation is the whole point of the direct path — an OpenAI-compat detour by default would defeat ADR-0002.
