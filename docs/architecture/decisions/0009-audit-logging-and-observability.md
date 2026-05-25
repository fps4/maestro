---
title: "0009: Audit, logging and observability"
status: accepted
date: 2026-05-25
related:
  - 0002-claude-api-direct-via-modelclient.md
  - 0008-system-of-record-and-persistence.md
  - ../../principles.md
---

## Context

maestro's principles already require: every LLM call recorded with cost ([ADR-0002](0002-claude-api-direct-via-modelclient.md)), every human gate decision recorded, per-product auditability, and graduated/revocable autonomy backed by a full audit trail. These are, in effect, a logging-and-audit specification — you cannot deliver revocable autonomy or per-product auditability without durable, queryable, tamper-evident records.

The industry distinction that matters: **"logs" is not one feature.** Mature systems separate concerns by purpose, audience, mutability, and retention; conflating an immutable compliance record with disposable debug output is the anti-pattern. There is also a regulatory driver: maestro's operator is **NL/EU**, and the EU AI Act's high-risk traceability obligations (enforceable Aug 2026) expect inputs, outputs, and decision metadata to be captured as a transparent, reconstructible trail.

## Decision

Maintain **four stores, threaded by one run / correlation ID**, in two tiers.

**Source-of-truth tier (immutable, long retention):**

1. **LLM-call audit (the `ModelClient` log).** One record per call, using **OpenTelemetry GenAI** conventions: model/provider, operation, input/output tokens, **cache read & write tokens as distinct keys**, computed cost (token × price-card), latency, finish reason, `run_id`/`trace_id`/`span_id`, `product_id`, agent identity. Choose **one cache-accounting convention** to avoid the known Anthropic cache-token double-count. **Prompt/response content is off by default**, redacted-then-stored only when explicitly needed.

2. **Gate-decision & agent-action audit.** An **append-only, immutable event log** (WORM + hash-chained). This is the **same event log that is the operational system of record** in [ADR-0008](0008-system-of-record-and-persistence.md) — audit and operational state are one log and its projections (CQRS), not two databases. Each event carries: actor (agent identity / human reviewer / environment), action/type, target, timestamp + sequence, before/after (or proposed-vs-final action), and for gates the **decision + rationale**, the context shown to the reviewer, reviewer id, and the decision class (auto / approve / never).

**Operational tier (mutable, short retention, disposable — never the source of truth):**

3. **Operational logs.** Structured JSON for debugging; every line carries `run_id`/`trace_id`; rotated/deletable.

4. **Metrics / observability.** Aggregates from the same OTel pipeline: cost per product/day, token spend, latency percentiles, gate approval rates, autonomy-level distribution.

**Cross-cutting:**

- **One run/correlation ID** threads all four — every LLM call, agent action event, gate decision, and operational log line for a run is pivotable.
- **Redaction before persistence** — PII/secrets masked before any store; scoped, logged re-identification allowed for audits.
- **Retention** — audit tier ≥12 months (configurable per product/regulation); operational tier short and sampled.
- **Access control** — least-privilege RBAC, separation of duties, and the audit log's own reads/exports are audited.

## Consequences

- **Revocable autonomy becomes real and defensible** — you can prove what an agent was permitted to do, what it did, who approved each escalation, and replay/roll back to any point. This is also the kill-switch/rollback substrate.
- **EU AI Act alignment** for the high-risk traceability obligations landing Aug 2026.
- **Vendor-portable** — OTel GenAI conventions mean the LLM-audit/metrics can be shipped to Langfuse, Datadog, Honeycomb, etc. without re-instrumentation.
- **Clear tiering prevents the anti-pattern** — stores 1 & 2 are immutable and authoritative; 3 & 4 are disposable. Treating audit as "logs alongside debug output" is explicitly rejected.
- **What this does not cover.** Concrete tool/library choices (e.g. Presidio for redaction, the metrics backend, the WORM/ledger store) are downstream engineering decisions; a detailed audit-log schema contract is a follow-up under `docs/architecture/contracts/`.
