---
title: "0002: Claude API direct via a single ModelClient"
status: accepted
date: 2026-05-25
related:
  - 0001-architect-directed-agentic-delivery.md
  - 0009-audit-logging-and-observability.md
  - ../../principles.md
  - ../../product/user-stories/EP-02-engine-foundation/US-0024-engine-hardening-review-gaps.md
---

## Context

maestro's agents reason with Claude. The call can be made two ways: directly via the Anthropic SDK, or through an OpenAI-compatible router/proxy that centralises egress.

A proxy buys one auditable, swappable egress — valuable when you need provider neutrality or a shared cost/audit plane across many services. But maestro is a single product on a cloud substrate, and the cost is real: a generic OpenAI-compatible shape maps **Claude-native features lossily or lags behind them** — and those features are exactly what an agentic builder depends on: **prompt caching** (a large cost/latency win when agents re-read a codebase), **extended thinking**, the native **tool-use loop**, the **Agent SDK**, large context, batch/files. A proxy also adds a hop and a service to operate.

What must *not* be lost: for an autonomous system writing to real repositories, a per-call **cost and audit trail** is genuinely valuable.

## Decision

maestro calls the **Anthropic API directly**, behind a **single internal `ModelClient`**:

- The `ModelClient` is the **only** place that talks to a model. No agent imports a provider SDK directly.
- It calls the Anthropic API directly **by default**, preserving native features (prompt caching, extended thinking, tool use, the Agent SDK).
- It **records every call** — agent, model, tokens (including cache read/write), latency, cost — to maestro's **own audit log**. maestro owns its audit trail.
- Its **`base_url` is configurable**, so pointing it at any OpenAI/Anthropic-compatible router is a config change, not a code change. Such a router is an *optional* escape hatch (e.g. to send cheap auxiliary calls to a local model later), never a dependency.

### Budget caps and provenance (US-0024 H2 + M7)

Recording spend is necessary but not sufficient: the audit shows the burn *after* the fact, and an agentic loop (extended thinking + tool use + a request_changes storm) can run material cost before anyone looks. The `ModelClient` therefore also **enforces**, not just records:

- **Hard budget caps.** Before each call the client sums the recorded `cost_usd` for the run (and for the trailing 24h) and **hard-refuses** the call — raising `CostCapExceeded`, hitting no provider — once a configured `per_run_usd_cap` / `per_day_usd_cap` is met. Caps are env-config (`MAESTRO_PER_RUN_USD_CAP` / `MAESTRO_PER_DAY_USD_CAP`), read per-call so ops can tighten them without a restart; unset means uncapped (the prior behaviour). This is the per-call complement to the refinement-loop cap (US-0020/US-0024 H2, write-API side) and the instance-wide drain switch.
- **Prompt provenance.** Every recorded call carries `prompt_template_id` + `prompt_template_version` (the git blob SHA of the prompt file) so a decision is traceable to *which prompt at which version* produced it — replay determinism and EU AI Act traceability (ADR-0009/0014).

## Consequences

- **Native capability now.** Prompt caching and extended thinking are available immediately; the implementation must keep the direct path so these are preserved (an OpenAI-compat detour would defeat the decision).
- **maestro owns its audit/cost trail.** The `ModelClient` audit log is the system of record for LLM spend and replay.
- **One narrow internal contract** — the `ModelClient` interface — instead of an external one. Swapping models or providers is a `ModelClient`/config change, invisible to agents.
- **What this does not cover.** Whether to build the crew on the **Claude Agent SDK** (subagents, hooks, MCP) is a separate decision; the `ModelClient` boundary holds either way.
