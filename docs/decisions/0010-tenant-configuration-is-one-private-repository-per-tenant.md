# ADR-0010 · Tenant configuration lives in one private repository per tenant

**Status:** accepted · 2026-09-18 · the repository's name is amended by [ADR-0021](0021-a-tenants-repository-is-maestro-tenant.md): `fps4/maestro-<tenant>`

## Context

The maestro repositories go public ([ADR-0015](0015-repositories-and-licence.md)). A tenant's configuration — workspace definitions in its vocabulary, policy, adapter targets, CDK context — identifies the tenant and must not. A single private configuration repository with a folder per tenant would work until a tenant is given access to its own configuration, at which point it would have to be split.

## Decision

**One private repository per tenant, `fps4/maestro-config-<tenant>`** (`maestro-config-tenant1`, `maestro-config-demo`), with one layout ([tenancy-and-config.md](../tenancy-and-config.md)). The tenant's pipeline checks out the public components at a tag and deploys with that repository as context. The public repositories carry one fictional demo tenant and CI guards against anything else.

## Consequences

- Secrets live in neither kind of repository — Secrets Manager / SSM by name.
- An application's own maestro glue lives in the application's repository, not in maestro's.
- Handing a tenant its configuration later is handing it a repository it already has.

## What would reopen it

Nothing; a shared configuration repository is strictly less flexible.
