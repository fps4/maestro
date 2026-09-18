# Tenancy and configuration

## Tenant = deployment

A tenant is one deployment of maestro: one CDK stack, one identity realm, one archive prefix, one database cluster. Serverless removes the cost floor that would otherwise argue for sharing, so the simplest isolation story is also the cheapest ([ADR-0007](decisions/0007-tenant-is-a-deployment-by-default.md)).

Inside a deployment, every component isolates by **workspace** — a database per workspace, a handle bound once per request, no query naming a workspace. A tenant with several estates uses several workspaces; a tenant with one uses one. The code cannot tell the two apart.

What keeps the choice reversible: no record stores an identity provider's subject. Move a tenant between deployments and a binding row is re-pointed; the archive is untouched.

## Where configuration lives

| Kind | Where | Public? |
|---|---|---|
| Component code, design, decisions | the component's repository | yes |
| One fictional demo tenant (`aannemer-x`) | `config/examples/` in each component; `fps4/maestro-config-demo` | yes |
| A real tenant's configuration | `fps4/maestro-config-<tenant>` | **no** — private, one repository per tenant |
| Secrets | Secrets Manager / SSM in the tenant's account, referenced by name | never in any repository |
| An application's own maestro glue (the signals module applied, the deploy-event step) | the application's repository | the application's business |

### `fps4/maestro-config-<tenant>`

Same layout in every tenant repository:

```
README.md                 who, contacts, which components at which tag
cdk.context.json          account, region, domain, database endpoint name
workspaces/*.yaml         workspace definitions in the tenant's vocabulary (types, gates, labels)
policy.yaml               severity × tier → clocks; agent ceilings; chase ladders; the SEV↔P mapping
adapters.yaml             notifier targets by name (Slack channel id, SES sender); signal sources (topic ARNs)
applications/*.yaml       the tenant's applications: name, environments, tier, onboarding level, topic ARN
secrets.md                the *names* of secrets in Secrets Manager / SSM — never values
```

**How a deployment uses it.** The tenant repository's pipeline checks out each public component at a tag and runs `cdk deploy` with the repository root as context. The public repositories' own pipelines deploy only the demo tenant. `maestro-config-demo` proves the layout round-trips and may be public.

## Guards in the public repositories

CI in every public maestro repository fails on:

- any path matching `tenants/**` or `config/tenants/**`;
- any file containing a 12-digit AWS account id, an `arn:aws:` carrying an account, or a `.env` that is not `.env.example`;
- a list of forbidden strings (client names) kept *outside* the repository, run as a custom secret-scan pattern — the list itself never lands in the repository.

The demo tenant stays fictional: `aannemer-x`, "Aannemer X", `usr-j-dekker`. A reviewer who sees a real company name in a public repository treats it as a defect.

## Later

When a customer is given access to their own configuration (the [customer-facing tenants](beyond-mvp.md#customer-facing-tenants) backlog item), their `maestro-config-<tenant>` repository is already theirs to be handed; the layout above is chosen so that nothing needs to be split out of it.
