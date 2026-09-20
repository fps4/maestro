# ADR-0017 · The tenant repository runs the pipeline: its runner, its targets, its state, its configuration

**Status:** accepted · 2026-09-20 · narrows the *runners* clause of [ADR-0002](0002-serverless-aws-is-the-substrate.md); extends [ADR-0016](0016-terraform-is-the-infrastructure-language.md) and withdraws its demo-tenant apply

## Context

[ADR-0016](0016-terraform-is-the-infrastructure-language.md) put the root module in `fps4/maestro-config-<tenant>` and said: plan on a PR, apply on merge. [ADR-0002](0002-serverless-aws-is-the-substrate.md) put CI on GitHub-hosted runners and retired the ds1 runner pool "for maestro repositories". Three things are still open:

- **Where a tenant's pipeline runs, and against what.** fps4 operates ds1 and wants its own tenants deployed from it; the same modules should also apply to a stand-in on ds1 so a change is exercised before it reaches an account. Today `maestro-specs`, a public repository, runs its DoD job on the org's ds1 runner — the configuration GitHub warns against, because a pull request from a fork executes on the runner.
- **Where Terraform's state lives and how many copies.** The state names everything the tenant's inputs name — it is tenant-identifying — and losing it means losing the ability to manage the deployment. One copy in the cloud that holds the deployment is one copy too few; a copy in a repository is one copy too public.
- **How much of the pipeline is written in the public repositories.** The steps are the same for every tenant; the runner label, the account, the role, the buckets, the reviewers and the schedule are not, and none of them may appear in a public repository ([tenancy-and-config.md](../tenancy-and-config.md)).

Everything the pipeline does must also be doable from a laptop by a person holding the role: exit is portable ([ADR-0004](0004-exit-is-the-portable-export.md)), and a pipeline that is the only thing that can deploy is a dependency, not a convenience.

## Decision

### 1. The shape is public; the configuration is the tenant's

`fps4/maestro` ships one **reusable workflow**, `.github/workflows/tenant-deploy.yml` (`workflow_call`): check out each component at its tag, build, `fmt -check`, `validate`, plan on a pull request, apply on merge behind an environment gate, mirror the state. Its inputs are the runner label, the target, the component tags and the mirror path; its secrets are the deploy role's ARN and the mirror's encryption key. The workflow calls `scripts/deploy.sh <plan|apply|mirror>`, and so can a person.

The tenant repository holds the caller (a dozen lines), its GitHub **environments** — `production` with a required reviewer, so the apply gate is a person — its variables and secrets, `backend.hcl` and `terraform.tfvars`. Nothing in a public repository names a runner label, an account, a role or a bucket; the [public-repository guards](../build-standards.md#1-repository) already fail on an account id or an ARN that carries one, and gain a rule for `runs-on: [self-hosted` and for `*.tfstate*`.

### 2. Runners

- **Public repositories: GitHub-hosted, always.** ADR-0002 stands there, and the reason is now sharper than cost: a self-hosted runner attached to a public repository runs strangers' code. `maestro-specs`' DoD job moves to GitHub-hosted in M1 (already planned), and the org runner group stops admitting public repositories.
- **Tenant repositories are private and choose their runner** through the workflow's input. fps4's own tenant runs on the **ds1 runner**; a tenant with its own runners names them; a tenant with none uses GitHub-hosted.
- **The demo tenant is a template, not a deployment.** The tenant repository's layout, with placeholder values, is documented in [tenancy-and-config.md](../tenancy-and-config.md); `fps4/maestro-config-demo` is created only if a template repository proves more useful than the page, and then holds the same placeholders and no pipeline that runs. **No public repository deploys to an account.**
- **No credentials on any runner.** Whatever the runner, the job assumes the tenant's deploy role through **GitHub's OIDC provider**, with the trust policy scoped to `repo:fps4/maestro-config-<tenant>:environment:<env>`. Revoking a runner is editing a trust policy. ds1 holds no AWS keys.

### 3. Targets

The tenant repository has one root per target, both composing the same modules:

```
deploy/aws/      the tenant's account — S3 backend, the real thing
deploy/local/    LocalStack on ds1 — provider endpoints overridden, local backend, disposable
```

`local` is the development loop's shape that ADR-0002 allows, applied by the same modules; **nothing is deployed to ds1 as a tenant**. LocalStack runs on ds1 for fps4's tenant pipeline and as a job service container in a public repository's CI. A resource it cannot represent (Object Lock retention, the Scheduler if absent from the edition in use) is skipped under `target = "local"` and named in the manifest ([build-standards.md](../build-standards.md#the-manifest-rule)). A change to a module reaches `local` on every pull request — in the public repository and in the tenant's — and `aws` on merge in the tenant's.

### 4. State: one authority, three copies, none in a repository

- **Authoritative: the S3 backend in the tenant's account.** Versioned bucket, SSE, no public access, Terraform's native lockfile, a bucket policy admitting the deploy role and fps4's break-glass principal only. The bucket is the one thing created by hand and is named in `backend.hcl`.
- **The mirror.** After every apply the pipeline runs `terraform state pull` and writes the result **outside the checkout**, encrypted with [`age`](https://age-encryption.org) to a recipient whose private key does not live on the runner — the runner holds the public half only, so a compromised host cannot read what it mirrored. On ds1: `/srv/maestro/state/<tenant>/<utc-timestamp>.tfstate.age`, mode 0600 — the off-cloud copy. On a GitHub-hosted runner: the same file as a workflow artefact. A laptop run mirrors to the same layout under the operator's home.
- **Retention: seven days, and the newest is never pruned.** Mirrors older than seven days are removed on the next run except the most recent one, whatever its age — it is the recovery point. The artefact variant sets `retention-days: 7`.
- **History.** The bucket's versions are the third copy. Recovery from any of the three is `terraform state push`.
- **Never in a repository.** `*.tfstate*` is gitignored in every tenant repository and the guards fail on one landing anywhere.

## Consequences

- One script is the pipeline: `scripts/deploy.sh` runs identically on ds1, on GitHub-hosted, and on a laptop; the workflow is a thin caller. A tenant that cannot use GitHub Actions runs the script from its own pipeline with the same inputs.
- The ds1 runner returns for private repositories only. Its upkeep is fps4's, as today; it gains an `age` recipient and a state path, nothing else.
- ADR-0016's "apply for the demo tenant on merge" is withdrawn: a public repository's pipeline ends at `fmt`, `validate`, `terraform test` and the LocalStack apply. LocalStack's gaps are named, not hidden; the first real tenant is what proves a module on real AWS.
- The state mirror is tenant-identifying and encrypted; the `age` recipient is a variable of the tenant repository's environment, the private key is held by a named person in the tenant's `README.md` and is never a repository secret.
- ADR-0002's runner clause now reads: GitHub-hosted for the public repositories; a tenant's choice for its own. Its "docker compose is not a deployment target" holds unchanged.

## What would reopen it

GitHub's OIDC provider unavailable to a tenant (IAM Roles Anywhere with a certificate on the runner takes its place, same role). A tenant forbidden from GitHub altogether (the script runs from their pipeline; the reusable workflow is then documentation). ds1 retired (the mirror moves to whatever hardware fps4 keeps; the decision names a path, not a host).
