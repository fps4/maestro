# Decisions

Architecture decision records, numbered from 0001. Each states context in a few sentences, the decision, its consequences, and what would reopen it. A decision is changed by a new record that supersedes it, never by editing.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-maestro-is-an-ops-engine.md) | maestro is an ops engine; idea-to-code is out of scope | accepted |
| [0002](0002-serverless-aws-is-the-substrate.md) | Serverless AWS is the substrate; docker compose is the development loop only | accepted |
| [0003](0003-the-spine-is-an-archive-and-a-queue.md) | The spine is an S3 archive with SNS/SQS delivery; the relay ships first | accepted |
| [0004](0004-exit-is-the-portable-export.md) | Exit is the portable export: archive plus verifier | accepted |
| [0005](0005-atlas-flex-is-the-mvp-database.md) | MongoDB Atlas Flex is the MVP database | accepted |
| [0006](0006-identity-stays-identity-service.md) | Identity stays identity-service, not Cognito | accepted |
| [0007](0007-tenant-is-a-deployment-by-default.md) | Tenant = deployment by default | accepted |
| [0008](0008-agent-service-record-half-first.md) | agent-service ships its record half first; the runner is GitHub Actions + Claude Code | accepted |
| [0009](0009-one-severity-scale.md) | One severity scale, SEV1–4; policy lives in work-service's definition | accepted |
| [0010](0010-tenant-configuration-is-one-private-repository-per-tenant.md) | Tenant configuration lives in one private repository per tenant | accepted |
| [0011](0011-the-instance-register-is-one-deployable.md) | The instance register is one deployable | accepted |
| [0012](0012-the-application-owns-detection-maestro-owns-response.md) | The application owns detection; maestro owns response | accepted |
| [0013](0013-intake-agent-and-customer-tenants-are-post-mvp.md) | Intake agent and customer tenants are post-MVP; the regulated domain is a branch | accepted |
| [0014](0014-the-mvp-ci-floor.md) | The MVP CI floor: secret scan, dependency audit, SBOM | accepted |
| [0015](0015-repositories-and-licence.md) | Repositories: one per component with a consumer; public under MIT | accepted |

The component-level decisions of specs-service live in `fps4/maestro-specs` (`docs/design/decisions/`, ADR-0001–0018 there) and are not repeated here.
