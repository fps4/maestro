# Tenancy and configuration

## Tenant = deployment

A tenant is one deployment of maestro: one Terraform root module and state, one identity realm, one archive prefix, one database cluster. Serverless removes the cost floor that would otherwise argue for sharing, so the simplest isolation story is also the cheapest ([ADR-0007](decisions/0007-tenant-is-a-deployment-by-default.md)).

Inside a deployment, every component isolates by **workspace** — a database per workspace, a handle bound once per request, no query naming a workspace. A tenant with several estates uses several workspaces; a tenant with one uses one. The code cannot tell the two apart.

What keeps the choice reversible: no record stores an identity provider's subject. Move a tenant between deployments and a binding row is re-pointed; the archive is untouched.

## Where configuration lives

| Kind | Where | Public? |
|---|---|---|
| Component code, design, decisions | the component's repository | yes |
| One fictional demo tenant (`aannemer-x`) | `config/examples/` in each component; the template below | yes |
| A real tenant's configuration | `fps4/maestro-<tenant>` | **no** — private, one repository per tenant |
| Secrets | Secrets Manager / SSM in the tenant's account, referenced by name | never in any repository |
| An application's own maestro glue (the signals module applied, the deploy-event step) | the application's repository | the application's business |

### `fps4/maestro-<tenant>`

Named after the tenant, never after a component: `specs`, `work`, `runtime`, `skills` and `config` are taken ([ADR-0021](decisions/0021-a-tenants-repository-is-maestro-tenant.md)).

Same layout in every tenant repository:

```
README.md                 who, contacts, which components at which tag; who holds the state mirror's key
.github/workflows/deploy.yml   a dozen lines calling fps4/maestro's reusable workflow: runner, target, tags
deploy/aws/               the root module for the tenant's account; backend.hcl names the state bucket,
                          terraform.tfvars carries account, region, domain, contacts
deploy/local/             the same modules against LocalStack; local state, disposable
deploy/aws/deploy-events.json  optional: application → the module that deploys it; after an apply, each application whose functions changed gets a `maestro.deploy` event (scripts/deploy.sh)
workspaces/*.yaml         workspace definitions in the tenant's vocabulary (types, gates, labels)
policy.yaml               severity × tier → clocks; agent ceilings; chase ladders; the SEV↔P mapping
adapters.yaml             notifier targets by name (Slack channel id, SES sender; unused in the MVP, ADR-0023); signal sources (topic ARNs)
applications/*.yaml       the tenant's applications: name, environments, tier, onboarding level, topic ARN
apps/<application>/       optional: an application the tenant owns and deploys from here, with its own workflow, e.g. a fixture it observes
secrets.md                the *names* of secrets in Secrets Manager / SSM — never values
```

**How a deployment uses it.** The tenant repository's pipeline — the reusable workflow from `fps4/maestro`, on the runner the tenant names — checks out each public component at a tag, builds it, plans on a pull request and applies on merge behind an environment gate, then mirrors the state ([ADR-0016](decisions/0016-terraform-is-the-infrastructure-language.md), [ADR-0017](decisions/0017-the-tenant-repository-runs-the-pipeline.md)). State is never in the repository: the S3 backend in the tenant's account is the authority, the runner keeps an encrypted mirror, `*.tfstate*` is ignored. The public repositories deploy to no account; the demo tenant is this layout with placeholder values, not a deployment.

### The caller

`.github/workflows/deploy.yml` is a dozen lines. The shape it calls is [`tenant-deploy.yml`](../.github/workflows/tenant-deploy.yml) in `fps4/maestro`; the scripts it runs come from the `maestro` component at the tag named in `components`, so `uses:` and `components.maestro` carry the same tag. That one tag names the spine, specs-service and work-service as built and tested together ([ADR-0020](decisions/0020-maestros-own-services-live-in-one-repository.md)): a release is tagged `v<version>`, and `spine-v<version>` only publishes the spine's npm package. A component with a repository of its own — identity-service — is a key of its own. `runner` is JSON: an array of labels for the tenant's own runners, a double-quoted string for a hosted one.

