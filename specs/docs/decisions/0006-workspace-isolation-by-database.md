---
title: "0006: Workspace is the isolation boundary, enforced by database-per-workspace bound once per request"
summary: "One boundary concept — the workspace — which maestro maps to a tenant and maestro v1 to its organisation. Every access binds a workspace-scoped handle resolving to that workspace's own MongoDB database; no query names a workspace and none filters by one. The property that matters is that the mistake fails closed."
status: proposed
last_updated: 2026-09-20
date: 2026-08-04
amended_by:
  - ./0021-the-store-is-dynamodb.md
related:
  - ./0007-mongodb-with-inline-bodies.md
  - ../architecture.md
---

> **Amended by [ADR-0021](0021-the-store-is-dynamodb.md) (2026-09-20).** The boundary and the
> handle stand; the mechanism under them is a key prefix in one DynamoDB table rather than a
> database per workspace, and the handle refuses a key outside its prefix. Read "database" below
> as "prefix"; the argument is unchanged.

## Context

Both consumers need a boundary and neither means the same thing by it. maestro needs a **tenant** — a
client organisation, with data isolation and an audit scope that must hold under scrutiny. maestro v1
needs its **organisation**, where the concern is clarity rather than confidentiality.

Modelling both is two boundary concepts on every query, permission check and export. Modelling
neither leaves each consumer to filter for itself, which is the weakest possible answer for the
consumer with the strongest requirement.

The deployment question compounds it. maestro wants the isolation *level* to be a choice: most clients
share infrastructure, a regulated one gets dedicated. If that is an architecture decision rather than
a deployment one, it gets made once, early, wrongly.

MongoDB shapes the answer (ADR-0007). There is no in-session role switch — no equivalent of Postgres
`SET LOCAL ROLE` on a pooled connection, and no row-level security underneath. Whatever isolation is
built has to work without database-enforced row policies.

## Decision

**One concept: the workspace.** maestro maps a tenant onto it; maestro v1 maps its organisation. Nothing
crosses it — not a link, not a lineage, not a query, not a search index.

**A workspace is logical, never physical.** Which database or deployment it lives in is a deployment
choice, and **the workspace id never encodes it** — otherwise moving a workspace would change every
export and every pinned reference.

**Each workspace gets its own MongoDB database**, and access is by binding:

> A workspace-scoped handle is acquired once per request, and no query names a workspace.

```ts
// The only way to reach a store. No repository accepts a raw client or a workspace id.
type WorkspaceHandle = { readonly db: Db; readonly workspace: WorkspaceId };
```

**A repository signature accepting `workspaceId: string` is a defect**, not a shortcut. It is the
shape that invites a filter, and one filtered path is enough.

**Three levels, and the code cannot tell them apart:**

| Level | Mechanism | Isolation |
|---|---|---|
| **Shared** | One MongoClient, `client.db(workspace)` resolved once per request | Structural — never filtered |
| **Dedicated database** | Per-workspace client with a per-workspace Mongo user | Structural **and** authenticated |
| **Dedicated deployment** | One workspace configured | Physical |

Object storage mirrors it: prefix per workspace, with a prefix-scoped credential at the dedicated
levels.

**An adversarial isolation test is a build gate.** Acquire workspace A's handle, attempt B's data,
assert failure.

## Consequences

**The mistake fails closed, and this is the argument.** A forgotten `WHERE tenant_id` returns every
tenant's rows — the classic silent breach. A forgotten handle has no database to query: it does not
type-check, and at worst it errors. To leak across workspaces you would have to resolve the *wrong
workspace's* handle, which is a deliberate act rather than an omission. The failure mode of the
likely mistake matters more than the elegance of the mechanism.

**At the shared level, isolation is structural but not authenticated** — and that is an honest
downgrade from a database that can enforce it in the engine. A compromised process with the shared
client can reach any database. Three compensating controls: the handle type makes the wrong thing
unrepresentable in application code; the adversarial test is a build gate; and any workspace whose
consequence warrants it moves to the dedicated level, where the credential enforces what the code
already does. **A workspace with a genuine confidentiality requirement should not sit at the shared
level**, and that is a deployment decision the model supports rather than a limitation it hides.

**The deployment level is revisable per workspace.** Start shared, move to a dedicated database or
instance without touching the service.

**Cross-workspace queries are unavailable, and this will be felt.** A portfolio across tenants, or a
charter shared between products, cannot be a query here. Both are real requests. A consumer
aggregates across workspaces itself, using per-workspace reads — more work, and it keeps the boundary
honest. Making it a query would make the boundary advisory, and an advisory boundary is not one.

**Database count is the operational ceiling.** MongoDB carries thousands of databases, not millions,
and each costs files and metadata. Beyond that the answer is more instances, which the level model
already supports. A consumer expecting workspace-per-end-user has mis-mapped the concept: a workspace
is an organisation, not a user.

**Client management is the real implementation risk.** At the dedicated level a client per workspace
means a connection pool per workspace, so clients need an LRU cache with idle eviction rather than
being created per request. This is the one place where a bug is a boundary violation rather than an
error, and the adversarial test should be pointed directly at it.
