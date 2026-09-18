# ADR-0006 · Identity stays identity-service, not Cognito

**Status:** accepted · 2026-09-18

## Context

Moving to AWS ([ADR-0002](0002-serverless-aws-is-the-substrate.md)) raises the question of Cognito. identity-service exists, is public, and is already the only required dependency of every component.

## Decision

Authentication stays **identity-service**, deployed on Lambda, one realm per tenant deployment. Cognito is not adopted.

## Consequences

- Agent principals (many actors per credential, each act with its own accountable human and oversight level) and delegated administration (an advisor acting in twelve tenants under one login) are modelled in maestro's principal registry over identity-service's pool. Cognito's static claims cannot express either.
- No maestro record stores an identity provider's subject; the registry's binding rows are what a migration re-points.

## What would reopen it

Nothing about exit — the reasons were never about exit. A tenant mandate for a specific IdP is handled by federation into identity-service, not by replacing it.
