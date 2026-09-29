# Decisions

Architecture decision records, numbered from 0001. Each states context in a few sentences, the decision, its consequences, and what would reopen it. A decision is changed by a new record that supersedes it, never by editing.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-maestro-is-an-ops-engine.md) | maestro is an ops engine; idea-to-code is out of scope | accepted |
| [0002](0002-serverless-aws-is-the-substrate.md) | Serverless AWS is the substrate; docker compose is the development loop only | accepted; the CDK clause superseded by 0016, the runners clause narrowed by 0017, the consoles clause by 0026 |
| [0003](0003-the-spine-is-an-archive-and-a-queue.md) | The spine is an S3 archive with SNS/SQS delivery; the relay ships first | accepted |
| [0004](0004-exit-is-the-portable-export.md) | Exit is the portable export: archive plus verifier | accepted; *Atlas* leaves its list of managed services by 0018 |
| [0005](0005-atlas-flex-is-the-mvp-database.md) | MongoDB Atlas Flex is the MVP database | superseded by 0018 |
| [0006](0006-identity-stays-identity-service.md) | Identity stays identity-service, not Cognito | accepted |
| [0007](0007-tenant-is-a-deployment-by-default.md) | Tenant = deployment by default | accepted |
| [0008](0008-agent-service-record-half-first.md) | agent-service ships its record half first; the runner is GitHub Actions + Claude Code | accepted |
| [0009](0009-one-severity-scale.md) | One severity scale, SEV1–4; policy lives in work-service's definition | accepted |
| [0010](0010-tenant-configuration-is-one-private-repository-per-tenant.md) | Tenant configuration lives in one private repository per tenant | accepted; the repository's name amended by 0021 |
| [0011](0011-the-instance-register-is-one-deployable.md) | The instance register is one deployable | accepted |
| [0012](0012-the-application-owns-detection-maestro-owns-response.md) | The application owns detection; maestro owns response | accepted |
| [0013](0013-intake-agent-and-customer-tenants-are-post-mvp.md) | Intake agent and customer tenants are post-MVP; the regulated domain is a branch | accepted; its M1–M4 phasing replaced by 0022 |
| [0014](0014-the-mvp-ci-floor.md) | The MVP CI floor: secret scan, dependency audit, SBOM | accepted |
| [0015](0015-repositories-and-licence.md) | Repositories: one per component with a consumer; public under MIT | accepted; the first rule amended by 0020 |
| [0016](0016-terraform-is-the-infrastructure-language.md) | Terraform is the infrastructure language; the tenant repository holds the root module | accepted; the demo-tenant apply withdrawn by 0017; the Atlas clause moot by 0018 |
| [0017](0017-the-tenant-repository-runs-the-pipeline.md) | The tenant repository runs the pipeline: its runner, its targets, its state, its configuration | accepted |
| [0018](0018-dynamodb-is-the-mvp-database.md) | DynamoDB is the MVP database; the module creates its table; the pipeline applies it | accepted |
| [0019](0019-work-services-table.md) | work-service's table: a partition per item, the open set as an index, clocks by a sweep | accepted; the arming of `rescan_clear` amended by 0024, the fold's key by 0025 |
| [0020](0020-maestros-own-services-live-in-one-repository.md) | maestro's own services live in `fps4/maestro`; a repository is earned by a consumer outside maestro | accepted |
| [0021](0021-a-tenants-repository-is-maestro-tenant.md) | A tenant's repository is `fps4/maestro-<tenant>`; a tenant is never named after a component | proposed |
| [0022](0022-one-mvp-built-whole.md) | One MVP, built whole: no milestones, one acceptance list | proposed |
| [0023](0023-maestro-alerts-in-its-one-console.md) | maestro alerts in its console only in the MVP; a deployment has one console | proposed |
| [0024](0024-a-repositorys-rescan-follows-the-merge.md) | A repository's re-scan follows the merge, not the deploy | proposed |
| [0025](0025-the-weekly-fold-is-per-application.md) | The weekly fold is one obligation per application | proposed |
| [0026](0026-the-console-behind-the-tenants-edge.md) | The console runs like an API, behind the tenant's own edge | accepted |
| [0027](0027-runtime-services-table-and-feeds.md) | runtime-service: a partition per instance, the build record before the deploy, level and tier as events | accepted |
| [0028](0028-external-detection-and-correlated-outages.md) | An application that cannot publish is watched from outside by a detector it names; maestro correlates a shared failure | accepted |
| [0029](0029-a-persons-preferences-live-on-their-profile.md) | A person's preferences live on their profile in identity-service | accepted |
| [0030](0030-agent-runs-on-fargate.md) | Agent runs: a Fargate task per run, Opus 5.5 at an effort per kind, a GitHub App that cannot merge, transcripts under their own key | proposed |
| [0031](0031-risk-appetite-delegates-decisions.md) | Risk appetite: each application sets who decides at each risk grade; an agent decides only where that appetite delegates it; accountability never moves | proposed |

specs-service's own decision log moved with it to [`specs/docs/decisions/`](../../specs/docs/decisions/) (ADR-0001–0022 there) and is closed: its records are cited as "specs-service ADR-00NN", and every new decision, whatever it is about, is recorded here ([ADR-0020](0020-maestros-own-services-live-in-one-repository.md)).
