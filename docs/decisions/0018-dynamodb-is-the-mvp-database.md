# ADR-0018 · DynamoDB is the MVP database; the module creates its table; the pipeline applies it

**Status:** accepted · 2026-09-20 · supersedes [ADR-0005](0005-atlas-flex-is-the-mvp-database.md); makes the *Atlas* clause of [ADR-0016](0016-terraform-is-the-infrastructure-language.md) moot; *Atlas* leaves the list of managed services in [ADR-0004](0004-exit-is-the-portable-export.md)

## Context

[ADR-0005](0005-atlas-flex-is-the-mvp-database.md) chose Atlas Flex to avoid a rewrite: no code change, pay per use, DynamoDB "a deliberate later step". Standing up the first tenant showed where the cost of a second vendor actually sits — not in the bill but in the seam: a cluster made by hand in another console, a credential that Terraform cannot create and Secrets Manager must hold, a floor of about $8 a month per cluster, a private endpoint still to buy, and every component after this one written on MongoDB, growing the rewrite that ADR-0005 deferred. work-service is next; it would be the third.

The rewrite is measured. specs-service's store is 9 of 53 source files, four transactions, no aggregation, one text index. identity-service's is mongoose throughout: 13 models, six transactions, unique and TTL indexes. 43 test files drive a real replica set. The spine is untouched: its relay takes an `OutboxSource` port that each component implements. Three to four weeks, once, before a third component exists.

## Decision

**DynamoDB is the record store of every component.** One table per component, on-demand capacity, point-in-time recovery on, created by the component's Terraform module and owned by it. The tenant root composes the modules and the tenant pipeline applies them ([ADR-0017](0017-the-tenant-repository-runs-the-pipeline.md)); nothing is made by hand and no database credential exists.

The shape, the same in every component:

- **One table, keyed `pk`/`sk`.** A workspace's items share the prefix `ws#<workspace_id>#`, and the handle that serves a workspace refuses any other prefix: isolation by key, as it was by database. Control items (workspaces, definitions, principals) live under their own prefix.
- **The transactional outbox is one `TransactWriteItems`:** the act's items, the outbox item and the workspace's counter item (`seq` = counter + 1, on the condition that the counter has not moved). At-least-once out, exactly-once into the archive by `(workspace, seq)` — the spine's rule, unchanged. The relay reads undelivered items through a sparse index; delivering an item deletes it from that index.
- **Uniqueness** — an email, a code digest, a key id, a version's `(artifact, ordinal)` — is a conditional put where the unique value is the item's key, and a uniqueness item in the same transaction where it is not.
- **Expiry** — sessions, tokens, authorizations, drafts — is the table's TTL on an `expires_at` attribute.
- **Search.** The one text index (a version's title and body) becomes a filtered query over the workspace's versions: bounded by a workspace, adequate for the MVP. A search service is a later decision, taken when a workspace outgrows it.
- **Access** is a grant: the module allows each function the actions it needs on its table and indexes. `MONGO_URI` leaves every module's `secrets`.
- **Tests** run against DynamoDB Local in a container, as they ran against a replica set; the compose loop runs the same image in place of `mongod`.
- **Backup and rebuild.** identity-service's backup Lambda pages the table into gzipped canonical JSON on S3 as it did the collections; point-in-time recovery is the second line. specs-service's safety is unchanged: the archive and the rebuild ([ADR-0020](https://github.com/fps4/maestro-specs/blob/main/docs/design/decisions/0020-the-payload-store-and-the-rebuild.md) there) — a projection version bump deletes the workspace's prefix and replays the archive.

M1's gate runs after the rewrite, on DynamoDB; the milestone closes on it.

## Consequences

- The rewrite: specs-service's store layer, identity-service's data access, both test suites onto DynamoDB Local; three to four weeks; M1 closes later by that much, and work-service is written on DynamoDB from its first line.
- No idle cost: an idle tenant pays for stored bytes only. No second vendor, no second console, no second credential.
- Access patterns are designed, not discovered: every query is a key or an index, and a new pattern is a schema change reviewed in a plan. Neither service has an ad-hoc query today.
- "One database per workspace" becomes "one key prefix per workspace" wherever the documents say it; the isolation suite carries over as the proof.
- The vocabulary's *Projection* and *Workspace* entries lose the word *database*.

## What would reopen it

A workspace whose search outgrows a filtered query; an access pattern DynamoDB's indexes cannot serve at cost; a tenant that requires a relational or document database.
