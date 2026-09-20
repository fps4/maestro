# identity-service

**Repository:** [`fps4/identity-service`](https://github.com/fps4/identity-service) · **Status:** built, public, MIT · **Decision:** [ADR-0006](../decisions/0006-identity-stays-identity-service.md)

Who is acting. A self-hosted OAuth 2.0 / OIDC provider — one deployment is one realm with one user pool — with a headless SDK, a drop-in React login, an admin plane over HTTP and MCP, and an operator console. It owns **authentication**; every component keeps its own **authorisation**.

## What maestro adds: the principal registry

No maestro record stores an identity provider's subject. Every component resolves a token to a **maestro principal** through a registry it embeds:

```yaml
principal:
  id:        prn-h-jdekker           # the only id that reaches any record
  kind:      human | agent | workload
  bindings:
    - issuer:   https://id.<tenant-domain>
      subject:  4c1e…                # identity-service's sub
      bound_at: 2026-09-18
      active:   true
  display:   Jan Dekker
  status:    active | suspended | retired
```

Move a tenant between deployments and a binding row is re-pointed; the archive is untouched. `kind` is what lets the spine reject an agent in `accountable`.

## Three kinds of principal

| Kind | Authenticates as | Recorded as |
|---|---|---|
| **human** | a user in the pool, via the console or the CLI | `accountable` and/or `acting` |
| **agent** | a client credential per runner, mapped to an agent principal per run | `acting`; never `accountable` |
| **workload** | a client credential per deployed service (a relay, an intake adapter) | `acting` on service-to-service writes |

An agent runtime is bound to the seats it may act on; a component verifies the seat occupancy at the time of the act rather than trusting the token. Oversight level is **never a token claim** — it is read from seat occupancy at the act, so demotion takes effect on the next act and not on the next token refresh.

## Delegated administration

An advisor who operates in several tenants authenticates once, carries an explicit tenant context per request, and every record names the acting principal, the tenant, and — where they are not a member in their own right — the delegation that authorised it. On the record, not in the token; an auditor reads events, not expired JWTs.

## Deployment on AWS (M1)

| Piece | |
|---|---|
| Service | Express → Lambda Web Adapter → HTTP API Gateway; one realm per tenant deployment |
| Console | OpenNext → Lambda + CloudFront, through [`console/terraform`](../../console/README.md) — built per tenant, `NEXT_PUBLIC_*` at build |
| Database | Atlas Flex |
| Seed | `config/seed.yaml` stays gitignored; per-tenant seed comes from `maestro-config-<tenant>` |
| Backups | the existing encrypted backup job as a scheduled Lambda to S3 |

## Changes the MVP asks of it

| Change | Milestone | Size |
|---|---|---|
| Terraform module | M1 | small |
| Principal lifecycle events (`PrincipalRegistered`, `PrincipalSuspended`, `SeatOccupancyChanged`) emitted by the registry to the spine | M1 | small, in the registry library shared by components |
| An enumeration endpoint for principals in a realm, for the registry to reconcile | M2 | small |

The Slack↔principal link and the external population are [post-MVP](../beyond-mvp.md).
