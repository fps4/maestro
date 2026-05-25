---
title: "Component design: orchestrator (the conductor)"
status: draft
last_updated: 2026-05-25
owners: [architect]
c4_level: component
container: orchestrator
related:
  - docs/architecture/overview.md
  - docs/architecture/decisions/0003-split-review-routing-matrix.md
  - docs/architecture/decisions/0004-agents-propose-via-pr-humans-merge.md
  - docs/architecture/decisions/0005-product-domain-model.md
  - docs/architecture/decisions/0011-multi-surface-human-control.md
---

## Purpose

The orchestrator is maestro's conductor: it sequences the agent crew, owns delivery-task / gate / product state, and resolves reviewer routing. It exists as a separate container because the sequencing/gating logic must be reliable, recoverable, and free of LLM nondeterminism — so it contains **no LLM inference** (that lives in the crew, which reaches Claude only through the `ModelClient`).

## Responsibilities

**Owns:**
- The delivery-task lifecycle and `stage`/`status` transitions (see `data-model.md`).
- Gate creation, reviewer resolution via `config/reviewers.yaml` + product membership, and waiting for human decisions.
- Dispatching each stage to the correct agent and handling request-changes loops.
- Enforcing the safety boundary: it never invokes a merge or a default-branch push (ADR-0004).

**Does not own:**
- Any LLM reasoning — delegated to the crew (which calls the `ModelClient`).
- Talking to GitHub, Slack, or Telegram directly — delegated to the adapters (the surface layer for human control; ADR-0011).
- The merge decision — that is the human's, at the gate.

## Internal structure

| Component | Responsibility |
|-----------|----------------|
| `TaskCoordinator` | Drives a delivery task through its stages; the state machine over `DeliveryTask.stage` |
| `GateManager` | Creates gates, resolves surface + destination via `RoutingResolver`, delivers through the surface layer, waits for a decision from any eligible role-holder (quorum 1), records the decider, ignores actions from non-role-holders, applies approve/request-changes/reject |
| `RoutingResolver` | Pure function, never hardcoded (ADR-0003): resolves `(product_type, gate_type) → role` from the `config/reviewers.yaml` matrix, then `role → surface → destination group` (ADR-0011) — architect → the shared architect Slack channel; functional_reviewer → the product's Telegram group + bot from the register. Eligible deciders are the product's participants holding that role |
| `AgentDispatcher` | Invokes the right agent for the current stage with task + product context; agents reason via the `ModelClient` |
| `StateStore` | Persists task / gate / product state as an **append-only event log** (the source of truth); current state is a materialized projection, so the pipeline is recoverable across restarts via replay (ADR-0008). The product register is loaded read-only from `config/products.yaml`. |

## Key flows

### Happy path: advance a task through a gate

1. `TaskCoordinator` reaches a gate stage (e.g. `functional_gate`).
2. `GateManager` asks `RoutingResolver` for the surface + destination of `(product.product_type, functional)` — e.g. the product's Telegram group for a commercial functional gate.
3. `GateManager` creates a `Gate` record and asks the resolved surface adapter (slack or telegram) to deliver the approval request to the destination group.
4. Any participant holding that role decides; the surface adapter relays it; `GateManager` verifies the decider holds the role, records who/when, and resolves the gate. Actions from non-role-holders are ignored.
5. `TaskCoordinator` advances and `AgentDispatcher` invokes the next agent.

### Request-changes loop

1. Reviewer selects request-changes with feedback at a gate.
2. `GateManager` records the feedback and returns the task to the stage that produced the artifact.
3. The agent revises; the artifact is re-posted to the same gate. Loop until approve or reject.

### Merge is not a flow here

There is intentionally **no** orchestrator flow that merges a PR. At `merge_gate`, the orchestrator waits and observes; the human merges in GitHub; `StateStore` records the observed merge event to move the task to `done` (ADR-0004).

## Error handling and failure modes

| Failure | Behaviour |
|---------|-----------|
| Gate times out (no human decision) | Per `config/reviewers.yaml` `gate.on_timeout`: escalate (re-notify) or cancel; never auto-approve |
| Agent / ModelClient call fails | Retry with backoff; after max retries, move task to `blocked` and notify the architect in Slack |
| Process restart mid-task | `StateStore` rehydrates state; in-flight gates keep their already-resolved surface + destination |
| Product `product_type` missing | `RoutingResolver` defaults to `technical` (architect reviews everything) and logs a warning (ADR-0003) |
| Decision from a non-role-holder | Ignored and logged; the gate stays open (ADR-0011) |

## Open design questions

| Question | Owner | Status |
|----------|-------|--------|
| Does `StateStore` reuse GitHub Issues/Projects, or a maestro-owned DB? | @architect | **Resolved** — maestro-owned, event-sourced store; GitHub for code only (ADR-0008) |
| Orchestration engine: Claude Agent SDK vs Temporal-style durable execution vs a lighter event-log + snapshot? | @architect | **Resolved** — **LangGraph** (durable execution + `interrupt()` gates); the event log stays authoritative, the checkpointer is a rebuildable cache (ADR-0014) |
| SQLite to start, with a Postgres cutover when concurrency/recovery demand it? | @architect | Open |
| Is the `merge_gate` a GitHub-native review approval, a Slack approval, or both? | @architect | Open |

## Assumptions and constraints

- maestro's GitHub credentials lack merge rights (ADR-0004) — the orchestrator relies on this as a hard backstop, not just on its own discipline.
- Agents reach Claude only through the `ModelClient`; the orchestrator passes context, not completions.
- Each product has its own Telegram bot — the token is a secret referenced from the register, and a bot only ever addresses its own product's group (ADR-0011).
