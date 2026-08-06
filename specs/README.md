# specs-service

A **governed specification service** — write specifications, version them, and put them through gates
a named human has to pass. It has its own domain, its own console, and single sign-on through
[`identity-service`](../identity-service), so it is a product on its own and composable under a
larger platform later.

Humans and agents author in it. What it guarantees is that **an approval attaches to bytes that
cannot subsequently change**, that the approver is a named human and never an agent, and that the
whole chain exports into something meaningful with the service switched off.

Its only required dependency is `identity-service`. Everything else — a durable record spine, an
evaluator, a notifier — is an **outbound port with a working local default**
([ADR-0002](docs/design/decisions/0002-identity-service-is-the-only-dependency.md)).

## What it is for

Two consumers shaped the model, and the generic core is their overlap:

| | Artifacts | Gates |
|---|---|---|
| **adel** (governed delivery platform) | Opportunity → Business case → Specification; Intake assessment | Explore, Assess, specification, release |
| **maestro** (agentic delivery platform) | Charter → Functional spec → Technical design + tasks | Functional, technical design, technical merge |

Neither vocabulary is in the code. **Artifact types, links, gates and lifecycles are configuration**
([ADR-0001](docs/design/decisions/0001-artifact-types-are-configuration.md)) — a workspace declares
its own and the service enforces what those declarations imply.

## The one idea

```
Draft   ── MUTABLE ──▶  edit freely, by humans and agents, autosaved
   │
   │  propose  (snapshot)
   ▼
Version ── IMMUTABLE ──▶  no update operation exists. Superseded, never edited
   │
   │  gate decision  (a named human, always)
   ▼
Accepted ──▶ pinned links freeze to it; the record is portable
```

Editing is continuous and messy; a record is neither. Keeping them as separate entities is what lets
a real editor and a trustworthy approval live in one service
([ADR-0003](docs/design/decisions/0003-immutable-versions-mutable-drafts.md)).

## What it is not

- **Not a wiki.** Artifacts have typed links, not a page tree. The editor exists to produce a version
  a gate will decide on; authoring features that do not serve a gated artifact are out of scope.
- **Not a policy engine.** It calls an evaluator and records the verdict. Gates read structured
  facets and **never** the body
  ([ADR-0004](docs/design/decisions/0004-facets-are-evaluated-bodies-are-read.md)).
- **Not a workflow engine.** It holds lifecycle state and decisions. Orchestration is yours.
- **Not an audit substrate — unless you want it to be.** Every state change is emitted to a record
  sink. Point that at a durable spine and the spine is authoritative, and this database becomes a
  projection.

## Project Layout

```
mstr-specs/
 ├── api/              # REST API + MCP server. domain/ is pure; a lint rule keeps it that way
 ├── web/              # The console (Next.js) — author, review, decide, read the standards
 ├── config/
 │    ├── workspaces/  # THE domain model, as data: types, links, gates, lifecycles, schemas
 │    └── ds1/         # Deploy configuration, non-secret values only
 ├── infra/docker/     # Dockerfiles + compose (MongoDB replica set, MinIO)
 └── docs/             # design/ · design/ui/ (the approved console design) · decisions/
```

## Core model

```
Workspace                  the confidentiality boundary. adel maps a tenant; maestro its organisation
  └── Artifact             a lineage, of a declared type
        ├── Draft          mutable. Where authoring happens
        └── Version        immutable snapshot of a draft
              ├── facets   typed, schema-validated, evaluable, with provenance
              ├── body     authored content. Rendered, diffed, searched — never evaluated
              ├── attachments   images, PDFs, files. Content-addressed in object storage
              └── links    typed edges; at most one pinned to a version at acceptance
Gate → Decision            immutable, attributed to a named human. The service never decides
```

## Quick Start

Requires a **MongoDB replica set** — the transactional outbox needs multi-document transactions, so a
standalone `mongod` is not supported, including in development.

1. Copy `service/.env.example` to `.env`:
   - `MONGO_URI`, `MONGO_CONTROL_DB`
   - `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI` — your `identity-service` deployment
   - `S3_ENDPOINT`, `S3_BUCKET` — MinIO locally
   - `RECORD_SINK` — `local` (default) or `kafka`
2. Register the service as an Application in `identity-service`, with the role catalogue
   (`author`, `reviewer`, `workspace_admin`, `auditor`), redirect URIs for the console's domain, and
   a client-credentials principal for agents.
3. Apply a workspace definition:
   ```bash
   npm run workspace:apply -- config/workspace.yaml
   ```
4. Run:
   ```bash
   docker compose -f docker/compose.yaml -f docker/compose.dev.yaml up --build
   ```

Service on `PORT` (default `7310`), console on `3010`. Health at `GET /health`.

## API Summary

Every write produces a draft or a **proposed** version. Only a gate decision accepts
([ADR-0005](docs/design/decisions/0005-agents-may-author-never-decide.md)).

| | |
|---|---|
| `POST /v1/drafts` · `PATCH /v1/drafts/:id` | Create and edit. Optimistic concurrency on `revision` |
| `POST /v1/drafts/:id/propose` | Snapshot into an immutable version |
| `GET /v1/artifacts/:id/versions/:n` | Read a version, rendered or raw |
| `GET /v1/artifacts/:id/diff?from=&to=` | Facet diff, link diff, and a body diff per format |
| `GET /v1/artifacts/:id/lineage` | Both directions, across links |
| `POST /v1/attachments` | Upload. Content-addressed and deduplicated |
| `POST /v1/gates/:gate/decisions` | approve / request-changes / reject. Attributed, human-only |
| `GET /v1/workspaces/:id/register` | Everything in flight, with lifecycle state |
| `GET /v1/search` | Facets and bodies, within one workspace |
| `GET /v1/export/:workspace` | The full chain of record, portable |

**MCP** exposes reads, draft writes and propose — so agents author through it — and **no decision
surface at all**.

## Documentation

Two planes: a **Docs** plane you read and a **Delivery** plane you track. Start at
[`docs/README.md`](docs/README.md); the design is
[`docs/design/architecture.md`](docs/design/architecture.md).

## Status

**First build.** Steps 1–9 of [`architecture.md`](docs/design/architecture.md) §12 are implemented,
plus the MCP surface. 145 tests pass, including the loop through HTTP and the adversarial
cross-workspace read.

**Not built yet:** the evaluator port's outbound call (verdicts are recorded through the API but the
service does not yet call out), the TypeScript SDK, export, and redaction. The catalogue holds no
real standards — the pack registry does not exist, and a fixture presented as a standard would be
worse than an empty shelf.
