# ADR-0027 · runtime-service: a partition per instance, the build record before the deploy, level and tier as events

**Status:** proposed · 2026-09-27 · applies [ADR-0018](0018-dynamodb-is-the-mvp-database.md) and [ADR-0011](0011-the-instance-register-is-one-deployable.md) to [runtime-service](../components/runtime-service.md); follows [ADR-0019](0019-work-services-table.md) (work-service's table)

## Context

runtime-service is the last component of the MVP's record half still to build, and acceptance scenarios T1–T3 are its:

- **T1.** A deploy event creates the artifact and the instance; a second deploy shifts `rollback_target`; a rebuild from the archive is identical.
- **T2.** A deploy of a digest with no build record raises `DigestMismatchDetected` and a SEV item; the instance is marked, never silently corrected.
- **T3.** `carries(dependency)` returns every deployed instance whose SBOM names it.

What exists on the first tenant already shapes it:

- **The deploy event.** An application's own pipeline puts `maestro.deploy` on the account's default EventBridge bus through a role the tenant grants per repository. Its detail is `{ application, environment, digest, commit }`. The fixture's digest is the SHA-256 of its Lambda zip; the tenant pipeline puts one per maestro service, its digest over the functions' code hashes (`scripts/deploy.sh`). work-service's intake queue takes it as a `deploy_event` fact.
- **There is no build record anywhere.** No pipeline announces what it built before deploying it, and no SBOM leaves a build. maestro's own bundles already write CycloneDX files (`npm run sbom`); the fixture's does not.
- **Tier and onboarding level** are fields of work-service's workspace definition, per application. work-service reads them at raise and at claim.
- **Environment names** differ between tenants: the demo's are `staging` and `prod`, the first tenant's `production`. runtime-service.md lists a fixed four.

## Decision

### 1. The table is the shared shape; the key layout is runtime-service's

The same table resource as the other components (ADR-0018, ADR-0019 §1), with its own key layout:

| Item | `pk` | `sk` | Index keys |
|---|---|---|---|
| **artifact** (the ledger) | `ws#W#artifact#<application>` | `<digest>` | `gsi1`: `ws#W#built` / `<recorded_at>#<application>#<digest>` |
| **instance** (the register) | `ws#W#instance#<application>#<environment>` | `head` | `gsi1`: `ws#W#estate` / `<application>#<environment>` |
| deploy on an instance | `ws#W#instance#<application>#<environment>` | `deploy#<seq>` | — |
| **component** (a line of an SBOM) | `ws#W#carries#<purl without version>` | `<application>#<digest>#<version>` | — |
| delivery (intake idempotency) | `ws#W#delivery` | `<source>#<id>` | TTL |
| outbox, counter, meta | as in ADR-0019 | | `pending` |

- `carries(dependency)` is one `Query` on the component partition, joined in memory with the instances whose current digest is in it.
- The estate is one `Query` on `gsi1`.
- An instance's deploys are its own partition, newest first.

### 2. The build record comes before the deploy, as its own event

A pipeline puts **`maestro.build`** — `{ application, digest, commit, version, sbom }` — when it has built an artifact, and `maestro.deploy` when it deploys one. `sbom` is the S3 key of a CycloneDX JSON file under `sbom/<application>/<digest>.cdx.json`, in a bucket runtime-service's module owns. The per-repository role a tenant already grants for deploy events also gets `s3:PutObject` on that application's prefix.

- A deploy of a digest the ledger holds records `ArtifactDeployed`, moves the instance, and copies the previous artifact into `rollback_target`.
- A deploy of a digest the ledger does not hold records the artifact as unbuilt, records `ArtifactDeployed`, then records `DigestMismatchDetected` and marks the instance (`state: mismatched`). Nothing is corrected: the next deploy of a recorded digest clears the mark, and the mismatch stays on the record. That is T2.
- The SBOM stays in S3. Its components are read once, at `ArtifactRecorded`, into the component partition. That is T3.

**Asked:** the build record's transport. The recommendation is a second event plus the SBOM in maestro's bucket. The alternative, carrying the SBOM inline on the event, fails at EventBridge's 256 KB limit for any real application.

### 3. One event on the bus, two consumers

`maestro.deploy` and `maestro.build` stay on the default bus. runtime-service's module adds its own rule and queue for both, beside work-service's intake rule. The tenant's root wires nothing new, and neither service reads the other's queue ("services stay apart").

### 4. Tier and onboarding level: runtime-service writes them, work-service projects them

`set_level` and `set_tier` are runtime-service operations, for a human only. Each records `InstanceLevelSet` or `InstanceTierSet` on the spine's events topic. work-service subscribes a queue to the topic, filtered to those two types, and projects them onto its application records. From that event on, its definition's `tier` and `onboarding_level` for that application are no longer read. Until then the definition's values stand, so the first tenant moves one application at a time, and nothing changes for an application nobody has set.

**Asked:** the direction of the dependency.

- **Recommended: events.** work-service never calls runtime-service at claim; a claim stays one read and one transaction, and it works while runtime-service is down.
- **The alternative: a call at raise and at claim.** It is simpler to write, but it puts runtime-service in every claim's path, and puts a workload token between the two services.

### 5. A mismatch reaches work-service as a signal

runtime-service raises the SEV item by putting a signal, `digest_mismatch`, on work-service's `POST /signals`, as its own workload in the `intake` seat. work-service's policy maps it (`signal_classes.digest_mismatch: remediation`, severity from its hint, `P2` by default). This is the path every other source takes: dedup by fingerprint (`<application>#<environment>#<digest>`), clocks from policy, and runtime-service never writes an item.

### 6. Environments are declared, not enumerated

An application's environments are the slugs its definition declares, as in work-service's. The fixed four in runtime-service.md are dropped. A deploy to an undeclared application or environment is recorded as ignored with its reason, never as an instance.

### 7. What runtime-service's definition holds

The workspace's applications and their environments and repositories: the same `applications` block work-service's definition carries, without `tier` and `onboarding_level` (§4). One file per workspace in the tenant's repository, `workspaces/<workspace>.runtime.yaml`, applied by the pipeline.

**Asked:** one definition or two.

- **Recommended: two.** runtime-service's own file keeps each component's definition its own, as specs-service's and work-service's are.
- **The alternative: one `applications` block both services read.** It saves a duplicated list, but couples the two services' schemas.

### 8. Not in the MVP

The scan feed from ECR and Inspector: Dependabot's alerts already carry the advisory lane, and no T-scenario needs it. `hosted_by: maestro`, still a refused write. Matching work-service's `deploy_event` evidence by digest rather than by time (runtime-service.md "What it answers"), which follows once §4 is in.

## Consequences

- A tenant's application pipeline grows one step: put `maestro.build` and upload the SBOM before it deploys. The signals module's deploy step and the fixture's workflow show it. maestro's own services get it from the tenant pipeline, which already builds their SBOMs.
- A deploy that skips the build step is a mismatch by construction. That is the check ADR-0011 put both collections in one deployable for.
- work-service gains its first subscription to another component's events, through the topic R1 proved.
- runtime-service.md is brought level with this ADR when it is accepted.

## What would reopen it

A tenant whose artifacts are container images in a registry maestro can read, where the registry's own digest and attestations are the build record.
