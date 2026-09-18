# The MVP

**maestro is an ops engine.** It observes applications that run in their owners' cloud accounts, turns what it sees into commitments with a named person answerable, lets agents do the work under ceilings a person set, and keeps a record that can be verified with every service off.

## What the MVP is

| Component | Holds | Status |
|---|---|---|
| [identity-service](components/identity-service.md) | principals — human, agent, workload; realms; delegated administration | built |
| [specs-service](components/specs-service.md) | artifacts, drafts and versions, gates, decisions, questions | built |
| [work-service](components/work-service.md) | work items in six classes, authority at claim, clocks from policy, signals intake, the board | next |
| [runtime-service](components/runtime-service.md) | the artifact ledger and the instance register, fed by deploy events | next |
| [agent-service](components/agent-service.md) | runs, steps, transcripts — the record of what agents did; the runner is GitHub Actions + Claude Code | next |
| [the spine](components/spine.md) | S3 archive as the system of record, SNS/SQS delivery, a relay from every outbox, a verifier | next, first |

Plus the [signals contract](signals.md) — a Terraform module and a CDK construct an application applies to be observed — and a Claude Code plugin (`maestro-skills`) so every repository in an estate can talk to the components.

## What the MVP is not

- Not a platform that generates applications from specifications. No composition plane, no engines, no generated code.
- Not a host. Applications run in their own accounts; maestro never executes an instance.
- Not a marketplace, not a standards catalogue, not a conformance product. The regulated domain is a [branch](beyond-mvp.md) whose seams the MVP keeps open.
- Not, yet, a Slack intake agent that turns a request into configuration, and not yet a product a customer signs in to. Both are on the [backlog](beyond-mvp.md), not the plan.

## Substrate

**Serverless AWS.** Every component is a Lambda behind API Gateway (Fastify unchanged, via the Web Adapter); consoles through OpenNext and CloudFront; relays and clocks are scheduled Lambdas; infrastructure as CDK; CI on GitHub-hosted runners. `docker compose` is the local development loop and nothing else.

**MongoDB Atlas Flex** is the database ([ADR-0005](decisions/0005-atlas-flex-is-the-mvp-database.md)): a connection string, no code change, pay per use. No component knows which database it runs on beyond the driver.

**Identity stays identity-service**, not Cognito ([ADR-0006](decisions/0006-identity-stays-identity-service.md)): agent principals and delegated administration are the reasons.

## The record

Each component writes its events to a transactional outbox. A scheduled relay drains every outbox into an **S3 archive** — sealed daily segments, a hash chain computed in code, Object Lock as defence in depth — and publishes to **SNS FIFO → SQS FIFO** per consumer, message group = workspace. The archive is the system of record; every component database is a projection of it. Replay reads the archive, never the queue. The relay ships before any consumer ([ADR-0003](decisions/0003-the-spine-is-an-archive-and-a-queue.md)).

**Exit is the export** ([ADR-0004](decisions/0004-exit-is-the-portable-export.md)): the archive, its manifests and the verifier, readable with every service switched off. Nothing else needs to be portable, because nothing else is the record.

## Tenancy

**Tenant = deployment** ([ADR-0007](decisions/0007-tenant-is-a-deployment-by-default.md)). One CDK stack, one identity realm, one archive prefix per tenant. Workspace isolation inside a deployment stays available for a tenant with several estates. Tenant configuration lives outside the public repositories, in `fps4/maestro-config-<tenant>` ([tenancy-and-config.md](tenancy-and-config.md)).

## The first application

The first application maestro observes — **app1** throughout these docs — is a serverless application on AWS: Lambda functions, infrastructure as code, configuration changes by PR under CODEOWNERS, its own failure monitor with P1–P4 alerts to Slack. Its maestro glue (the signals module, a deploy-event step) lives in its own repository. It is onboarded at N2 by milestone 4.

## Four seams kept open

The regulated branch is not built, but four things cost nothing now and cannot be added later:

1. The archive is the only record — no state that exists nowhere else.
2. Every write attributed; every decision names a human.
3. `consequence_class` on every work item and instance, even while nothing reads it.
4. Classification on every payload and transcript, even while retention is generous.
