# ADR-0015 · Repositories: one per component with a consumer; maestro-only services live in `fps4/maestro`; public under MIT

**Status:** accepted · 2026-09-18

## Context

identity-service is public under MIT. maestro-specs and maestro are private with no licence. The next components need homes, and an estate of application repositories is a consumer that is not maestro.

## Decision

- **A repository is earned by a consumer.** identity-service, maestro-specs, maestro-work and maestro-runtime each have one; maestro-skills (the plugin) is consumed by every repository in an estate. Services with no consumer but maestro — the spine, agent-service — live in `fps4/maestro`.
- **Public under MIT**, matching identity-service: `maestro`, `maestro-specs`, and every next component. Visibility and licence change as the **last step** of the docs refactor, after the tenant-configuration guards are green.
- Tenant configuration is private per tenant ([ADR-0010](0010-tenant-configuration-is-one-private-repository-per-tenant.md)).

## Consequences

- Across repositories the boundary is the network and the port contract. Inside `fps4/maestro`, an import lint keeps services apart once it holds code.
- Every `Repository:` line in a component document must resolve.

## What would reopen it

A component acquiring a consumer outside maestro — it earns a repository and moves.
