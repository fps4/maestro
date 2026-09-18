# ADR-0013 · The intake agent and customer-facing tenants are post-MVP; the regulated domain is a branch with four seams

**Status:** accepted · 2026-09-18

## Context

Six phases were reviewed: foundation, work-service, agent runs, use case 1 on the first application, the Slack intake agent, customer-facing tenants — plus the regulated domain. The first four make the engine work for one application. The fifth and sixth are products on top of it.

## Decision

The MVP is **M1–M4**. The intake agent and customer-facing tenants are a **backlog**, described once in [beyond-mvp.md](../beyond-mvp.md) and not planned. The regulated domain is **branch R**, forking after M4, and the MVP keeps exactly four seams open for it: the archive is the only record; every write attributed and every decision naming a human; `consequence_class` on every item and instance; classification on every payload and transcript.

## Consequences

- The OpenSpec block shape, the Slack↔principal link, the external reader role and the per-tenant CDK product are not built in the MVP.
- Nothing in M1–M4 may close a seam; a design that would is refused at review.

## What would reopen it

A paying consumer for either backlog item before M4 closes.
