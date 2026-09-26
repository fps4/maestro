---
title: "0021: the store is DynamoDB (maestro ADR-0018)"
summary: "The record store is one DynamoDB table, the module's, reached by a role and never by a credential. A workspace's items share a key prefix and the handle refuses any other — isolation by key, as it was by database. Every query the service makes is a key, a partition or one of two general indexes; the outbox is one TransactWriteItems with the workspace's counter as the condition, and the relay reads a sparse pending index. Search is a filtered read of the workspace's versions; expiry is the table's TTL; the rebuild deletes a prefix. Supersedes ADR-0007; amends ADR-0006."
status: accepted
last_updated: 2026-09-20
date: 2026-09-20
supersedes:
  - ./0007-mongodb-with-inline-bodies.md
amends:
  - ./0006-workspace-isolation-by-database.md
related:
  - ./0019-the-outbox-holds-spine-envelopes.md
  - ./0020-the-payload-store-and-the-rebuild.md
  - ../architecture.md
  - https://github.com/fps4/maestro/blob/main/docs/decisions/0018-dynamodb-is-the-mvp-database.md
---

## Context

maestro's [ADR-0018](https://github.com/fps4/maestro/blob/main/docs/decisions/0018-dynamodb-is-the-mvp-database.md)
makes DynamoDB the record store of every component: one table per component, on demand, created by
the component's Terraform module, reached by a grant. The reasons are maestro's — a second vendor's
seam, a credential Terraform cannot make, a floor per cluster, and a rewrite that grows with every
component written on MongoDB. This ADR records how *this* service takes the decision: what the
table looks like, where every index went, and what changed in the words the design uses.

ADR-0007 chose MongoDB for the estate's sake and named two accepted costs — no engine-enforced
constraints, no engine-level isolation. ADR-0006 built isolation on database-per-workspace and a
handle bound once per request. Both arguments survive; the mechanism under them changes.

## Decision

### 1. One table, keyed `pk`/`sk`; a workspace is a prefix

`api/src/db/table.ts` is the schema, once: key `pk`/`sk` (strings), indexes `gsi1`
(`gsi1pk`/`gsi1sk`), `gsi2` (`gsi2pk`/`gsi2sk`) and the sparse `pending` (`pending_pk`/`pending_sk`),
all projecting the whole item; TTL on `expires_at`. The Terraform module declares the same table
(`aws_dynamodb_table.records`: `PAY_PER_REQUEST`, point-in-time recovery, encryption,
`prevent_destroy`), and the service describes the table at boot and refuses to start if the key or
an index differs — the two are one schema, checked, not two that are meant to match.

Every item carries `kind`, the item's type. `api/src/db/keys.ts` is the layout:

