# ADR-0004 · Exit is the portable export: archive plus verifier, readable with every service off

**Status:** accepted · 2026-09-18

## Context

The earlier exit promise was written for hosted, generated applications handed over as running software, and it forbade any proprietary primitive anywhere in the platform. With no hosted applications ([ADR-0001](0001-maestro-is-an-ops-engine.md)) there is nothing to hand over but the record.

## Decision

The exit deliverable is the **export**: the archive, its manifests, and the verifier, readable with every maestro service switched off and depending on no vendor primitive. The rule "no proprietary primitive anywhere" is withdrawn. The rule "no service names its substrate" stays — it is what keeps a move cheap.

## Consequences

- Managed services are allowed wherever they sit behind a port: Lambda, S3, SNS/SQS, EventBridge, SES, Atlas.
- `export` and `verify` are built in the first milestone and exercised in its gate, not at exit.
- A tenant leaving takes the export; queue contents are transport and are not exported.

## What would reopen it

maestro hosting an application again.
