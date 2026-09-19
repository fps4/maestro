# The spine

**Repository:** `fps4/maestro`, in [`spine/`](../../spine/) · **Status:** building — the core is in code (below); the S3 and SNS adapters, the CDK stack and the first component's relay follow in M1 · **Decision:** [ADR-0003](../decisions/0003-the-spine-is-an-archive-and-a-queue.md)

The record every component writes to and every auditor reads from. An S3 archive as the system of record, SNS/SQS for delivery, a relay from every outbox, and a verifier that runs with every service off. [Figure 3](../diagrams.md#figure-3--the-spine).

## What it is not

Not a message bus, not a workflow engine, not a place anything free-text lives. It has no propose/accept semantics of its own: acceptance is a specs-service decision event; a work item's state change is a work-service fact. The spine records that they happened.

## The event

```yaml
event:
  event_id:          01J9F2K7QH…        # UUIDv7 — time-ordered
  workspace_id:      ws-aannemer-x
  seq:               148203             # monotonic per workspace; assigned by the writing service
  subject_type:      work_item
  subject_id:        wrk-8841
  subject_seq:       7                  # per subject; optimistic concurrency

  type:              WorkItemClosed
  type_version:      1
  occurred_at:       2026-09-18T09:14:22Z
  recorded_at:       2026-09-18T09:14:22.418Z

  accountable:       prn-h-jdekker      # a human principal — always
  acting:            prn-a-remed-2      # who performed the act — may be an agent
  seat:              operations
  oversight_level:   O2                 # in force at the time, copied on

  consequence_class: c2                 # carried from the first build
  causation_id:      01J9F2K5…
  correlation_id:    01J9F2J1…

  body:              { outcome: done }  # structural, schema-constrained, no free text
  payload_ref:       s3://…/work-item/wrk-8841@7
  payload_digest:    sha256:9f2c…
```

Rules enforced at append, not documented:

1. `accountable` resolves to a human principal in the registry; anything else is a rejected write.
2. All four attribution fields are present. No defaults.
3. `oversight_level` is copied on, never joined to current configuration.
4. `body` is validated against a schema that forbids free text. Anything that could carry a name is a `payload_ref` with a digest.
5. Every principal reference is a maestro principal id. An identity provider's subject is rejected at append.
6. `seq` is assigned by the writing service in its outbox, per workspace. Nothing reads a queue offset.

**The digest is what makes erasure safe.** Erase the payload and the archive still proves that a specific byte sequence was accepted at a specific gate. Erasure is itself an event (`PayloadErased`) and is never performed on events.

## Event taxonomy

Each component declares its own types and no more. First wave:

| Component | Types |
|---|---|
| specs-service | `DraftProposed` · `VersionSuperseded` · `GateDecisionRecorded` · `QuestionAsked` · `QuestionResolved` · `LinkPinned` · `PayloadErased` |
| work-service | `WorkItemRaised` · `WorkItemAssigned` · `WorkItemStateChanged` · `WorkItemEscalated` · `WorkItemBreached` · `WorkItemClosed` |
| runtime-service | `ArtifactRecorded` · `ArtifactDeployed` · `InstanceStateChanged` · `DigestMismatchDetected` |
| agent-service | `RunStarted` · `ActionRefused` · `RunEscalated` · `RunClosed` |
| identity-service (via the registry) | `PrincipalRegistered` · `PrincipalSuspended` · `SeatOccupancyChanged` |

**An event per commitment change, never per keystroke.** Notes, diagnostics, reasoning and progress are payloads. If a component's event rate tracks activity rather than obligations, the boundary has been crossed.

## The relay and the archive

- **Relay:** a scheduled Lambda per component drains the outbox in `seq` order, writes each batch to the archive's current day, publishes to SNS FIFO with message group = workspace, and acknowledges the outbox. Idempotent; at-least-once into the queue, exactly-once into the archive by `(workspace, seq)`. It never skips: an event that fails the append rules stops its workspace where it stands, stays undelivered, and is named in the relay's report — relay lag is the alarm.
- **Archive:** one prefix per workspace and day, every object written once:

```
s3://<tenant-archive>/<workspace>/<yyyy-mm-dd>/events-<first_seq>.jsonl   a relay batch — canonical event lines, seq order
s3://<tenant-archive>/<workspace>/<yyyy-mm-dd>/segment.json               the manifest, once the day is sealed
s3://<tenant-archive>/<workspace>/head.json                               the relay's pointer; not part of the record
```

The day is the archive's day — the UTC date the relay wrote the batch — not the date the events occurred; each event carries its own `occurred_at` and `recorded_at`. The day is a physical partition, and `seq` running contiguously across segments is what guarantees nothing fell between two of them. A day with no events has no segment. The sealer runs after midnight over every day before the current one and produces the **segment manifest**:

```yaml
segment:
  workspace_id:        ws-aannemer-x
  period:              2026-09-18
  first_seq:           148100
  last_seq:            148412
  event_count:         313
  merkle_root:         sha256:4c1e…    # RFC 6962 tree over the leaves
  leaves:              [ sha256:…, … ] # one per event, in seq order: what names a tampered event
  prev_segment_digest: sha256:1a0b…    # null for the workspace's first segment
  segment_digest:      sha256:7e41…    # over the manifest with this field absent
  sealed_at:           2026-09-19T00:07:11Z
  sealer_version:      1
```

Canonicalisation is JCS (RFC 8785); a leaf is the RFC 6962 leaf hash of an event's canonical line, and the root is the RFC 6962 tree over the leaves, so a single event can later be shown to belong to a sealed day without the rest of it. The chain is computed by the sealer in code — never by a vendor primitive — and Object Lock is defence in depth only. Each day's `segment_digest` is delivered to the tenant's named contact through the notifier, so the tenant holds evidence maestro cannot revise.

## Projections

Every component database is a projection: a consumer with a checkpoint and a version, rebuildable from zero by reading the archive. A projection version change forces a rebuild, never an in-place migration. **Dropping and rebuilding a workspace is a build gate for every component.**

## Export and verify

| Operation | Surface | Notes |
|---|---|---|
| `append(event)` | service-to-service only | the only write; idempotency key required |
| `read(workspace, subject?, from_seq)` | API, MCP | ordered replay from the archive |
| `verify(workspace, period_range)` | API, MCP, **CLI with no service** | recomputes every leaf, every root and the chain; returns pass or the period, the first divergent `seq` and why |
| `export(workspace)` | API | archive + manifests + the verifier binary — the exit deliverable, exercised in M1's gate |

MCP exposes read, verify and export — never append.

## In code

[`spine/`](../../spine/) is the package every component's relay and every verifier is built from: `@fps4/maestro-spine`, TypeScript on Node 22, one runtime dependency. Its `domain/` is pure — the envelope and the six rules (`checkEvent`), JCS, the RFC 6962 tree, `seal` and `verify` — and an import lint keeps it so, because the verifier has to run with every service off. Around it: the archive store port with filesystem and in-memory adapters (S3 follows), `append` (exactly-once by `(workspace, seq)`, refuses a gap, completes a batch a crashed run left half-written), `sealDay` / `sealBefore`, the delivery port with an in-process default (SNS follows), the outbox port a component implements, and `relayOnce`. `spine-verify <root> --workspace <ws> [--from] [--to]` is the CLI — exit 0 and the verified range, or exit 1 with the period, the first divergent `seq` and the reason. The tests are the gates below where a store is enough: order, idempotence, the half-written batch, the refusal at append, the tampered copy.

## Build gates (M1)

1. specs-service's outbox relays to S3 and SNS; a consumer queue receives in order per workspace. *(In code against the in-memory store and in-process delivery; the adapters and the component's relay are next.)*
2. A workspace database is dropped and rebuilt from the archive alone; every read returns identically.
3. The verifier, run from a laptop with every service off, passes on a sealed range and names the first divergent `seq` on a tampered copy. *(In code, over a filesystem archive.)*
4. An event with an agent in `accountable`, or an identity-provider subject anywhere, is rejected at append. *(In code.)*
