# ADR-0007 · Tenant = deployment by default; workspace isolation stays available inside one

**Status:** accepted · 2026-09-18

## Context

Every component isolates by workspace — a database per workspace, a handle bound once per request — and cannot tell a shared deployment from a dedicated one. The earlier default was a shared deployment with a database per tenant, because a deployment per tenant on Kubernetes, RDS and a broker had a cost floor a small tenant could not carry. On serverless the floor is close to zero.

## Decision

**A tenant is one deployment**: one CDK stack, one identity realm, one archive prefix, one database cluster. A tenant with several estates uses several workspaces inside its deployment. A shared deployment serving several tenants remains possible and is not the default.

## Consequences

- Isolation is physical by default; the adversarial isolation test stays a build gate for the workspace level.
- Tenant configuration is one repository per tenant ([ADR-0010](0010-tenant-configuration-is-one-private-repository-per-tenant.md)).
- Because no record stores an identity provider's subject, the choice is reversible per tenant.

## What would reopen it

Nothing structural; a tenant may be moved between the two levels at any time.
