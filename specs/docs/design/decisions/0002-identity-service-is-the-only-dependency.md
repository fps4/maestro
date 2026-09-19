---
title: "0002: identity-service is the only required dependency; every other integration is a port with a working local default"
summary: "The service authenticates against identity-service and needs nothing else at runtime. Record sink, evaluator, notifier and blob store are outbound ports whose defaults are local, so the product runs end to end alone — and the record sink is the single switch that turns it into a component of a larger platform without changing code."
status: proposed
last_updated: 2026-08-04
date: 2026-08-04
related:
  - ./0005-agents-may-author-never-decide.md
  - ./0007-mongodb-with-inline-bodies.md
  - ../architecture.md
---

## Context

This service was extracted to be usable outside the platform that motivated it. That intent dies
quietly if the service needs a governance event log, a standards engine, and a notification service
to start — the extraction would be nominal, and the second consumer could never adopt it.

But the platform consumer has a requirement the standalone one does not: its durable, tamper-evident
record spine must be authoritative for retention, not this service's database. Both must be true at
once.

There is also a pull in the other direction. Authentication genuinely cannot be defaulted. A local
user table would be a second identity system in an estate that already has one, and the attribution
guarantees in ADR-0005 are worthless if the principals behind them are self-asserted.

## Decision

**One required dependency: `identity-service`.** OIDC discovery, JWKS verification, and principal
resolution. No local credential store, no fallback, no development shortcut that ships.

**Everything else is an outbound port with a working local default:**

| Port | Local default | Production adapter |
|---|---|---|
| Record sink | Outbox collection, drained locally | An external durable spine — in maestro, a relay to an S3 archive with SNS/SQS delivery *(amended 2026-09-18; was "Kafka, or an external durable spine")* |
| Evaluator | `builtin: facet_schema` — the type's schema, as findings *(amended by ADR-0015; was "absent")* | HTTP callout, `${VAR}` resolved from the environment |
| Notifier | Log line | HTTP webhook |
| Object storage | MinIO | S3 |

**The record sink is the seam.** Every state change is emitted as an attributed event, transactionally
with the change itself via an outbox. Configured `local`, this service's table is the record.
Configured at an external spine, **the spine is authoritative and this database becomes a
projection** — the service is then a component, and one configuration value made it so.

**Authorisation stays here.** `identity-service` asserts identity and coarse roles and enforces
nothing, per its own ADR-0005. Who may propose into a workspace and who may decide at a gate is this
service's to resolve.

## Consequences

**The service is genuinely runnable alone** — Postgres, a filesystem, and an identity deployment.
That is a real product, not a component with a demo mode.

**Standalone and embedded are the same code path**, differing only in adapter. There is no
"platform mode" to drift out of sync, and no second implementation of the write path.

**Emission cannot be best-effort.** If a sink write can fail independently of the state change, the
external spine is missing records it is supposed to be authoritative for. The outbox is not an
optimisation; without it the embedded configuration is unsound.

**Ports are not extension points.** They are the four integrations both known consumers need. A fifth
port needs a second consumer, per ADR-0001's rule — otherwise this becomes a plugin framework, which
is a different and much worse product.

**The identity dependency is a real adoption cost** and is accepted. A consumer without
`identity-service` must stand one up or front an OIDC provider it already has. Making it optional
would mean either a weak local default that undermines every attribution claim, or an abstraction
over identity providers — which is a whole product, and one that already exists next door.
