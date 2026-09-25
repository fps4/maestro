# work-service

**Who owes what, by when, under whose authority — and whether it happened.**

work-service turns signals, people, gates and recurrences into **commitments**: a work item names
the human answerable for it, derives its clocks from the tenant's policy, checks authority when
the work is claimed and refuses rather than warns, and closes on **evidence** — a merged change, a
deploy, an alarm back to OK — rather than on someone typing "done". It is a component of
[maestro](https://github.com/fps4/maestro), an ops engine for running applications; its design
is [`docs/components/work-service.md`](https://github.com/fps4/maestro/blob/main/docs/components/work-service.md)
there, and its table is maestro's [ADR-0019](https://github.com/fps4/maestro/blob/main/docs/decisions/0019-work-services-table.md).

Its only required dependency is [identity-service](https://github.com/fps4/identity-service): a
token's `prn` claim is the principal, and this service mints no ids for people or agents.
Everything else is a port with a local default.

## What it is not

- **Not a ticket tracker.** Six classes — change, objective, remediation, obligation, support,
  review — each with a rule for how it closes. A field or class with no rule is rejected at review.
- **Not a decider.** An item asserts nothing. Where an outcome needs acceptance, the proposal is
  made in specs-service and the item links the accepted version.
- **Not a distributor.** First claim wins; nothing optimises who gets what.

## Layout

```
maestro-work/
 ├── api/                 REST API and MCP server. domain/ is pure; a lint rule keeps it so
 │    ├── src/domain/     the state machine, policy, authority, evidence — decide and evolve
 │    ├── src/db/         the table (table.ts), the key layout (keys.ts), handles, the outbox
 │    └── src/relay/      the spine's relay over this service's outbox
 ├── config/workspaces/   the domain model as data: the demo tenant (aannemer-x)
 ├── infra/docker/        compose and the CI images — the local loop, not a deployment target
 └── terraform/           the module a tenant's root deploys: the table, the payload store, the API, the relay
```

## Quick start

```bash
make dynamodb   # DynamoDB Local on :8040
make test       # each test file makes and drops its own table
make up         # DynamoDB Local and the api on :8041, the record sink a local directory
```

Configuration is environment only; `api/src/config.ts` is the schema. `TABLE_NAME` is required;
`DYNAMODB_ENDPOINT` names DynamoDB Local; `AUTH_MODE=dev` takes `Bearer dev:<prn>[:role,role]` and
is refused in production; `AUTH_MODE=jwks` with `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`
verifies identity-service's tokens. `RECORD_SINK` is `local` (a filesystem archive `spine-verify`
reads), `s3` (the spine's bucket and topic) or `off` (the relay Lambda drains the outbox).

## The table

One DynamoDB table, the same shape as every maestro component's (`pk`/`sk`, `gsi1`, `gsi2`, the
sparse `pending`, TTL on `expires_at`), made by the Terraform module and reached by each
function's role — no database credential exists. `api/src/db/table.ts` and
`aws_dynamodb_table.records` declare it together; the service describes the table at boot and
refuses to start on one that differs. `api/tests/unit/grant.test.ts` reads the DynamoDB commands
the code sends and the actions the module grants, and fails on a gap: DynamoDB Local enforces no
IAM, so this is the only place a missing grant is caught before AWS.

## Deployment

A Terraform module in [`terraform/`](terraform/) (maestro ADR-0016, ADR-0018). A tenant's private
configuration repository composes it with the spine's module, and the tenant's pipeline applies it
(maestro ADR-0017). Nothing here deploys anywhere: CI runs on GitHub-hosted runners and ends at
`fmt`, `validate`, the module's tests against a mocked provider, the example root, and a bundle
that boots.

| Resource | Notes |
|---|---|
| the table | as above; on demand, point-in-time recovery, encrypted, `prevent_destroy` |
| the payload store (`bucket_name`) | an item's title, a note, a reason; versioned, encrypted, never public, never Object-Locked |
| `<name>-api` | the Fastify server behind the Lambda Web Adapter and an HTTP API Gateway; `RECORD_SINK=off` |
| `<name>-relay` | the spine's relay handler over the outbox, every minute, one at a time |
| four alarms | API 5xx; relay errors, silent, refused |

Inputs are specs-service's module's (`name`, `table_name`, `bucket_name`, `api_package`,
`relay_package`, `web_adapter_layer_arn`, `environment`, `secrets`, `archive`, …) plus
`archive_prefix`. **The archive prefix matters:** the spine's `seq` is per workspace and per
writer, so two components relaying the same workspace slug into the same prefix collide — the
second one's `seq 1` is refused. Give this component its own prefix, and a sealer that seals it.

```bash
cd api && npm ci && npm run bundle && npm run sbom   # bundle/api.zip, bundle/relay.zip, SBOMs beside them
```

## Status

M2, first slice, in progress. See maestro's [roadmap](https://github.com/fps4/maestro/blob/main/docs/roadmap.md).

## Licence

MIT — see [LICENSE](LICENSE). The tree holds code, the design and one fictional tenant; a real
tenant's configuration lives in its own private repository, and CI fails on anything that
identifies one (`scripts/check-public.sh`).
