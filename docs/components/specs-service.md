# specs-service

**Repository:** [`fps4/maestro-specs`](https://github.com/fps4/maestro-specs) · **Status:** built · **Design:** `docs/design/architecture.md` and ADR-0001–0018 in that repository

What was agreed: artifacts drafted by anyone, versioned immutably, decided at gates by a named human, with questions, pinned links and a packet the decider can read in one sitting. Types, gates and lifecycles are configuration. This page says what the MVP uses and how it deploys; the design is in its own repository.

## What the MVP uses it for

| Artifact type | Gate | Decider | Raised by |
|---|---|---|---|
| `cause_analysis` | `rca_review` | the operations owner | an RCA run (UC1) |
| `intake_assessment` | `intake` | the sponsor | a person, onboarding an application |
| `specification` (an application's) | `specification` | the owner | a person or an agent |
| `change_record` | `release` | the owner | a production deploy of a high-tier application |

All four are workspace configuration — a type with facets and body blocks, a gate with its requirements and `accepts_on` outcome. No code. They are the demo workspace the repository ships (`config/workspaces/aannemer-x.yaml`, since 2026-09-18); a tenant's own definition lives in its configuration repository.

## What it already does that the MVP relies on

- **Drafts are mutable, versions are immutable**; a version is proposed to a gate with its digest.
- **Agents author and propose; only a named human decides**, and no MCP tool records a decision.
- **The decision page** — one column, the packet: the document, facets, what changed since the last version, checks, open questions, who decides, consequences of each outcome in plain language.
- **Questions on a version**; a gate may require all resolved.
- **Pinned links**: an accepted version freezes what it rests on.
- **The evaluator port** with a built-in floor (the type's own facet schema) and an HTTP adapter.
- **One document**: front matter for facets, Markdown body with typed blocks; the same file round-trips through the console, the CLI (`specs propose | packet | decide | withdraw`) and the GitHub Action (propose from a PR; never decide in CI).
- **Labels not identifiers**: every id has a human label from the definition, so a non-technical decider never sees `rca_review`.
- **Isolation by database per workspace**, a handle bound once.
- **A transactional outbox** — the record sink port.

## Deployment on AWS (M1)

| Piece | |
|---|---|
| API | Fastify → Lambda Web Adapter → HTTP API Gateway |
| Console | Next.js → OpenNext → Lambda + CloudFront, through [`console/terraform`](../../console/README.md) — built per tenant, `NEXT_PUBLIC_*` at build |
| Database | Atlas Flex, one database per workspace |
| Object storage | S3 (attachments, body overflow) |
| Record sink | outbox holding the spine's envelope, built at the act (`maestro-specs` ADR-0019) → the spine's relay, as a scheduled Lambda → the archive and the FIFO topic |
| Evaluator | HTTP adapter; `${VAR}` resolved from the environment |
| Notifier | SES; Slack webhook |
| MCP | stateless HTTP per request — Lambda-shaped already |

Configuration comes from `fps4/maestro-config-<tenant>/workspaces/*.yaml`. The repository's own pipeline deploys the demo tenant only.

## Changes the MVP asks of it

| Change | Milestone | Size |
|---|---|---|
| Terraform module; the relay as a scheduled Lambda; S3 adapter for object storage | M1 | small |
| Today reads work-service and agent-service alongside its own decisions and questions | M2–M3 | small, in the console |
| Move the DoD gate to GitHub-hosted runners (the self-hosted deployment configuration is already removed) | M1 | small |

Nothing else. The OpenSpec block shape and the external reader role are [post-MVP](../beyond-mvp.md).