```yaml
name: deploy
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
  id-token: write
jobs:
  aws:
    uses: fps4/maestro/.github/workflows/tenant-deploy.yml@v0.4.0
    with:
      runner: '["self-hosted","ds1"]'   # or '"ubuntu-latest"'
      tenant: aannemer-x
      components: '{"maestro":"v0.4.0","identity-service":"<tag>"}'
    secrets:
      aws_role_arn: ${{ secrets.AWS_ROLE_ARN }}
      state_recipient: ${{ secrets.STATE_RECIPIENT }}
  local:
    uses: fps4/maestro/.github/workflows/tenant-deploy.yml@v0.4.0
    with:
      runner: '["self-hosted","ds1"]'
      target: local
      tenant: aannemer-x
      components: '{"maestro":"v0.4.0","identity-service":"<tag>"}'
```

What the tenant repository holds besides: the `production` environment with a required reviewer — the apply job runs in it, so the gate is a person; the deploy role's trust policy admitting `repo:fps4/maestro-aannemer-x:environment:production` (the apply) and `repo:fps4/maestro-aannemer-x:pull_request` (the plan); `AWS_ROLE_ARN` and `STATE_RECIPIENT` — the age public key; its private half is held by the person `README.md` names and is never in GitHub. On a hosted runner the mirror is a workflow artefact kept seven days; on the tenant's own runner it is written under `/srv/maestro/state/<tenant>/`.

The roots compose the component modules from the checkout the workflow made, by path:

```hcl
# deploy/aws/main.tf
terraform {
  required_version = ">= 1.6"
  backend "s3" {}                          # the bucket, key and region come from backend.hcl
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.80" }
  }
}
provider "aws" { region = var.region }

module "spine" {
  source              = "../../components/maestro/spine/terraform"
  name                = var.tenant
  archive_bucket_name = "${var.tenant}-maestro-archive"
  digest_contacts     = var.digest_contacts
  sealer_package      = abspath("${path.module}/../../components/maestro/spine/bundle/sealer.zip")
}
```

```hcl
# deploy/aws/backend.hcl — the one thing created by hand (ADR-0017 §4)
bucket       = "aannemer-x-maestro-state"
key          = "aws/terraform.tfstate"
region       = "eu-west-1"
use_lockfile = true
encrypt      = true
```

```hcl
# deploy/aws/terraform.tfvars
tenant          = "aannemer-x"
region          = "eu-west-1"
account_id      = "<account-id>"
domain          = "maestro.aannemer-x.example"
digest_contacts = ["ops@aannemer-x.example", "audit@aannemer-x.example"]
```

`deploy/local/main.tf` is the same composition with the provider pointed at LocalStack, `local_stand_in = true` and no backend — a tested copy is [`.github/self-test/deploy/local/main.tf`](../.github/self-test/deploy/local/main.tf), which this repository's CI applies through the reusable workflow on every pull request. What the stand-in cannot represent is named in the [spine README](../spine/README.md#localstack).

**The database.** Each component's DynamoDB table is its module's ([ADR-0018](decisions/0018-dynamodb-is-the-mvp-database.md)): created in the apply, granted to the functions that read it, nothing made out of band and no connection credential anywhere. `secrets.md` names the secrets that remain — identity-service's signing and admin secrets.

The order in which all of this is done, and what the first tenant taught, is [first-deployment.md](first-deployment.md).

## Guards in the public repositories

CI in every public maestro repository fails on:

- any path matching `tenants/**` or `config/tenants/**`;
- any file containing a 12-digit AWS account id, an `arn:aws:` carrying an account, or a `.env` that is not `.env.example`;
- a list of forbidden strings (client names) kept *outside* the repository, run as a custom secret-scan pattern — the list itself never lands in the repository.

The demo tenant stays fictional: `aannemer-x`, "Aannemer X", `usr-j-dekker`. A reviewer who sees a real company name in a public repository treats it as a defect.

## Later

When a customer is given access to their own configuration (the [customer-facing tenants](beyond-mvp.md#customer-facing-tenants) backlog item), their `maestro-<tenant>` repository is already theirs to be handed; the layout above is chosen so that nothing needs to be split out of it.
