# runtime-service — the instance register

**Repository:** `fps4/maestro-runtime` · **Status:** next (M1 skeleton, M4 fed) · **Decision:** [ADR-0011](../decisions/0011-the-instance-register-is-one-deployable.md)

What was built and what is running where. One deployable, two collections: the **artifact ledger** and the **instance register**, fed by one deploy event. It records; it never deploys, restarts or rolls anything back.

## What it holds

**An artifact** — what was built:

```yaml
artifact:
  artifact_id:      art-app1-fn-pipeline@sha256:3fa1…
  application_id:   app-app1
  digest:           sha256:3fa1…          # the identity; tags are never resolved
  version:          1.14.2
  built_from:       { repo: "…/app1-repository", commit: "9c2e…" }
  sbom_ref:         s3://…/sbom/art-…json
  signature:        cosign:…              # optional in the MVP; the field exists
  recorded_at:      2026-09-18T07:50:00Z
```

**An instance** — what is running:

```yaml
instance:
  instance_id:        ins-app1-prod
  workspace_id:       ws-aannemer-x
  application_id:     app-app1
  environment:        production          # dev | test | acceptance | production
  artifact:           art-app1-fn-pipeline@sha256:3fa1…   # digest-pinned into the ledger
  specification:      spec://application/app1@3            # optional: the accepted version it realises

  hosted_by:          tenant              # always tenant in the MVP
  operated_by:        maestro             # maestro | incumbent
  onboarding_level:   n2                  # what maestro may do to it
  criticality_tier:   tier1               # what the clocks derive from
  consequence_class:  c2                  # carried

  state:              running             # running | suspended | retired
  deployed_at:        2026-09-18T08:01:12Z
  deployed_by:        prn-h-jdekker       # the pipeline's actor, resolved to a principal
  rollback_target:    art-app1-fn-pipeline@sha256:8b07…    # the previous artifact, copied on
  signals_topic:      arn:aws:sns:…:ops-signals-app1-prod
```

Rules enforced at write:

1. `artifact` is a digest into the ledger. A deploy event naming a digest the ledger does not hold records the artifact first and raises `DigestMismatchDetected` if the pipeline's SBOM/build record is absent — a hard stop for that instance, surfaced as a SEV item, never repaired in place.
2. `onboarding_level` and `criticality_tier` are set by a person (the intake decision) and read by work-service at claim. They are never accepted from a deploy event.
3. `rollback_target` is copied from the previous instance state, never computed.
4. `hosted_by: maestro` is a rejected write in the MVP.

## Feeds

| Feed | Source | Produces |
|---|---|---|
| deploy | the tenant pipeline → EventBridge (cross-account) → SQS | `ArtifactRecorded` if new; `ArtifactDeployed`; instance updated; `rollback_target` shifted |
| build | CI attaches SBOM and digest as a release artifact; a webhook or the same EventBridge event carries the pointers | `ArtifactRecorded` |
| scan | ECR / Inspector findings via EventBridge | forwarded to work-service's signals intake with the instance resolved |
| intake | a person, on the console, after the intake assessment is accepted in specs-service | `onboarding_level`, `criticality_tier`, `consequence_class` |

The deploy-event step is a small addition to the application's own pipeline (part of the [signals module](../signals.md#the-module)); nothing in the tenant account is written by maestro.

## What it answers

- Which artifact is running in which environment of which application, since when, deployed by whom.
- What the known-good rollback target is.
- Which deployed artifacts carry a given dependency (from the SBOMs) — the advisory lane's fan-out.
- The onboarding level and tier work-service needs at claim.
- The estate view: every application, every environment, level, tier, last deploy, open items.

## Interfaces

| Operation | Surface |
|---|---|
| `record_artifact`, `record_deploy` | API (adapters) |
| `set_level`, `set_tier` | console, API — human only |
| `get`, `list`, `query`, `carries(dependency)` | console, API, MCP |
| `export(workspace)` | API |
| *deploy*, *rollback*, *restart* | **not exposed** |

## Ports

| Port | Local default | AWS |
|---|---|---|
| record sink | outbox | relay → spine |
| deploy intake | HTTP | EventBridge → SQS |
| scan intake | HTTP | EventBridge → SQS |
| object storage (SBOMs) | MinIO | S3 |

## Build gates

1. (M1) A deploy event creates the artifact and the instance; a second deploy shifts `rollback_target`; the workspace is dropped and rebuilt from the archive identically.
2. (M4) A deploy of a digest with no build record raises `DigestMismatchDetected` and a SEV item; the instance is marked and never silently corrected.
3. (M4) `carries(dependency)` returns every deployed instance whose SBOM names it.
