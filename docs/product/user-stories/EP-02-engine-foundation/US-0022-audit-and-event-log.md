---
title: "US-0022: Record an append-only, correlated audit and event log"
persona: architect
status: draft
complexity: L
last_updated: 2026-05-25
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0009-audit-logging-and-observability.md
  - docs/architecture/decisions/0008-system-of-record-and-persistence.md
---

## Story

As the architect,
I want every gate decision, agent action, and LLM call recorded in an immutable, correlated audit trail,
so that I can prove what an agent was permitted to do, what it did, and who approved each step — and replay any run end to end.

## Context

[ADR-0009](../../../architecture/decisions/0009-audit-logging-and-observability.md): four stores in two tiers, threaded by one correlation id, over the same append-only event log that is the operational source of truth ([ADR-0008](../../../architecture/decisions/0008-system-of-record-and-persistence.md)). Backs revocable autonomy (principle 10) and the EU AI Act traceability obligations.

## Acceptance criteria (EARS)

- WHEN a state change, agent action, gate decision, or LLM call occurs, THE SYSTEM SHALL append a record carrying the same `run_id` so the run is pivotable across all four stores.
- WHEN recording an LLM call, THE SYSTEM SHALL include `prompt_template_id` and `prompt_template_version` (the git blob SHA of the prompt file) so the call is traceable to which prompt at which version produced it (US-0024 M7).
- WHEN a gate is decided, THE SYSTEM SHALL record the decision, its rationale, the context shown to the reviewer, the reviewer id, and the decision class (auto / approve / never).
- THE SYSTEM SHALL keep the audit tier append-only and tamper-evident (WORM + hash-chained) and SHALL NOT permit edits or deletes within the retention window.
- WHEN persisting any record, THE SYSTEM SHALL redact PII and secrets before storage, and prompt/response content SHALL be off by default, stored only when explicitly enabled.
- WHEN an audit record is read or exported, THE SYSTEM SHALL record that access — the audit log's own reads are audited.
- THE SYSTEM SHALL retain the audit tier for a configurable period of at least 12 months and MAY rotate or delete the operational (debug) tier freely.

## Out of scope

- Concrete tooling (redaction library, metrics backend, WORM/ledger store) — downstream engineering (ADR-0009).
- The detailed audit-log schema contract — a follow-up under `docs/architecture/contracts/`.

## Notes

Audit and operational state are one append-only log and its projections (CQRS), not two databases (ADR-0008/0009). OTel GenAI conventions keep the LLM-audit and metrics vendor-portable.
