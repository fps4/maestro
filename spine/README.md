# @fps4/maestro-spine

The spine in code: maestro's record. What it is and why is in
[`docs/components/spine.md`](../docs/components/spine.md) and
[ADR-0003](../docs/decisions/0003-the-spine-is-an-archive-and-a-queue.md); this file is how to use it.

```
src/domain/     pure — the envelope and its append rules, JCS (RFC 8785), the RFC 6962 tree, seal, verify
src/archive/    the store port; filesystem, in-memory and S3 adapters; append / sealDay / verifyRange over a store
src/delivery/   the delivery port; the in-process default and SNS FIFO
src/relay/      the outbox port a component implements; relayOnce
src/lambda/     the sealer's handler; the relay handler a component builds from its outbox; metrics
src/cli/        spine-verify
terraform/      the module: archive bucket, topics, the sealer on its schedule
```

`domain/` imports nothing that does I/O, and an ESLint rule keeps it that way: the verifier ships as
the exit deliverable and runs from a laptop with every service off.

## Use

```sh
npm ci
npm test              # the gates: order, idempotence, the half-written batch, the refusal, the tampered copy
npm run bundle        # bundle/sealer.zip — reproducible; what the Terraform module deploys
npm run sbom          # bundle/sealer.cdx.json (CycloneDX)
npm run verify -- ./archive --workspace ws-aannemer-x --from 2026-09-01 --to 2026-09-18
```

A component emits through its own transactional outbox and exposes it through `OutboxSource`
(`pending(limit)`, `ack(events)`); its relay is

```ts
import { FsArchive, InProcessDelivery, relayOnce } from '@fps4/maestro-spine';

await relayOnce({
  source: myOutbox,
  archive: new FsArchive('./archive'),
  delivery: new InProcessDelivery(),
  resolve,
});
```

where `resolve` is the component's principal registry (`id → { kind }`). Validate at emit with
`assertEvent(event, resolve, types)` so nothing the relay will refuse ever reaches the outbox; the
relay checks again. `sealBefore(archive, today)` closes every earlier day into a chained segment.

On AWS the same relay is a scheduled Lambda the component's own module deploys:

```ts
import { relayHandler } from '@fps4/maestro-spine';

export const handler = relayHandler({ component: 'specs', source: myOutbox, resolve, types });
```

It reads `ARCHIVE_BUCKET`, `ARCHIVE_PREFIX` and `EVENTS_TOPIC_ARN` from the environment — the
module's `relay_environment` output — and needs the `relay_policy_json` output attached to its role.
Each run logs one line in CloudWatch's embedded metric format (`maestro/spine`: `Archived`,
`Published`, `Refused`), so relay refusals are an alarm without a metrics client.

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

On S3 the layout is the same under a bucket and an optional prefix. Write-once is the conditional
put (`If-None-Match: *`); the bucket has Object Lock with a default retention, so what was written
cannot be removed even by a principal that could overwrite it. The store contract in
`tests/stores.test.ts` runs against all three adapters; set `SPINE_S3_TEST_BUCKET` to run it against
a real bucket or a MinIO with conditional writes.

## Delivery

`SnsFifoDelivery` publishes to a FIFO topic in batches of ten: message group = workspace, so a
subscribed FIFO queue receives a workspace's events in `seq` order; deduplication id = `event_id`,
so a repeated run publishes nothing twice; the body is the canonical line the archive holds, with
`type`, `type_version`, `subject_type` and `workspace_id` as attributes for subscription filters.

## The sealer

`runSealer` seals every day before today across every workspace and sends each segment's digest to
the digests topic — a readable notice for an inbox, the manifest without its leaves for a queue — so
the tenant holds evidence maestro cannot revise. The Lambda entry point is `src/lambda/sealer.ts`,
bundled by `npm run bundle`.

## The Terraform module

`terraform/` deploys the spine's AWS half; a tenant's root calls it ([ADR-0016](../docs/decisions/0016-terraform-is-the-infrastructure-language.md),
[ADR-0017](../docs/decisions/0017-the-tenant-repository-runs-the-pipeline.md)):

