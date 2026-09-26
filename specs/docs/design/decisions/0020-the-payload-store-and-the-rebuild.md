---
title: "0020: what the record cannot say goes to the payload store; a workspace is rebuilt from the archive and the payloads alone"
summary: "The envelope carries tokens; a version's text, a decision's reasoning, a question, an answer and an evaluator's findings are payloads — written to an erasable object store before the event, named on the event by a locator and a digest. Evaluations become events, because a gate's openness depends on them. A rebuilder replays a verified archive, fetching payloads by reference, into an empty workspace database, and the result reads identically to what was dropped — maestro's M1 gate. Memberships are grants, not facts of the record: re-applied, not replayed. Drafts are not record and are not rebuilt."
status: accepted
last_updated: 2026-09-20
date: 2026-09-20
related:
  - ./0019-the-outbox-holds-spine-envelopes.md
  - ./0007-mongodb-with-inline-bodies.md
  - ./0003-immutable-versions-mutable-drafts.md
  - ../architecture.md
  - https://github.com/fps4/maestro/blob/main/docs/components/spine.md
  - https://github.com/fps4/maestro/blob/main/docs/decisions/0004-exit-is-the-portable-export.md
---

## Context

ADR-0019 made the outbox hold the spine's envelope. The envelope's body is tokens only, so what the
service actually keeps — a version's title, facets and body; a decision's reasoning; a question and
its answers; an evaluator's findings — is not in the archive. maestro's M1 gate says: *a workspace's
database is dropped and rebuilt from the archive alone; every read returns identically.* Today that
is false for this service, and it is the property that makes "the archive is the record and this
database a projection" (architecture §5) a fact rather than a sentence.

The spine already names the mechanism: anything that could carry a name or a sentence is a
`payload_ref` with a `payload_digest` on the event. Erase the payload and the archive still proves
what bytes were accepted at which gate; the archive itself, under Object Lock, cannot be erased — so
a payload must live somewhere that *can* be, or personal data in a version could never be removed.

Three things are not on the record at all today: evaluations (an upsert with no event, although a
gate opens or stays shut on them), memberships (written by nobody in code — an operator grants
them) and drafts (mutable by design, ADR-0003).

## Decision

### 1. The payload store

A port, `PayloadStore`, with `put(key, bytes, contentType) → { ref, digest }`, `get(ref) → bytes`
and `erase(ref)`. Two adapters, the same split as the archive's: **S3** — this service's own object
store (the attachments bucket, prefix `payloads/`), versioned, encrypted, **never Object-Locked**;
**filesystem** — `RECORD_PAYLOAD_DIR` (`./payloads`) on a laptop, refs `file:///…`. The spine admits
both forms (`@fps4/maestro-spine` ≥ 0.2.0). Keys are `<workspace>/<subject_type>/<subject_id>/<what>`
so a workspace's payloads are one prefix, and an export is one `sync`.

The payload is written **before** the transaction that emits the event; the event carries the
store's `ref` and `digest`. A transaction that fails leaves an orphan object under a deterministic
key that the retry overwrites with the same bytes — harmless, and never referenced.

### 2. What is a payload, per event

| Event | `payload_ref` → | In the body |
|---|---|---|
| `VersionProposed` | the version: `title`, `facets`, `provenance`, `body`, `attachments`, `links`, `catalogue_refs`, `classification`, `effective`, `contributors`, `proposed_by`, `proposed_at`, `definition_version`, `type`, `supersedes` — everything immutable about it | `type`, `digest` (the subject digest a decision cites), `definition_version`, `contributors` |
| `DecisionRecorded` | `reasoning`, the `evaluations` snapshot the decision was taken on | as in ADR-0019 |
| `EvaluationRecorded` (new) | `findings` | `evaluator`, `verdict`, `subject_digest`, `findings: n` |
| `QuestionRaised` | the question's `text` | as in ADR-0019 |
| `QuestionAnswered` | the answer's `text` | as in ADR-0019 |
| `VersionWithdrawn` | `reason` (when given) | `reason_digest` stays, for a reader with the archive but not the store |

