# ADR-0011 · The instance register is one deployable holding the artifact ledger and the instance record

**Status:** accepted · 2026-09-18

## Context

Two facts about a deployment: the **artifact ledger** — what was built: digest, version, SBOM, signature, known-good rollback target — and the **instance record** — what is running where: this digest, in this environment, in this tenant, at this tier and onboarding level, since this deploy event. They are two views of one deploy event, and the one check that matters — a running digest the ledger does not know is an ungated deploy or a compromise — needs both side by side.

## Decision

**One deployable, `runtime-service`**, two collections, one deploy event. The ledger and the register are bounded contexts inside it.

## Consequences

- One Lambda, one outbox, no join at read.
- Digest mismatch is detected where both facts live, as a hard stop for that instance.

## What would reopen it

maestro executing instances itself, which is out of the MVP.
