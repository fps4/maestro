# ADR-0002 · Serverless AWS is the substrate; docker compose is the development loop only

**Status:** accepted · 2026-09-18 · the *infrastructure as CDK* clause is superseded by [ADR-0016](0016-terraform-is-the-infrastructure-language.md); the *runners* clause is narrowed to the public repositories by [ADR-0017](0017-the-tenant-repository-runs-the-pipeline.md)

## Context

The components are Fastify services with stateless MCP transports, Next.js consoles, and scheduled relays. None names its substrate. The previous plan ran them as containers on a self-hosted host with self-hosted CI runners, then Kubernetes. The estate's applications already run serverless on AWS.

## Decision

Every component deploys as **Lambda behind API Gateway** (via the Lambda Web Adapter, code unchanged); consoles through **OpenNext** to Lambda and CloudFront; relays and clocks as **scheduled Lambdas**; infrastructure as **CDK**; CI on **GitHub-hosted runners**. `docker compose` (a replica set and MinIO on a laptop) is the local development loop and not a deployment target. The self-hosted runner pool and its deploy workflow retire for maestro repositories.

## Consequences

- Idle cost is near zero for every component; a tenant deployment is cheap, which is what makes [ADR-0007](0007-tenant-is-a-deployment-by-default.md) the default.
- Lambda's fifteen-minute limit rules out running agents in Lambda; the runner is GitHub Actions ([ADR-0008](0008-agent-service-record-half-first.md)).
- The database is the one place serverless is not free — ruled separately in [ADR-0005](0005-atlas-flex-is-the-mvp-database.md).

## What would reopen it

A component whose request shape does not fit Lambda (long-lived connections, sustained CPU); a tenant that cannot run on AWS.
