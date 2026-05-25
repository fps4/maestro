---
title: "0008: System of record and persistence"
status: accepted
date: 2026-05-25
related:
  - 0005-product-domain-model.md
  - 0009-audit-logging-and-observability.md
  - ../data-model.md
  - ../components/orchestrator.md
  - ../../../config/products.yaml
  - ../../../config/reviewers.yaml
---

## Context

maestro reasons about three kinds of state: the **product register** (products, repos, participants, product_type, deploy target, visibility), the **operational state** (delivery tasks, gates, features, requirements, requirement→task→PR traceability), and the **code** itself. We must decide where each is authoritative. [ADR-0005](0005-product-domain-model.md) already asserts "the maestro store is authoritative; mapping to GitHub is a sync concern" — this ADR makes that concrete.

Industry practice (2024–2026) is consistent:

- **GitHub is the universal system of record for code** (branches/PRs/commits); no tool tries to replace it.
- **Orchestration/conversation state is almost always a private, tool-owned store** — Devin and Factory keep session stores; Tembo names Postgres/Redis as its persistence layer; **OpenHands graduated from flat files to a Postgres event log** for ordering/recovery guarantees.
- The tools that use **"GitHub as the database"** (Copilot coding agent, Sweep) are exactly the **single-repo, single-task** ones — they own no product object, no cross-repo feature, no multi-gate governance. GitHub Issues/Projects cannot natively express Product↔Repo M:N, per-product participant roles, or cross-repo traceability; a polling orchestrator also hits GitHub's ~5k req/hr rate limits and has no transactional gate state.

## Decision

A **control-plane / data-plane hybrid** with three homes:

1. **Product register → git-tracked config-as-code.** The canonical register is [`config/products.yaml`](../../../config/products.yaml) (a sibling to [`config/reviewers.yaml`](../../../config/reviewers.yaml), which holds the routing matrix). It is slow-changing, low-cardinality, governance-critical data — so changing it **is a reviewed pull request**, which *is* the approval. At boot it is loaded into the operational store as a **read-only projection** so joins and gate-assignee resolution are queryable. Routing *logic* stays in the orchestrator's `RoutingResolver` (a pure function); the YAML supplies data, not behaviour (avoiding the CODEOWNERS expressiveness ceiling).

2. **Operational state → a maestro-owned, event-sourced store.** Delivery tasks, gates, features, requirements, and traceability live in maestro's own store (**start with SQLite, design for Postgres**). State transitions are an **append-only event log that is the source of truth; current state is a materialized projection** of it (event-sourcing + CQRS). This is the same event log that serves the gate/action audit trail ([ADR-0009](0009-audit-logging-and-observability.md)) — audit and operational state are not two databases, they are one append-only log and its projections.

3. **Code → GitHub, mirrored read-only.** GitHub remains authoritative for branches, PRs, commits, CI checks, and merge protection. maestro writes *intent* to GitHub (open a `maestro/*` branch and an annotated PR) and ingests *facts* from GitHub (PR opened, checks passed, merged) **via webhooks, not polling**, writing them into its store as events. At `merge_gate` the orchestrator observes the merge event and records it to move the task to `done` (never merges — [ADR-0004](0004-agents-propose-via-pr-humans-merge.md)).

## Consequences

- **The product object becomes structural, not a fight with GitHub's data model.** M:N joins, per-product roles, and cross-repo traceability live where they fit.
- **Recoverable and auditable by construction.** Deterministic replay of the event log satisfies the orchestrator's "recoverable across restarts" requirement and the platform's audit posture; it is also the substrate for graduated/revocable autonomy and rollback.
- **Governance via PR.** Who reviews what and which repos a product spans cannot change without a reviewed commit — consistent with maestro's ethos.
- **Webhooks over polling** avoids GitHub rate limits and gives timely merge/PR facts.
- **Resolves the open questions** in [`orchestrator.md`](../components/orchestrator.md) and PRD-0001 about where state lives: register = config; operational = maestro event-sourced store; code = GitHub.
- **Deferred (engineering) choices, recorded as open:** whether to adopt a durable-execution engine (Temporal-style) or a lightweight event-log + snapshot implementation; the SQLite→Postgres cutover point; and whether to project task structure into GitHub sub-issues/issue-fields for the human UI (if so, those travel with the issue; Project custom fields do not, and the maestro store stays authoritative).
