---
title: "0007: MongoDB, with bodies stored inline and blobs in object storage"
summary: "MongoDB is the primary store, matching the estate. A version's body is embedded in its document up to 1 MB so reading, rendering, diffing and searching are one round trip; attachments are content-addressed in object storage. Two costs are accepted explicitly: no database-enforced referential or state constraints, and no engine-level row isolation."
status: superseded
last_updated: 2026-09-20
date: 2026-08-04
superseded_by:
  - ./0021-the-store-is-dynamodb.md
related:
  - ./0003-immutable-versions-mutable-drafts.md
  - ./0006-workspace-isolation-by-database.md
  - ../architecture.md
---

> **Superseded by [ADR-0021](0021-the-store-is-dynamodb.md) (2026-09-20), under maestro's
> [ADR-0018](https://github.com/fps4/maestro/blob/main/docs/decisions/0018-dynamodb-is-the-mvp-database.md).**
> The store is DynamoDB. Bodies stay inline in the version — now an item, with a 256 KiB ceiling —
> and attachments stay content-addressed in object storage; the two accepted costs below still
> hold, and the compensating control is still the record sink. Kept as the record of why MongoDB
> was chosen and what it was expected to cost.

## Context

The estate already runs MongoDB — `identity-service` is built on it, with nightly encrypted backups
scripted, monitoring in place, and operational knowledge that exists. A second database technology in
a small team is a permanent tax: two backup strategies, two failure modes, two sets of things to know
at 2am.

The data is also genuinely document-shaped. A version is an envelope, a nested facet set, a body, an
attachment list and a set of links — one aggregate, read and written whole. In a relational store
most of it lands in `jsonb` anyway, which is the same document with more ceremony.

Once the service hosts authoring and rendering (ADR-0003, ADR-0004), read latency on a single version
is on the interactive path: open a draft, render a body, show a diff. Fetching a body from a second
store on every read is a round trip that buys nothing at this size.

Two things pulled the other way and were weighed. A relational store enforces referential and state
constraints in the engine — a pinned link that must point at a real version, a state transition that
must be legal. And it can enforce isolation below the application, which MongoDB cannot.

## Decision

**MongoDB is the primary store**, one database per workspace (ADR-0006).

**Bodies are stored inline in the version document, up to 1 MB.**

- A specification is tens of kilobytes. Fetching a version is one round trip; rendering, diffing and
  searching need no second store.
- The ceiling sits well under MongoDB's 16 MB document limit, leaving room for facets and metadata.
- **Beyond the ceiling the body overflows to object storage behind the same accessor.** A reader
  cannot tell, and the limit is enforced at propose rather than discovered in production.

**Attachments are always external** — images, PDFs, files — content-addressed, deduplicated across
versions, referenced from the body as `attachment:<id>`, and snapshotted with the version.

**Projections are mandatory on list queries.** Registers, search results and lineage exclude the
body. Inline storage makes the careless query expensive, and this is the operational discipline the
choice demands.

**A replica set is required**, including in development. The outbox that makes record-sink emission
transactional with the state change needs multi-document transactions, and a standalone `mongod`
cannot provide them. Without it the embedded configuration is unsound, not merely slower.

## Consequences

**One database technology in the estate**, with backups, monitoring and operational knowledge already
in place. This is the decisive practical benefit and it recurs daily.

**The interactive path is one round trip**, which is what makes the editor feel like a tool rather
than an integration.

**Redaction becomes the one permitted mutation** (ADR-0003 §Decision). Bodies inside version
documents mean a lawful erasure cannot be a blob delete: it replaces content in place, is recorded as
an event, and leaves the digest unchanged so the resulting mismatch is detectable and explained. A
mismatch with no event is corruption; with one it is an erasure. This is more machinery than deleting
a blob, and it is more honest — silent deletion is indistinguishable from tampering.

**No database-enforced referential integrity.** A pinned link pointing at a real version is
application-enforced. So is a legal state transition. **Accepted cost**, with a compensating control:
every transition is emitted to the record sink, so a divergence between the emitted stream and stored
state is detectable after the fact and alertable. That is weaker than refusing the write and is not
nothing.

**No engine-level isolation**, which shapes ADR-0006 rather than defeating it — database-per-workspace
resolved once per request fails closed where a filter fails open, and a workspace with a genuine
confidentiality requirement moves to a dedicated database with its own credential.

**Facet validation stays in the application.** MongoDB's `$jsonSchema` validators are per collection,
while facet schemas are per artifact type and versioned with the workspace definition. Ajv at the
route boundary is the enforcement point either way, so nothing is lost.

**The 1 MB ceiling will eventually be hit** by something nobody expects — a pasted table, a
base64-embedded image, a generated document. The overflow path exists so that is a logged event
rather than an incident, and it must be built with the ceiling rather than after the first failure.
