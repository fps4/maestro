# ADR-0016 · Terraform is the infrastructure language; the tenant repository holds the root module

**Status:** accepted · 2026-09-19 · supersedes the *infrastructure as CDK* clause of [ADR-0002](0002-serverless-aws-is-the-substrate.md); the *apply for the demo tenant on merge* clause is withdrawn by [ADR-0017](0017-the-tenant-repository-runs-the-pipeline.md)

## Context

[ADR-0002](0002-serverless-aws-is-the-substrate.md) chose CDK: TypeScript beside the services, Lambda bundling and the OpenNext consoles solved by constructs, IAM as grants. Those are real advantages for the one architect building the MVP. Against them: the deploy is run by the tenant's pipeline, and platform teams overwhelmingly run Terraform; the application-side [signals module](../signals.md) is already Terraform, so a tenant would touch two tools; CDK's state is implicit (CloudFormation, a diff against the last template rather than the live account) where Terraform's is explicit and reviewable; and the pieces that are not AWS — the Atlas cluster, GitHub settings — have Terraform providers and no CDK constructs. The spine's AWS half is about to be written and is the first infrastructure the repositories hold, so the choice is made now, once.

## Decision

- **Infrastructure as Terraform.** Every component ships a Terraform module for itself in its own repository (`terraform/` beside the code): the Lambda functions, their schedules, queues, buckets and topics, and the IAM the component needs. A module takes the component's built artefact — the zip `npm run build` produces — as an input; bundling is the package's job, not the module's.
- **One root module per tenant**, in `fps4/maestro-config-<tenant>`, composes the component modules at a tag. `terraform.tfvars` carries the tenant's inputs — account, region, domain, database endpoint name — in place of `cdk.context.json`. State lives in an S3 bucket in the tenant's account, created once by hand and named in `backend.hcl`; Terraform's native S3 locking, no lock table.
- **`plan` is the review artefact.** The public repositories run `terraform fmt -check`, `validate` and a plan for the demo tenant on every PR, and apply for the demo tenant on merge; a tenant's pipeline plans on a PR and applies on merge, from the checked-out components at their tags.
- **The modules run on OpenTofu unchanged.** Nothing beyond what both implement.
- The application-side signals module stays a Terraform module **and** a CDK construct ([ADR-0012](0012-the-application-owns-detection-maestro-owns-response.md)): that is the application's tool, not ours.

## Consequences

- The rest of ADR-0002 stands: Lambda behind API Gateway via the Web Adapter, OpenNext consoles, scheduled Lambdas, GitHub-hosted CI, `docker compose` for the laptop only. The consoles' module wraps OpenNext's build output; whether it is the community module or one of ours is settled when the first console deploys.
- Where earlier records say *CDK stack*, *CDK app*, *CDK context* or *the per-tenant CDK product* ([ADR-0007](0007-tenant-is-a-deployment-by-default.md), [ADR-0010](0010-tenant-configuration-is-one-private-repository-per-tenant.md), [ADR-0013](0013-intake-agent-and-customer-tenants-are-post-mvp.md)), read *the tenant root module*, *`terraform.tfvars`* and *a module that stands up a tenant*. The records are not edited.
- Resource identity is explicit. The archive bucket and its Object Lock configuration carry `prevent_destroy`; a refactor moves them with a `moved` block and can never replace them. A failed apply leaves state naming what landed, not a rollback.
- Drift is visible on every plan, which is what a deployment nobody is supposed to touch by hand wants.
- The Atlas project and cluster *can* now join the root module through the `mongodbatlas` provider. The MVP keeps the endpoint as an input; joining is a later, separate change.
- Cost: every component repository carries HCL beside TypeScript; Lambda packaging is a build step per package; the consoles depend on an OpenNext module maestro does not own or must write.

## What would reopen it

A tenant whose platform team can run CloudFormation and nothing else. A change to Terraform's licence that reaches this use — the modules already run on OpenTofu, so the answer is a switch, not a rewrite.
