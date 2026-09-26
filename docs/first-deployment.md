# The first deployment: from an empty account to the first act

The runbook for standing a tenant up on AWS — what [tenancy-and-config.md](tenancy-and-config.md) describes as a layout, in the order it is done, with what the first tenant taught. Every step is either the tenant repository's pipeline ([ADR-0017](decisions/0017-the-tenant-repository-runs-the-pipeline.md)) or a person holding a role, and the runbook says which. Placeholders are the demo tenant's (`aannemer-x`, `app1`); a real tenant's values live in its private `maestro-<tenant>` repository and nowhere else.

## 0. Before anything

- **An account of the tenant's own**, with no organisation guardrail that fences what the pipeline creates. A service control policy that denies, say, `secretsmanager:CreateSecret` to IAM users is found on the first bootstrap, not on the plan; an account inside such an organisation is its cloud team's to open, or it is the wrong account.
- **A person's credentials for the bootstrap** — an `aws login` session as an IAM user with administrator access is enough and leaves no key on any laptop. The pipeline never uses them.
- **Node 22** on the laptop that runs the operator steps (the bundles build on it); Terraform ≥ 1.11; `age`.

## 1. The tenant repository

`fps4/maestro-<tenant>` from the layout in [tenancy-and-config.md](tenancy-and-config.md): `deploy/aws/` composing the components' modules at pinned refs, `deploy/local/` against LocalStack, `.github/workflows/deploy.yml` calling the reusable workflow, `workspaces/*.yaml` in specs-service's definition shape with their facet schemas beside them, `identity/seed.yaml`, `applications/*.yaml`, `secrets.md`, `bootstrap.sh`.

Three things the first tenant got wrong and the layout now says:

- **Every bucket name carries the account id** (`<tenant>-maestro-archive-<account>`): S3 names are global, and a deleted name is held for up to an hour. Nobody else can hold them, and nothing waits.
- **A workspace definition is validated before it is applied** — `npm run workspace:validate -- <dir>` in specs-service's `api/`. A definition in an earlier shape reads as a definition and is not one.
- **Component refs are full commit SHAs or tags**: GitHub serves a fetch by full SHA, never by an abbreviated one.

## 2. Bootstrap, by hand

`bootstrap.sh`, under the person's profile, idempotent:

1. **The state bucket** — versioned, encrypted, public access blocked; `deploy/aws/backend.hcl` names it.
2. **The secrets' names** — empty, so a plan resolves them; values entered by a person afterwards (`put-secret-value --secret-string file://…` from a file deleted after). A tenant's only secrets are identity-service's: the signing secret, the key passphrase, the admin client's secret. **There is no database secret** ([ADR-0018](decisions/0018-dynamodb-is-the-mvp-database.md)): each module makes its table and grants it.
3. **The Lambda concurrency quota** — a new account runs ten invocations at once, and the relays reserve one each, which must leave ten unreserved. Ask for the ordinary 1000 before the first apply (`service-quotas request-service-quota-increase --service-code lambda --quota-code L-B99A9384 --desired-value 1000`); it can take an hour, or a support case.
4. **The state mirror's key** — `age-keygen`; the private half stays with the person the README names; the public half is `STATE_RECIPIENT`.

## 3. Arm the pipeline

- **GitHub's OIDC provider** in the account, and **the deploy role** trusting it. The trust policy names the repository by its **immutable subject** — `repo:<org>@<org id>/<name>@<repo id>:…`, read from `gh api repos/<org>/<name>/actions/oidc/customization/sub --jq .sub_claim_prefix` — for three subjects: `:pull_request` (the plan), `:ref:refs/heads/main` (the plan before the apply), `:environment:production` (the apply). Pin the ids and wildcard the name (`repo:<org>@<org id>/*@<repo id>:…`): a rename cannot break it, another repository cannot borrow it. The plain `repo:<org>/<name>` form is refused with *Not authorized to perform sts:AssumeRoleWithWebIdentity* on a repository GitHub has moved to immutable subjects.
- **Repository secrets** `AWS_ROLE_ARN` and `STATE_RECIPIENT`; the **`production` environment**. Required reviewers on a private repository are a paid-plan feature; on the free plan the environment exists without one and **the merge is the gate** — the plan in the pull request's job summary is the review [ADR-0016](decisions/0016-terraform-is-the-infrastructure-language.md) asks for.

The first pull request's `aws / plan` proves it: the role assumed, the plan in the summary. Merging applies.

## 4. The apply

Spine → identity-service → specs-service in one apply; the modules order themselves. Read the outputs (`terraform -chdir=deploy/aws output`): the issuer, the two API URLs, the archive bucket, the events topic. Then probe: `/.well-known/jwks.json` on the issuer, `/health` on both.

**A grant DynamoDB Local never checks.** The tests run on DynamoDB Local, which enforces no IAM: a command the code sends that the module's grant does not name passes every test and refuses the first request on AWS. Both services carry a test that holds the grant to the commands the code sends; keep it when a store changes.

## 5. People

1. **Seed identity-service's realm** from `identity/seed.yaml` — the management-plane client, the admin console, the `maestro` application (audience `maestro`, the workspace's seats and gate-owner roles as its catalogue) and **the first human, with a random password nobody keeps**, attributed to that human (`--as`): their registration is the realm's first event, and the identity relay carries it into the archive within the minute.
2. **A set-password link** for them — `manage-users password-link --email … --issuer …` — handed over out of band. They open it on the service's own page, choose their password, and no temporary password ever existed.
3. **Apply the workspaces** to specs-service — the catalogue and the tenant's — attributed to the human's `prn-h-…`.
4. **Admit the human** — `workspace:member -- <workspace> --issuer <issuer> --subject <their user id> --roles …`. A token names who someone is; the membership names what the workspace lets them do; nothing else writes one.

Until specs-service read the `prn` claim (specs-service ADR-0022), it minted its own principal id for the same (issuer, subject): two ids for one human across components, one record each.

## 6. The gate

**Gate 1.** A token from the web credential (password grant); through the specs API a draft, its facets confirmed, proposed, decided at a gate. The specs relay lands every event in the archive within the minute (`ws-<workspace>/<day>/events-<seq>.jsonl`); a FIFO queue subscribed to the events topic receives them in order.

**Gate 2.** After the sealer has run (00:07 UTC, or invoked): `npm run workspace:rebuild -- --workspace <id> --force` from the archive and the payload store; every read returns identically.

**Gate 3.** `aws s3 sync` the workspace's archive prefix to a laptop; `spine-verify` passes with every function's reserved concurrency at zero, then restored.

## 7. Tear-down, when a name was wrong

The tables, the archive bucket and its lock configuration, and the payload bucket carry `prevent_destroy`. To rebuild under another name: `terraform state rm` those, `terraform destroy` the rest, delete the protected ones by hand (all versions first for a versioned bucket), the state bucket and the secrets; the OIDC provider, the role and the user stay.