`payload_digest` is the digest of the payload's canonical bytes. `body.digest` on `VersionProposed`
is still the **subject digest** (facets, body, links, references — what a decision cites); the two
differ because the payload holds more than the subject. Both are on the event.

### 3. Evaluations are events

`EvaluationRecorded` is emitted by the one write path (`EvaluationService.record`), under the seat
of whoever ran it — an agent through MCP, a person through the console, the service itself at
propose (the built-in sufficiency verdict, under the proposer's seat) — with the findings as payload.
A gate's openness is then a function of the record, which is what an auditor is entitled to.

### 4. The rebuilder

`specs rebuild --workspace <id>` (and `RebuildService` behind it):

1. **Verify first.** The archive's chain for the workspace must pass the spine's verifier over the
   configured store; an unverified archive is not rebuilt from — the rebuilder refuses and names the
   period and sequence.
2. **Empty target.** The workspace database must not exist or must be empty (`--force` drops it).
   The control database — definitions, principals — is not touched; it is not the workspace's.
3. **Replay** every event in `seq` order, fetching payloads by reference and checking each against
   its `payload_digest` before use; a mismatch stops the rebuild and names the event. The
   projection: `VersionProposed` creates the version (and the artifact on its first version — `phase`
   initial, `created_at` from `occurred_at`); `DecisionRecorded` writes the decision, the version's
   `state` and `decided_at`, the artifact's `phase` and `accepted_ordinal`, recreates a reopened
   draft as it was at reopen; `VersionSuperseded`, `VersionWithdrawn`, `LinkPinned`,
   `EvaluationRecorded`, `Question*` as their names say. The outbox is restored with every row
   `delivered`, counters to the last `seq` and each subject's last `subject_seq`, indexes ensured,
   and `meta.projection_version` written.
4. **Projection version.** `PROJECTION_VERSION` is a constant in code; a change to how events are
   projected bumps it, and a database whose `meta.projection_version` is behind refuses to serve
   until rebuilt. Never an in-place migration.

### 5. What is not rebuilt, and why

- **Memberships** are grants, not facts of the record: nobody in code writes them today, and when
  identity-service carries seat occupancy (maestro M1) they come from there. A rebuild re-applies
  them from the tenant's configuration; the record does not replay them. When an admin API writes
  them, `MembershipGranted` / `MembershipRevoked` join the taxonomy (`subject_type: principal`).
- **Drafts** are not record (ADR-0003). A draft reopened by a decision is recreated as it was at
  reopen; edits since are lost, which is what "draft" means. Artifacts that only ever had drafts do
  not exist on the record and are not rebuilt.
- **Acceptances** (`refresh` is the only writer) are derived from the catalogue's published versions
  and the tenant's accepted versions; the rebuilder runs `refresh` after replay.
- **Attachments' blobs** were never in the database; the rebuild leaves them where they are.

## Consequences

- The M1 gate is a test: run the loop, relay, seal, snapshot every record collection (without
  `_id` and drafts), drop the database, rebuild, compare — equal. And a read through the HTTP API
  before and after — equal. `tests/integration/rebuild.test.ts` is that test, and a DoD gate.
- Every free-text write now costs one object put before its transaction. On S3 that is a call; on
  a laptop it is a file.
- Erasure has a place to happen: `erase(ref)` on the store, and `PayloadErased` on the record when
  it is implemented (declared since ADR-0019; not in M1).
- The export (maestro ADR-0004) is the archive prefix plus the payload prefix plus the verifier; the
  rebuilder is what proves the export is complete.

## When to revisit

When a payload is needed that is not one of the six above — add a row, not a body field. When
memberships gain a write path — they become events. When a payload must be readable by a component
that is not this service — the key layout is the contract; version it.
