# specs-service

**Repository:** `fps4/maestro`, [`specs/`](../../specs/) (until 2026-09-26 `fps4/maestro-specs`, now archived) · **Status:** built · **Design:** [`specs/docs/design/architecture.md`](../../specs/docs/design/architecture.md) and its own decision log, [`specs/docs/decisions/`](../../specs/docs/decisions/) — ADR-0001–0022, closed ([ADR-0020](../decisions/0020-maestros-own-services-live-in-one-repository.md)); cited as "specs-service ADR-00NN"

What was agreed: artifacts drafted by anyone, versioned immutably, decided at gates by a named human, with questions, pinned links and a packet the decider can read in one sitting. Types, gates and lifecycles are configuration. This page says what the MVP uses and how it deploys; the design is beside the code, under `specs/docs/`.

## What the MVP uses it for

| Artifact type | Gate | Decider | Raised by |
|---|---|---|---|
| `cause_analysis` | `rca_review` | the operations owner | an RCA run (UC1) |
| `intake_assessment` | `intake` | the sponsor | a person, onboarding an application |
| `specification` (an application's) | `specification` | the owner | a person or an agent |
| `change_record` | `release` | the owner | a production deploy of a high-tier application |

All four are workspace configuration — a type with facets and body blocks, a gate with its requirements and `accepts_on` outcome. No code. They are the demo workspace the repository ships (`config/workspaces/aannemer-x.yaml`, since 2026-09-18); a tenant's own definition lives in its configuration repository.

## What it already does that the MVP relies on

- **Drafts are mutable, versions are immutable**; a version is proposed to a gate with its digest.
- **Agents author and propose; only a named human decides**, and no MCP tool records a decision.
- **The decision page** — one column, the packet: the document, facets, what changed since the last version, checks, open questions, who decides, consequences of each outcome in plain language.
- **Questions on a version**; a gate may require all resolved.
- **Pinned links**: an accepted version freezes what it rests on.
- **The evaluator port** with a built-in floor (the type's own facet schema) and an HTTP adapter.
- **One document**: front matter for facets, Markdown body with typed blocks; the same file round-trips through the console, the CLI (`specs propose | packet | decide | withdraw`) and the GitHub Action (propose from a PR; never decide in CI).
- **Labels not identifiers**: every id has a human label from the definition, so a non-technical decider never sees `rca_review`.
- **Isolation by database per workspace**, a handle bound once.
- **A transactional outbox** — the record sink port.

## Deployment on AWS

| Piece | |
|---|---|
| API | Fastify → Lambda Web Adapter (layer, handler `run.sh`) → HTTP API Gateway v2, `$default` route — [`specs/terraform/`](../../specs/terraform/) |
| Console | Next.js → OpenNext → Lambda + CloudFront, through [`console/terraform`](../../console/README.md) — built per tenant, `NEXT_PUBLIC_*` at build |
| Database | DynamoDB, one table, one key prefix per workspace ([ADR-0018](../decisions/0018-dynamodb-is-the-mvp-database.md)) |
| Object storage | S3 — one bucket for attachments and payloads (specs-service [ADR-0020](../../specs/docs/decisions/0020-the-payload-store-and-the-rebuild.md)), versioned, never Object-Locked; the payload store is what a rebuild reads |
| Record sink | outbox holding the spine's envelope, built at the act (specs-service [ADR-0019](../../specs/docs/decisions/0019-the-outbox-holds-spine-envelopes.md)) → the spine's relay handler as `<name>-relay`, EventBridge Scheduler every minute, one at a time, under the spine module's `relay_policy_json` → the archive and the FIFO topic |
| Evaluator | HTTP adapter; `${VAR}` resolved from the environment |
| Notifier | SES; Slack webhook |
| MCP | stateless HTTP per request — Lambda-shaped already |

Configuration comes from `fps4/maestro-<tenant>/workspaces/*.yaml`, and the tenant root passes the module its `environment`, `secrets` (Secrets Manager ARNs), `bucket_name`, `web_adapter_layer_arn` and the spine module's `relay_environment` + `relay_policy_json` as `archive`. The public repository deploys to no account ([ADR-0017](../decisions/0017-the-tenant-repository-runs-the-pipeline.md)): its CI ends at `fmt`, `validate`, `terraform test`, an example root that validates, and a bundle that boots.

## Changes the MVP asks of it

| Change | State |
|---|---|---|
| Terraform module; the relay as a scheduled Lambda | done — fps4/maestro-specs#20 |
| The outbox holds the spine's envelope; seats and the answerable human (ADR-0019) | done — fps4/maestro-specs#18 |
| The payload store and the rebuild (ADR-0020): free text as payloads, `EvaluationRecorded`, a rebuilder that replays a verified archive — acceptance scenario R2 in code | done — fps4/maestro-specs#21 |
| Today reads work-service and agent-service alongside its own decisions and questions | to build (small, in the console) |
| Move the DoD gate to GitHub-hosted runners | done — fps4/maestro-specs#16 |
| Read the `prn` claim identity-service now mints instead of minting a principal id on first sight; `principal:adopt` for an identity first seen under a self-minted id — moves the grants and records the supersession forward, no record rewritten | done — fps4/maestro-specs#26 (specs-service [ADR-0022](../../specs/docs/decisions/0022-the-principal-id-is-identity-services.md)) |

Nothing else. The OpenSpec block shape and the external reader role are [post-MVP](../beyond-mvp.md).
