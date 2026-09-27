# runtime-service

**What was built, and what is running where.**

runtime-service keeps two collections fed by the same events: the **artifact ledger** (what a
pipeline built: its digest, commit, version and SBOM) and the **instance register** (which digest
runs in which environment of which application, since when, deployed by whom, and what to roll back
to). A deploy of a digest with no build record is a **digest mismatch**: recorded, the instance
marked, and a signal sent to work-service, never corrected in place. It records; it never deploys,
restarts or rolls anything back. It is a component of [maestro](../README.md); its design is
[`docs/components/runtime-service.md`](../docs/components/runtime-service.md), and its table and
feeds are [ADR-0027](../docs/decisions/0027-runtime-services-table-and-feeds.md).

Its only required dependency is [identity-service](https://github.com/fps4/identity-service): a
token's `prn` claim is the principal, and this service mints no ids for people or workloads.

## What it takes in

A pipeline puts two events on its account's default EventBridge bus, and a rule delivers both to
this service's queue:

| Source | Detail | Records |
|---|---|---|
| `maestro.build` | `{ application, digest, commit, version?, sbom? }`; the SBOM uploaded first to `sbom/<application>/<digest>.cdx.json` | `ArtifactRecorded` (built) and the SBOM's components, for `carries` |
| `maestro.deploy` | `{ application, environment, digest, commit }` | `ArtifactDeployed`; for a digest with no build record, also `ArtifactRecorded` (unbuilt) and `DigestMismatchDetected` |

A person holding `owner` sets an application's onboarding level and tier (`InstanceLevelSet`,
`InstanceTierSet`); work-service projects them (ADR-0027 §4). A pipeline cannot.

## Layout

```
runtime/
 ├── api/                 REST API and the Lambda entry points
 │    ├── src/domain/     the events, the fold, the decisions — pure
 │    ├── src/db/         the table (table.ts), the key layout (keys.ts), handles, the outbox
 │    ├── src/intake/     the queue's function: builds and deploys from the bus
 │    ├── src/signals/    the digest mismatch, sent to work-service's signals intake
 │    └── src/relay/      the spine's relay over this service's outbox
 ├── config/workspaces/   the demo tenant (aannemer-x)
 ├── infra/docker/        compose and the CI images — the local loop, not a deployment target
 └── terraform/           the module a tenant's root deploys: the table, the SBOM bucket, the API, the relay, the intake
```

## Quick start

```bash
make dynamodb   # DynamoDB Local on :8050
make test       # each test file makes and drops its own table
make up         # DynamoDB Local and the api on :8051, the record sink a local directory
```

Then, against the table the service reads:

```bash
cd api
npm run workspace:apply -- ../config/workspaces/aannemer-x.yaml      # applications and environments
npm run workspace:member -- aannemer-x --prn prn-h-demo-owner --roles owner
npm run workspace:member -- aannemer-x --prn prn-w-intake --roles intake --accountable prn-h-demo-owner
npm run workspace:rebuild -- --workspace aannemer-x --force         # from the archive alone
```

Configuration is environment only; `api/src/config.ts` is the schema. `TABLE_NAME` is required;
`DYNAMODB_ENDPOINT` names DynamoDB Local; `AUTH_MODE=dev` takes `Bearer dev:<prn>[:role,role]` and is
refused in production; `AUTH_MODE=jwks` with `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE` verifies
identity-service's tokens. `RECORD_SINK` is `local`, `s3` or `off`, as in work-service. `SBOM_STORE`
is `local` (`SBOM_DIR`) or `s3` (`SBOM_BUCKET`). `SIGNALS=work` sends a mismatch to work-service
(`WORK_API_URL`, and `SIGNALS_TOKEN_URL`, `SIGNALS_CLIENT_ID`, `SIGNALS_CLIENT_SECRET` for its
client-credentials token); `log` writes a line.

## The API

| Route | |
|---|---|
| `POST /v1/workspaces/<ws>/intake` | an EventBridge event, whole — role `intake` |
| `GET /v1/workspaces/<ws>/instances` | the estate |
| `GET /v1/workspaces/<ws>/instances/<application>/<environment>` | the instance, its artifact, its deploys newest first |
| `GET /v1/workspaces/<ws>/artifacts/<application>/<digest>` | an artifact in the ledger |
| `GET /v1/workspaces/<ws>/carries?dependency=<purl without version>` | every running instance whose SBOM names it |
| `POST /v1/workspaces/<ws>/applications/<application>/level` · `/tier` | a person holding `owner` |
| `GET /v1/workspaces/<ws>/me`, `GET /health` | |

## On AWS

[`terraform/`](terraform/) is the module a tenant's root calls beside the spine's (ADR-0017); its
example root is [`terraform/examples/demo`](terraform/examples/demo/main.tf). It makes the table, a
bucket for the SBOMs, the API behind an HTTP API through the Lambda Web Adapter, the relay on a
schedule, and — with `intake` set — a rule on the account's default bus for `maestro.build` and
`maestro.deploy`, the queue it feeds and the intake function.

| Input | |
|---|---|
| `name`, `table_name`, `bucket_name` | names; the bucket is globally unique, the tenant's to choose |
| `api_package`, `relay_package`, `intake_package` | `api/bundle/*.zip` from `npm run bundle` |
| `web_adapter_layer_arn` | the region's `LambdaAdapterLayerArm64` |
| `environment`, `secrets` | the service's configuration; secrets as Secrets Manager ARNs |
| `archive`, `archive_prefix` | the spine module's `relay_environment` and `relay_policy_json`; the prefix this component relays under, e.g. `runtime/`, which the sealer must seal |
| `intake` | `{ principal = "prn-w-…", workspace, sources? }` — the workload the intake acts as, admitted with `intake` |
| `signals` | `{ work_api_url, token_url, client_id }`, with `SIGNALS_CLIENT_SECRET` in `secrets`: where a digest mismatch goes |

Outputs: `api_url`, `api_id`, `table_name`, `table_arn`, `bucket_name`, `bucket_arn`,
`api_function_name`, `relay_function_name`, `intake_function_name`, `intake_queue_arn`.

What the tenant adds around it:

- **Each application's pipeline role** may put its SBOM, and nothing else: `s3:PutObject` on
  `<bucket_arn>/sbom/<application>/*`, beside the `events:PutEvents` it has for `maestro.deploy`.
  The functions only read that prefix.
- **Two workload principals** in identity-service: the intake's, admitted to the workspace here with
  `intake`; and, with `signals`, a client-credentials client whose workload is admitted to
  work-service's workspace with `intake` — its secret in Secrets Manager, named in `secrets`.
- **The sealer** seals `archive_prefix` with the other components' prefixes.

