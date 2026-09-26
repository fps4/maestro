# specs-service

A **governed specification service** — write specifications, version them, and put them through gates
a named human has to pass. It has its own domain, its own console, and single sign-on through
[`identity-service`](https://github.com/fps4/identity-service), so it is a product on its own; it is also the component
of [maestro](../README.md) that holds what was agreed.

Humans and agents author in it. What it guarantees is that **an approval attaches to bytes that
cannot subsequently change**, that the approver is a named human and never an agent, and that the
whole chain exports into something meaningful with the service switched off.

Its only required dependency is `identity-service`. Everything else — a durable record spine, an
evaluator, a notifier — is an **outbound port with a working local default**
([ADR-0002](docs/decisions/0002-identity-service-is-the-only-dependency.md)).

## What it is for

Two consumers shaped the model, and the generic core is their overlap:

| | Artifacts | Gates |
|---|---|---|
| **maestro** (an ops engine for running applications) | Cause analysis; intake assessment; specification; change record | RCA review, intake, specification, release |
| **maestro v1** (agentic delivery platform, retired) | Charter → Functional spec → Technical design + tasks | Functional, technical design, technical merge |

**Naming.** *maestro* is an ops engine for running applications; its design lives in
[`docs/`](../docs/) at this repository's root, and [`docs/components/specs-service.md`](../docs/components/specs-service.md)
there is the page about this service. *maestro v1* is the first iteration of that project — an
agentic delivery platform, retired — and it stays here because it is the second consumer that shaped
the model. Earlier revisions of this repository called the first *adel* and the second *maestro*;
that vocabulary is gone. (Until 2026-09-18 maestro was designed as a governed application platform
with a different chain; the chain changed and no code did — see the demo definition.)

Neither vocabulary is in the code. **Artifact types, links, gates and lifecycles are configuration**
([ADR-0001](docs/decisions/0001-artifact-types-are-configuration.md)) — a workspace declares
its own and the service enforces what those declarations imply.

## The one idea

```
Draft   ── MUTABLE ──▶  edit freely, by humans and agents, autosaved
   │
   │  propose  (snapshot)
   ▼
Version ── IMMUTABLE ──▶  no update operation exists. Superseded, never edited
   │
   │  gate decision  (a named human, always)
   ▼
Accepted ──▶ pinned links freeze to it; the record is portable
```

Editing is continuous and messy; a record is neither. Keeping them as separate entities is what lets
a real editor and a trustworthy approval live in one service
([ADR-0003](docs/decisions/0003-immutable-versions-mutable-drafts.md)).

And a draft is **one document**: markdown with front-matter, where a table under a declared heading
*is* a facet. The gate reads structure; the author writes prose; the same bytes are both
([ADR-0017](docs/decisions/0017-one-document.md)).

## What it is not

- **Not a wiki.** Artifacts have typed links, not a page tree. The editor exists to produce a version
  a gate will decide on; authoring features that do not serve a gated artifact are out of scope. The
  one thing attached to a version besides a decision is a **question** — a fact about it, never a
  change to it ([ADR-0014](docs/decisions/0014-questions-on-a-version.md)).
- **Not a policy engine.** It calls an evaluator and records the verdict. Gates read structured
  facets and **never** the body
  ([ADR-0004](docs/decisions/0004-facets-are-evaluated-bodies-are-read.md)).
- **Not a workflow engine.** It holds lifecycle state and decisions. Orchestration is yours.
- **Not an audit substrate — unless you want it to be.** Every state change is emitted to a record
  sink. Point that at a durable spine and the spine is authoritative, and this table becomes a
  projection. In maestro that spine is an S3 archive fed by a relay from the outbox.

## Project Layout

```
specs/
 ├── api/              # REST API + MCP server. domain/ is pure; a lint rule keeps it that way
 ├── config/workspaces/  # THE domain model, as data: the demo tenant (aannemer-x) and the catalogue
 ├── infra/docker/     # Dockerfiles + compose — the local loop and CI, not a deployment target
 ├── terraform/        # The module a tenant's root deploys: the table, the store, the API, the relay
 └── docs/             # design/ · design/ui/ (the approved console design) · decisions/
```

## Core model

```
Workspace                  the confidentiality boundary. maestro maps a tenant; maestro v1 its organisation
  └── Artifact             a lineage, of a declared type
        ├── Draft          mutable. Where authoring happens
        └── Version        immutable snapshot of a draft
              ├── facets   typed, schema-validated, evaluable, with provenance
              ├── body     authored content. Rendered, diffed, searched — never evaluated
              ├── attachments   images, PDFs, files. Content-addressed in object storage
              └── links    typed edges; at most one pinned to a version at acceptance
Gate → Decision            immutable, attributed to a named human. The service never decides
```

## Quick Start

The record store is **one DynamoDB table** (maestro's
[ADR-0018](../docs/decisions/0018-dynamodb-is-the-mvp-database.md);
[ADR-0021](docs/decisions/0021-the-store-is-dynamodb.md) here). Locally that is DynamoDB
Local in the compose stack, with the table made from the same schema the Terraform module declares
(`api/src/db/table.ts`); there is no database credential anywhere.

```bash
make up        # DynamoDB Local, MinIO, api, web — api on :8020, console on :8021
make apply     # load config/workspaces/catalogue.yaml and aannemer-x.yaml
make test      # after `make dynamodb`; each test file makes and drops its own table
```

`make help` lists the rest. Configuration is environment only — `api/src/config.ts` is the schema and
every value but the table's name has a local default:

- `AUTH_MODE` — `dev` (default, no identity provider needed) or `jwks`, with `AUTH_JWKS_URL`,
  `AUTH_ISSUER` and `AUTH_AUDIENCE` pointing at your `identity-service` deployment
- `TABLE_NAME` — the table (required); `DYNAMODB_ENDPOINT` names DynamoDB Local, and unset it is the
  SDK's endpoint for `AWS_REGION` with the runtime's own credentials (on AWS, the function's role)
- `S3_BUCKET` — set it and object storage is on (attachments, and the payload store's `s3` adapter); `S3_ENDPOINT` names MinIO locally, and unset it is the SDK's default endpoint for `S3_REGION` (AWS); `S3_ACCESS_KEY`/`S3_SECRET_KEY` when the runtime's own credentials are not the ones to use
- `RECORD_SINK` — `local` (default): the outbox relays to a filesystem archive at `RECORD_ARCHIVE_DIR` (`./archive`) — the laptop's spine, readable by `spine-verify` with everything off; `s3`: maestro's spine, with `ARCHIVE_BUCKET`, `ARCHIVE_PREFIX` and `EVENTS_TOPIC_ARN` as the spine's Terraform module outputs them; `off`: write the outbox, relay nothing (the scheduled relay Lambda drains it)
- `PAYLOAD_STORE` — where the payloads go ([ADR-0020](docs/decisions/0020-the-payload-store-and-the-rebuild.md)): a version's text, a decision's reasoning, a question, an answer, an evaluator's findings — written before the event that names them by locator and digest. `local`: a directory at `RECORD_PAYLOAD_DIR` (`./payloads`); `s3`: this service's own bucket, `PAYLOAD_BUCKET` (default `S3_BUCKET`) under `PAYLOAD_PREFIX` (`payloads`), with the `S3_*` endpoint and credentials — versioned, never Object-Locked, so erasure stays possible. Unset, it follows the sink: `local` under `RECORD_SINK=local`, `s3` otherwise
- `EVALUATOR_BASE` — optional; without it, evaluations are recorded but never requested

**Admitting a principal.** A token names who someone is — its issuer and subject, and the `prn`
claim: the maestro principal id identity-service mints, which is the id this service writes on every
record and the only one ([ADR-0022](docs/decisions/0022-the-principal-id-is-identity-services.md));
a verified token without it is refused. The membership names what a workspace lets them do, and
membership is granted in the workspace, never by the token
([ADR-0019](docs/decisions/0019-the-outbox-holds-spine-envelopes.md)). The operator's grant is
`npm run workspace:member -- <workspace> --issuer <iss> --subject <sub> --prn <prn-…> --roles a,b [--kind human|agent|service] [--gates g1,g2] [--accountable <prn-h-…>] [--display-name <name>]`:
the principal is resolved as the first request would resolve it — registered under its `prn` on
first sight of the identity, found on every sight after — and the membership written is the one that
request reads. `--prn` is required for an identity not seen yet (the development issuer's excepted,
whose ids are still minted here). An agent's grant must name the human answerable for it.
Memberships are grants, not record: nothing is emitted to the spine. The first human of a fresh
deployment is admitted this way; the issuer is the identity-service's, the subject its user id.

**An identity registered before `prn`.** A deployment that first saw someone before this service
read `prn` holds them under an id it minted, and refuses their token until an operator aligns the
two, once: `npm run principal:adopt -- --issuer <iss> --subject <sub> --prn <prn-…> [--dry-run]`. It
registers the `prn` superseding the old id, re-points the identity, and moves the grants —
memberships, and any agent answerable to the old id; the records that name the old id stay as the
archive has them, and separation of duties still treats both ids as one person. `--dry-run` prints
the plan and writes nothing; a second run is a no-op.

**The rebuild gate.** The archive is the record and this table a projection of it, and that is
checked rather than said: `npm run workspace:rebuild -- --workspace <id> [--force]` verifies the
workspace's archive with the spine's verifier, refuses a populated target unless `--force` deletes
the workspace's prefix, replays every event in order — fetching each payload by reference and
checking it against the digest the event carries — and writes the projection back: artifacts,
versions, decisions, evaluations, questions, the outbox and its counters, a reopened draft as it
was at reopen. Memberships are grants, not record; re-apply them from the tenant's configuration
afterwards. `tests/integration/rebuild.test.ts` runs the loop over HTTP, drops the workspace,
rebuilds, and compares every item and read — equal — and is a DoD gate. A workspace written by an
older projection (its `meta` item behind the code's `PROJECTION_VERSION`) refuses to serve until
rebuilt; nothing migrates in place.

Against a real `identity-service`, register the service as an Application with the role catalogue
(`author`, `reviewer`, `workspace_admin`, `auditor`), a public client for the console, and a
client-credentials principal for agents — `identity-service/config/seed.mstr-specs.yaml` is the
structural seed a deployment registers.

Health at `GET /health`.

## Deployment

Serverless AWS, as a Terraform module in [`terraform/`](terraform/) (maestro's
[ADR-0002](../docs/decisions/0002-serverless-aws-is-the-substrate.md),
[ADR-0016](../docs/decisions/0016-terraform-is-the-infrastructure-language.md)). A tenant's
private configuration repository (`fps4/maestro-<tenant>` —
[`../docs/tenancy-and-config.md`](../docs/tenancy-and-config.md)) holds the root module
that composes it with the spine's, and the tenant's own pipeline applies it
([ADR-0017](../docs/decisions/0017-the-tenant-repository-runs-the-pipeline.md)). Nothing in
this repository deploys anywhere: its CI runs on GitHub-hosted runners and ends at the gate — `fmt`,
`validate`, the module's tests against a mocked provider, the example root, and a bundle that boots.

### What the module deploys

| Resource | Notes |
|---|---|
| the table (`table_name`, default `name`) | the record store: one table keyed `pk`/`sk`, indexes `gsi1`, `gsi2` and the sparse `pending`, TTL on `expires_at` — what `api/src/db/table.ts` declares, and the service checks at boot; on demand, point-in-time recovery, encrypted, `prevent_destroy`; reached by each function's role, never by a credential |
| the store (`bucket_name`) | attachments and payloads (ADR-0020); versioned, encrypted, never public, **never Object-Locked** — a payload must be erasable; `prevent_destroy`; plaintext transport denied |
| `<name>-api` | the Fastify server, unchanged, as a zip on `nodejs22.x`/arm64 behind the [Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter) layer; handler `run.sh`; `RECORD_SINK=off` — it writes the outbox and relays nothing; role: its log, the item operations on its table and its indexes, its bucket, nothing else |
| an HTTP API Gateway | one `$default` route, Lambda proxy in payload format 2.0, auto-deployed, access-logged; CORS is the application's (`CORS_ORIGINS`), not the gateway's |
| `<name>-relay` | the spine's relay handler over this service's outbox ([ADR-0019](docs/decisions/0019-the-outbox-holds-spine-envelopes.md)); EventBridge Scheduler every minute, one invocation at a time; role: its log and the table, plus the spine's `relay_policy_json`, attached unchanged |
| four alarms | `<name>-api-5xx` (five server errors in five minutes), `<name>-relay-errors`, `<name>-relay-silent` (no run in fifteen minutes), `<name>-relay-refused` (the spine refused an event; that workspace's relay is stopped until a person looks) → `alarm_actions` |

### Inputs

| Input | Default | |
|---|---|---|
| `name` | `maestro-specs` | prefix for every named resource |
| `api_package`, `relay_package` | — | the zips `npm run bundle` writes to `api/bundle/` |
| `web_adapter_layer_arn` | — | the Web Adapter layer for the region, arm64; see below |
| `table_name` | `name` | the table; unique in the account and region |
| `bucket_name` | — | the store; globally unique, the tenant's to choose |
| `environment` | `{}` | configuration the service reads (`api/src/config.ts` is the schema): `AUTH_MODE` and the `AUTH_*` URLs, `CORS_ORIGINS`, `MCP_RESOURCE_URL`, `EVALUATOR_BASE`, `LOG_LEVEL`, … `NODE_ENV` defaults to `production`, which refuses `AUTH_MODE=dev`; the module's own variables — the table, the port, the bucket, `RECORD_SINK` — cannot be overridden |
| `secrets` | `{}` | environment variable name → Secrets Manager secret ARN, for whatever a tenant's evaluator or notifier needs; the record store needs none — see below |
| `archive` | — | `{ relay_environment = module.spine.relay_environment, relay_policy_json = module.spine.relay_policy_json }` — the spine module's outputs, passed through |
| `relay_schedule` | `rate(1 minute)` | the latency between an act and its record |
| `api_memory_mb`, `api_timeout_seconds` | `1024`, `29` | the timeout is capped at 29 — API Gateway's ceiling |
| `relay_memory_mb`, `relay_timeout_seconds` | `512`, `300` | |
| `log_retention_days` | `90` | |
| `alarm_actions` | `[]` | ARNs the alarms notify — the tenant's ops-signals topic |
| `tags` | `{}` | |

Outputs: `api_url`, `api_id`, `table_name`, `table_arn`, `bucket_name`, `bucket_arn`, `api_function_name`,
`relay_function_name`.

### A tenant's root

```hcl
module "spine" {
  source              = "github.com/fps4/maestro//spine/terraform?ref=<tag>"
  name                = "aannemer-x"
  archive_bucket_name = "aannemer-x-maestro-archive"
  archive_prefix      = "specs/"
  digest_contacts     = ["ops@aannemer-x.example"]
  sealer_package      = "${path.module}/../build/spine/sealer.zip"
}

module "specs" {
  source                = "github.com/fps4/maestro//specs/terraform?ref=<tag>" # the same tag as the spine: one ref names the set
  name                  = "aannemer-x-specs"
  table_name            = "aannemer-x-maestro-specs"
  bucket_name           = "aannemer-x-maestro-specs"
  api_package           = "${path.module}/../build/specs/api.zip"
  relay_package         = "${path.module}/../build/specs/relay.zip"
  web_adapter_layer_arn = "arn:aws:lambda:eu-west-1:<aws-account-id>:layer:LambdaAdapterLayerArm64:30"
  environment           = { AUTH_MODE = "jwks", AUTH_JWKS_URL = "…", AUTH_ISSUER = "…", AUTH_AUDIENCE = "specs" }
  archive = {
    relay_environment = module.spine.relay_environment
    relay_policy_json = module.spine.relay_policy_json
  }
}
```

[`terraform/examples/demo/`](terraform/examples/demo/main.tf) is this root for the demo tenant, with
placeholder values; `terraform init -backend=false && terraform validate` there takes the spine's
module from [`spine/terraform/`](../spine/terraform/) at the same commit.

**The Web Adapter layer.** AWS publishes the adapter as a public layer per region under its own
account, so the ARN carries an account id and cannot be a default in a public repository. Take it
from the adapter's README, [*Lambda functions packaged as Zip package for AWS managed
runtimes*](https://github.com/awslabs/aws-lambda-web-adapter#lambda-functions-packaged-as-zip-package-for-aws-managed-runtimes):
the `LambdaAdapterLayerArm64` ARN for your region. The module sets `AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap`,
`PORT=8080`, `AWS_LWA_READINESS_CHECK_PATH=/health` and `AWS_LWA_ASYNC_INIT=true` (the server describes
its table before it listens, and a cold start may need longer than Lambda's ten-second init
budget); the handler is the bundle's `run.sh`.

**The table and the code are one schema.** `api/src/db/table.ts` and `aws_dynamodb_table.records`
in `terraform/main.tf` declare the same table — key, indexes, TTL — and must be changed together:
the tests and the local loop create the table from the former, a tenant's pipeline applies the
latter, and the service refuses to start on a table whose key or indexes differ from the code's.

**Secrets.** The record store needs none: no database credential exists, and each function's role
is its grant. For anything else — an evaluator's token, a notifier's webhook — the module reads
each secret in `secrets` with `data.aws_secretsmanager_secret_version` and sets it as the named
variable on both functions, so the value is also in Terraform state. ADR-0017 keeps that state in
an encrypted, private bucket with an encrypted mirror and never in a repository, which is
acceptable until the MVP's build list replaces it. The follow-up that keeps values out of state altogether is the Secrets Manager
Lambda extension, reading at runtime.

### Building the bundles

```bash
cd api && npm ci && npm run bundle && npm run sbom
```

`bundle/api.zip` (the server as one ESM file plus `run.sh`) and `bundle/relay.zip`, built
reproducibly so Terraform's `source_code_hash` moves only when the code does, each with a CycloneDX
SBOM beside it (maestro's [build-standards §4](../docs/build-standards.md)). The module takes
the zips as inputs; bundling is the package's job, not the module's.

## API Summary

Every write produces a draft or a **proposed** version. Only a gate decision accepts
([ADR-0005](docs/decisions/0005-agents-may-author-never-decide.md)).

| | |
|---|---|
| `POST /v1/drafts` · `PATCH /v1/drafts/:id` | Create and edit. Optimistic concurrency on `revision` |
| `POST /v1/drafts/:id/propose` | Snapshot into an immutable version |
| `GET /v1/artifacts/:id/versions/:n` | Read a version, rendered or raw |
| `GET /v1/artifacts/:id/diff?from=&to=` | Facet diff, link diff, and a body diff per format |
| `GET /v1/artifacts/:id/lineage` | Both directions, across links |
| `POST /v1/attachments` | Upload. Content-addressed and deduplicated |
| `GET /v1/gates/:gate/:id/:n/packet` | The decider's packet: everything a person needs to decide, in plain language, in one call |
| `…/versions/:n/questions` | Ask a question of a version; answer one; a human closes it. Never a mutation |
| `GET /v1/drafts/:id/readiness` | What a draft still needs, in the schema's words, before propose |
| `GET`/`PUT /v1/drafts/:id/document` | The draft as one document; save it as one, facets derived |
| `GET …/versions/:n/document` | A version as one document, composed from the record |
| `POST …/versions/:n/evaluate` | Re-run the evaluations a gate requires; builtin or endpoint, per the definition |
| `POST …/versions/:n/withdraw` | The proposer takes a proposed version back, before any decision |
| `POST /v1/gates/:gate/decisions` | The gate's declared outcomes. Attributed, human-only |
| `GET /v1/workspaces/:id/register` | Everything in flight, with lifecycle state |
| `GET /v1/search` | Facets and bodies, within one workspace |
| `GET /v1/export/:workspace` | The full chain of record, portable |

**MCP** exposes reads, the document (read and save), draft writes, readiness, propose,
evaluations, the decider's packet, and questions (list, ask, answer) — so agents author through it and can explain a pending decision to
the human accountable for it — and **no decision surface at all**, and no way to close a question.

## From a file next to the code

```bash
cd api && SPECS_URL=… SPECS_TOKEN=… npm run specs -- propose ../../../my-service/docs/spec.md --workspace aannemer-x
```

A markdown file with YAML front-matter is a complete authoring surface, and
[`.github/actions/specs`](../.github/actions/specs/action.yml) at the root proposes it from a pull request and
comments the decider's packet. Nothing in CI decides — see
[`docs/guides/git-native-specs.md`](docs/guides/git-native-specs.md).

## Documentation

Two planes: a **Docs** plane you read and a **Delivery** plane you track. Start at
[`docs/README.md`](docs/README.md); the design is
[`docs/design/architecture.md`](docs/design/architecture.md).

## Status

**Aligned with the maestro MVP (2026-09-18).** maestro was re-scoped to an ops engine and its design
rewritten; this service is one of its components, unchanged in model and code. The demo workspace
now carries the four types the MVP uses — `cause_analysis` at `rca_review`, `intake_assessment` at
`intake`, `specification`, `change_record` at `release` — and the earlier chain is the integration
fixture. The console shows the catalogue only for a workspace that declares `catalogue_refs`; the
standards surface waits for maestro's regulated branch. The self-hosted deployment configuration is
removed; the Terraform module and the Lambda bundles are in (`terraform/`, `npm run bundle`).

**Second build (2026-09-15).** The first build made the record trustworthy; this one made it
usable by the three kinds of reader it has — a person who decides, a person who writes next to the
code, and an agent — without weakening the record. ADR-0012 to ADR-0017: labels instead of
identifiers, the decision page built from one packet shared with MCP, questions on a version, an
evaluator port with a floor and an outbound call, readiness before propose, the `specs` CLI and a
proposing GitHub Action, and one document from which the facets are derived. Two defects found on
the way and closed: the catalogue's `publish` outcome would have recorded a standard as `rejected`,
and a specification with no pinned link could be accepted. 178 tests pass, including the loop
through HTTP and through the CLI, the adversarial cross-workspace read, and the MCP surface with
no way to decide.

**The store is DynamoDB (2026-09-20).** maestro's ADR-0018 replaced Atlas with one table per
component; [ADR-0021](docs/decisions/0021-the-store-is-dynamodb.md) records how this service
took it: a prefix per workspace under the same handle, every query a key or an index, the outbox
one transaction, the relay on a sparse index, search a filtered read, the rebuild a deleted prefix.
The suite runs against DynamoDB Local; the rebuild gate passes on it.

**Not built yet:** the TypeScript SDK, export, and redaction. The catalogue holds no
real standards — the pack registry does not exist, and a fixture presented as a standard would be
worse than an empty shelf.

## Licence

MIT — see [LICENSE](../LICENSE). The tree holds code, the design and one fictional tenant; a real tenant's configuration lives in its own private repository, and CI fails on anything that identifies one ([`scripts/check-public.sh`](../scripts/check-public.sh) at the root).