| Resource                   | Notes                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| archive bucket             | Object Lock on, versioned, encrypted, never public, `prevent_destroy`; policy denies plaintext transport and `s3:BypassGovernanceRetention` to everyone |
| `<name>-spine-events.fifo` | the delivery topic; deduplication by the relay's id                                                                                                     |
| `<name>-spine-digests`     | one email subscription per `digest_contacts` entry                                                                                                      |
| `<name>-spine-sealer`      | Node 22 on arm64, from `sealer_package`; EventBridge Scheduler at `cron(7 0 * * ? *)` UTC; role reads and writes the archive, never deletes             |
| two alarms                 | `-errors` (the sealer failed) and `-silent` (it has not run in a day) → `alarm_actions`; not on a LocalStack stand-in (below)                           |

Inputs a tenant sets: `archive_bucket_name`, `digest_contacts`, `sealer_package`; optionally
`object_lock_mode` (`GOVERNANCE` by default — an account administrator can still clean up a
mistake; `COMPLIANCE` makes every object immovable for `object_lock_retention_days`, by anyone),
`archive_prefix`, `alarm_actions`; `local_stand_in = true` only in a root that targets LocalStack.
Outputs for the components' modules: `relay_policy_json`, `relay_environment`,
`reader_policy_json`, the topic ARNs.

```sh
npm run bundle
cd terraform && terraform init -backend=false && terraform test   # mocked provider; Terraform ≥ 1.11
```

`examples/demo/` shows a root calling the module with the demo tenant's placeholder values;
`examples/local/` is the same call against a LocalStack stand-in. Nothing in this repository
deploys to an account.

### LocalStack

A public repository's pipeline ends at `fmt`, `validate`, `terraform test` and an apply to a
LocalStack stand-in ([ADR-0017](../docs/decisions/0017-the-tenant-repository-runs-the-pipeline.md) §3):
`examples/local/` points the provider at `localhost:4566` with LocalStack's fixture credentials,
keeps local, disposable state, and sets `local_stand_in = true`. `scripts/deploy.sh local-up`
starts the container on a laptop or on ds1; CI runs it as a service container on every pull
request, applies the root with `deploy.sh plan` and `apply`, and destroys it. The image is
`localstack/localstack:4.4.0`, the last Community release that starts without an auth token, with
the Docker socket mounted because LocalStack creates a Lambda function by preparing a container
for it.

`local_stand_in` skips only what the edition cannot represent. Each skip, and each thing the
stand-in accepts without enforcing, is proven only on real AWS — by the first tenant, not by CI
(the [manifest rule](../docs/build-standards.md#the-manifest-rule)):

| On the stand-in                                 | Why                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| the two alarms — skipped (`count = 0`)          | 4.4.0 predates the CloudWatch protocol the AWS provider ≥ 6 speaks; `PutMetricAlarm` returns 500 and the provider retries forever    |
| IAM — accepted, not enforced                    | the sealer's and the scheduler's role policies and the bucket policy's two denies are stored; the Community edition enforces none    |
| the schedule and the subscriptions — never fire | the Scheduler schedule and the email subscriptions are created; nothing invokes the sealer or confirms an address                    |
| bucket tags — set on the second apply           | 4.4.0 ignores the tags the provider passes on `CreateBucket`; the next apply sets them with `PutBucketTagging` and the plan is clean |

Not skipped, because 4.4.0 represents them: Object Lock at creation and the default retention (a
locked version's delete is refused), versioning, `If-None-Match` writes, SSE, the FIFO topic, the
Lambda on Node 22, the Scheduler schedule. The record carries `prevent_destroy` on the stand-in as
anywhere else; CI drops the bucket and its lock configuration from state before
`terraform destroy`, and they go with the container.

## Status

Built: the core, the S3 and SNS adapters, the sealer and the Terraform module, with the relays of
specs-service ([`specs/terraform/`](../specs/terraform/)), identity-service and work-service running on the
first tenant. The tenant pipeline is [`tenant-deploy.yml`](../.github/workflows/tenant-deploy.yml) and
[`scripts/deploy.sh`](../scripts/deploy.sh); how a tenant calls it is in
[tenancy-and-config.md](../docs/tenancy-and-config.md). See maestro's [roadmap](../docs/roadmap.md).