| Item | `pk` | `sk` |
|---|---|---|
| artifact | `ws#<ws>#artifact` | artifact id |
| draft | `ws#<ws>#draft` | draft id |
| version | `ws#<ws>#version#<artifact>` | ordinal, zero-padded |
| decision | `ws#<ws>#decision#<artifact>` | decision id |
| evaluation | `ws#<ws>#evaluation#<artifact>#<ordinal>` | evaluator id |
| membership | `ws#<ws>#membership` | principal id |
| question | `ws#<ws>#question` | question id |
| acceptance | `ws#<ws>#acceptance` | `<standard>#<scope>#<project>` |
| outbox | `ws#<ws>#outbox` | seq, zero-padded |
| counter | `ws#<ws>#counter` | `outbox`, or `subject#<subject id>` |
| meta | `ws#<ws>#meta` | `projection` |
| workspace | `ctl#workspaces` | workspace id |
| workspace definition | `ctl#workspace_definitions` | `<workspace>#<version>` |
| principal | `ctl#principals` | principal id |
| unique (a principal's subject) | `ctl#principals#by-subject` | `[issuer, subject]` as JSON |

`kind` is the table's. A record whose own field is called `kind` — a workspace's, a principal's —
keeps it on the item as `workspace_kind` / `principal_kind` and reads it back under its own name.
A draft's `expires_at` is epoch seconds on the item, the TTL's form, and ISO on the record.

**Isolation is by prefix** (ADR-0006, amended). A `WorkspaceHandle` is still acquired once per
request and no query names a workspace; the handle's repositories build every key from the
workspace's layout, and the item access under them refuses any key — a partition key or an index
key — outside `ws#<workspace>#` with an `IsolationViolation`, before a request is made. The
adversarial suite (`tests/integration/isolation.test.ts`) carries over as the proof, with a new
case: hand the access tenant B's exact key through tenant A's handle, and it throws. Three
deployment levels become two: a tenant is a deployment and a table (maestro's ADR-0007); the
shared level — several workspaces in one table — stays available, isolated by prefix.

### 2. The outbox is one `TransactWriteItems`

An act's items, its outbox items and the workspace's counters go in one transaction. The counter
is read before, and moved on the condition that it has not (`value = :expected`; `attribute_not_exists`
when it is new); `seq = expected + 1`, `subject_seq` likewise from `subject#<id>`. A counter that
moved cancels the whole transaction, and the handle re-runs the caller's read–decide–write a few
times before giving up — someone else recorded first. Every other write in the transaction carries
the condition that makes its read still true: the version still `proposed`, the superseded one
still `accepted`, the draft's revision unchanged, each pin target's `accepted_ordinal` where it was
read (a `ConditionCheck` on the target's artifact item, which is also what a pin resolves from). A
record that moved is a `Conflict` the service turns into a refusal with a sentence.

The spine's rule is unchanged: `(workspace, seq)` is the key of the outbox item, so a second seq is
refused by the put. `event_id` is a UUIDv7 minted in the transaction — unique by construction,
not by a second item. An undelivered item carries `pending_pk = ws#<ws>#outbox`, `pending_sk = seq`;
the relay reads the `pending` index per workspace, oldest first, and the ack removes both
attributes, sets `delivered`, and counts the attempt. `DynamoOutboxSource` implements the spine's
`OutboxSource` over that, for the in-process relay and the relay Lambda alike. Reads of an index
are eventually consistent: a `relayUntilDrained` that sees a just-acked item once more re-appends
it, and the archive's `append` skips a seq it holds.

### 3. Uniqueness is a key, or a uniqueness item

Where the unique value is the key, the put is conditioned on `attribute_not_exists(pk)`: a version
at `(artifact, ordinal)`, a decision, a question, an outbox seq, a definition at
`(workspace, version)`. Where it is not, a `kind = unique` item goes in the same transaction: a
principal's `(issuer, subject)`, which is also the registry's lookup — two first sights of one
subject race, one wins, the other reads what was minted.

### 4. Every index, mapped

What `collections.ts` indexed, and where each went. A pattern nobody queried is dropped rather
than carried: a new pattern is a new method with a key behind it, reviewed (maestro ADR-0018,
"access patterns are designed, not discovered").

| Was | Now |
|---|---|
| `artifacts` `{id}` unique | the key |
| `artifacts` `{type, phase, updated_at}` | dropped — no query used it; the register lists the workspace |
| `artifacts` `{updated_at: -1}` | the artifact partition, sorted in memory — the register reads the whole workspace either way |
| `drafts` `{id}` unique | the key |
| `drafts` `{artifact}` | `gsi1`: `ws#<ws>#draft#artifact` / `<artifact>#<draft>`, sparse — the register's `open_draft` |
| `drafts` `{updated_at: -1}` | the draft partition, sorted in memory |
| `drafts` `{expires_at}` | the table's TTL |
| `versions` `{artifact, ordinal}` unique | the key |
| `versions` `{artifact, state}` | the lineage's partition, filtered |
| `versions` `{digest}` | dropped — no query used it |
| `versions` `{state, proposed_at}` | `gsi1`: `ws#<ws>#version` / `<state>#<artifact>#<ordinal>` — the catalogue's shelf, a lineage's incoming links |
| `versions` `version_text` | a filtered read over `gsi1`'s partition (§5) |
| — | `gsi2`: `ws#<ws>#version#standard` / `<standard_id>#<ordinal>`, sparse — a catalogue reference resolves here, an acceptance is checked here |
| `decisions` `{id}` unique | the key |
| `decisions` `{artifact, ordinal}` | the lineage's partition |
| `decisions` `{gate, decided_at}` | dropped — no query used it |
| `evaluations` `{artifact, ordinal, evaluator}` | the key |
| `evaluations` `{subject_digest}` | dropped — no query used it |
| `memberships` `{principal}` unique | the key |
| `outbox` `{delivered, seq}` | the sparse `pending` index |
| `outbox` `{seq}` unique | the key |
| `outbox` `{event_id}` unique | by construction (§2) |
| `acceptances` `{standard, scope, project}` | the key |
| `acceptances` `{status}` | dropped — `refresh` reads every acceptance |
| `questions` `{id}` unique | the key |
| `questions` `{artifact, ordinal, resolved_at}` | `gsi1`: `ws#<ws>#question#<artifact>#<ordinal>` / `<asked_at>#<id>`, filtered on `resolved_at` for the open count |
| `workspaces` `{id}` unique | the key |
| `workspace_definitions` `{workspace, definition_version}` unique | the key |
| `principals` `{id}` unique | the key |
| `principals` `{issuer, subject}` unique, sparse | the uniqueness item (§3) |

Reads of the table are strongly consistent. The three reads on an index — the register's open
drafts, the catalogue's shelf and a lineage's incoming links, a version's questions and its open
count — are eventually consistent, by milliseconds; a gate that reads the open count a moment after
a question was closed may still count it, and the decider tries again.

### 5. Search, expiry, size

**Search** is a read of the workspace's versions (`gsi1`'s partition, paged) filtered in code:
every term must appear in the title or the body, case-insensitively, a title hit outweighing a body
hit; the result is the version without its text plus an excerpt. Bounded by construction — the read
is the workspace's own partition — and it reads the whole workspace's versions per search.
Adequate for the MVP; a search service is a later decision (maestro ADR-0018).

**Expiry** is the table's TTL on `expires_at`: a draft with a declared `draft_expiry`, today.
Nothing else expires.

**Size.** A version is one item, and an item is at most 400 KB. `BODY_CEILING_BYTES` defaults to
256 KiB and is capped at 300 000, leaving room for the facets, the provenance, the links and the
keys beside the body; a specification is tens of kilobytes. The payload store holds the same
version without a ceiling. ADR-0007's overflow path was never built and is not needed at this
ceiling.

### 6. The rebuild deletes a prefix

`--force` scans the table for `ws#<workspace>#*` and deletes what it finds, paged; the emptiness
check is the same scan looking for a record kind. The scan is the operator's, under the operator's
grant — the functions are granted the item operations and never `Scan`. A tenant's table holds one
tenant (maestro's ADR-0007), so the scan reads what it is about to delete. `PROJECTION_VERSION` is
2: the items are shaped differently from the documents, and a workspace written by projection 1
does not exist on DynamoDB.

### 7. Configuration and grants

`TABLE_NAME` (required), `DYNAMODB_ENDPOINT` (DynamoDB Local), `AWS_REGION`. `MONGO_*` is gone from
`config.ts`, from the module's `secrets`, from compose and from CI. The module grants each function
`GetItem`, `BatchGetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `BatchWriteItem`,
`TransactWriteItems`, `ConditionCheckItem` and `DescribeTable` on the table and `/index/*`; there is no credential to
pass, and `secrets` stays a map for whatever else a tenant's evaluator needs.

Tests run against DynamoDB Local, one table per test file per run, created from `table.ts`; the
compose loop runs the same image in place of `mongod`, with `dynamodb-init` making the table from
the same schema on every start.

## Consequences

- The store layer is nine files rewritten and one deleted: `db/` gains `table.ts`, `keys.ts`,
  `items.ts` (the prefix-bound access and the transaction builder), `control.ts`, and `handle.ts`
  becomes typed repositories — one method per access pattern — in place of a driver's collection
  API. Services call methods; a `find({ arbitrary })` no longer exists to write.
- "One database per workspace" reads "one key prefix per workspace" in every document that said it;
  *Projection* and *Workspace* lose the word *database*.
- No idle cost, no second vendor, no second console, no second credential — maestro's, restated.
- A list read pays for the whole item: DynamoDB bills the item, not the projection. The
  without-body discipline (§8.2) stays for what travels, and the body ceiling is what bounds the
  read.
- The relay's `pending` and the three index reads above are eventually consistent; the table's
  reads are not. Where that shows is written down (§4), and it is milliseconds.
- `aws_dynamodb_table` uses `hash_key`/`range_key`, which provider 6.x deprecates for `key_schema`;
  the module's floor is `>= 5.80`, and the older form works on both. Raise the floor, then move.

## When to revisit

A workspace whose search outgrows a filtered read; an access pattern the two indexes cannot serve
at cost — `gsi3` is a schema change reviewed in a plan; a body that needs more than 256 KiB, which
is the overflow path ADR-0007 described and this ADR does not build; a shared-level deployment
whose rebuild scan reads more than the workspace it drops.
