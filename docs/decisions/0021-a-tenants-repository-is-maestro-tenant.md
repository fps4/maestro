# ADR-0021 · A tenant's repository is `fps4/maestro-<tenant>`

**Status:** proposed · 2026-09-26 · amends [ADR-0010](0010-tenant-configuration-is-one-private-repository-per-tenant.md) (the repository's name; everything else stands)

## Context

[ADR-0010](0010-tenant-configuration-is-one-private-repository-per-tenant.md) named a tenant's private repository `fps4/maestro-config-<tenant>`. The name says configuration; the first tenant's repository holds more than that. It holds the root module that composes the components ([ADR-0016](0016-terraform-is-the-infrastructure-language.md)), the pipeline's caller and the state backend ([ADR-0017](0017-the-tenant-repository-runs-the-pipeline.md)), the gate scripts, and the pins that say which maestro it runs. It is the tenant's deployment. `-config` is a word every reference carries and none needs.

## Decision

1. **A tenant's private repository is `fps4/maestro-<tenant>`**: `maestro-tenant1`, and `maestro-aannemer-x` for the demo tenant's layout. There is still one per tenant, it is still private, and it keeps the same layout ([tenancy-and-config.md](../tenancy-and-config.md)).
2. **A tenant's name is never a component's.** `fps4/maestro-<name>` is also how a maestro component repository is named: `maestro-specs` and `maestro-work` stay as archived repositories ([ADR-0020](0020-maestros-own-services-live-in-one-repository.md)), and `maestro-runtime`, `maestro-skills` and `maestro-config` are names the design has used. A tenant is not named `specs`, `work`, `runtime`, `skills`, `config`, or after any other component.
3. **The first tenant's repository, `maestro-config-fps4`, is renamed `maestro-fps4`.**

## Consequences

- GitHub redirects the old name for clones, fetches and a workflow's `uses:`, so nothing that still names `maestro-config-<tenant>` breaks at the rename. References are brought level anyway.
- The pipeline's deploy role trusts the tenant repository by its immutable subject, which names the repository's id rather than its name ([ADR-0017](0017-the-tenant-repository-runs-the-pipeline.md)). A rename changes nothing there, as the first tenant's own earlier rename already showed.
- The name no longer tells a tenant repository apart from a component repository by its shape. Their visibility still does: a tenant's repository is private, and a component's is public.

## What would reopen it

A tenant whose natural name collides with a component's. The rule in decision 2 then needs a prefix after all, and the tenant would carry one rather than every tenant carrying `-config`.
