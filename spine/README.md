# @fps4/maestro-spine

The spine in code: maestro's record. What it is and why is in
[`docs/components/spine.md`](../docs/components/spine.md) and
[ADR-0003](../docs/decisions/0003-the-spine-is-an-archive-and-a-queue.md); this file is how to use it.

```
src/domain/     pure — the envelope and its append rules, JCS (RFC 8785), the RFC 6962 tree, seal, verify
src/archive/    the store port; filesystem and in-memory adapters; append / sealDay / verifyRange over a store
src/delivery/   the delivery port; the in-process default
src/relay/      the outbox port a component implements; relayOnce
src/cli/        spine-verify
```

`domain/` imports nothing that does I/O, and an ESLint rule keeps it that way: the verifier ships as
the exit deliverable and runs from a laptop with every service off.

## Use

```sh
npm ci
npm test              # the gates: order, idempotence, the half-written batch, the refusal, the tampered copy
npm run verify -- ./archive --workspace ws-aannemer-x --from 2026-09-01 --to 2026-09-18
```

A component emits through its own transactional outbox and exposes it through `OutboxSource`
(`pending(limit)`, `ack(events)`); its relay is

```ts
import { FsArchive, InProcessDelivery, relayOnce } from '@fps4/maestro-spine';

await relayOnce({ source: myOutbox, archive: new FsArchive('./archive'), delivery: new InProcessDelivery(), resolve });
```

where `resolve` is the component's principal registry (`id → { kind }`). Validate at emit with
`assertEvent(event, resolve, types)` so nothing the relay will refuse ever reaches the outbox; the
relay checks again. `sealBefore(archive, today)` closes every earlier day into a chained segment.

## The event

The envelope, the six rules and the body floor are in `src/domain/event.ts` and documented in
[`docs/components/spine.md`](../docs/components/spine.md#the-event). In one line: four attribution
fields, `accountable` a human in the registry, every principal a maestro id, a body of tokens only,
`seq` assigned by the writing service. A type may narrow its body with a schema (`TypeSchemas`,
keyed `Type@version`); nothing widens the floor.

## The archive

```
<root>/<workspace>/<yyyy-mm-dd>/events-<first_seq>.jsonl   a relay batch, canonical lines, seq order — written once
<root>/<workspace>/<yyyy-mm-dd>/segment.json               the sealed manifest — written once
<root>/<workspace>/head.json                               the relay's pointer — mutable, not part of the record
```

The day is the UTC date the relay wrote the batch. `append` is exactly-once by `(workspace, seq)`:
it skips what is already archived, refuses a gap, and completes a part a crashed run left without
moving the head. A sealed day refuses further appends.

## Status

M1. Next in this package: the S3 store and the SNS FIFO delivery, the CDK constructs (archive bucket
with Object Lock, topic, relay and sealer schedules), and the segment-digest notification to the
tenant's contact. The first relay wired to a component is specs-service's.
