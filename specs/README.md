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
| **maestro** (governed application platform) | Opportunity → Business case → Specification; Intake assessment | Explore, Assess, specification, release |
| **maestro v1** (agentic delivery platform, retired) | Charter → Functional spec → Technical design + tasks | Functional, technical design, technical merge |

**Naming.** *maestro* is the governed application platform whose design lives in
[`../maestro`](../maestro). *maestro v1* is the first iteration of that project — an agentic delivery
platform, retired, its code being deleted — and it stays here because it is the second consumer that
shaped the model. Earlier revisions of this repository called the first *adel* and the second
*maestro*; that vocabulary is gone.

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
maestro-specs/
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
Workspace                  the confidentiality boundary. maestro maps a tenant; maestro v1 its organisation
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
standalone `mongod` is not supported, including in development. The compose stack provides one.

```bash
make up        # mongo replica set, MinIO, api, web — api on :8020, console on :8021
make apply     # load config/workspaces/catalogue.yaml and maestro-platform.yaml
make test      # after `make mongo`
```

`make help` lists the rest. Configuration is environment only — `api/src/config.ts` is the schema and
every value has a local default:

- `AUTH_MODE` — `dev` (default, no identity provider needed) or `jwks`, with `AUTH_JWKS_URL`,
  `AUTH_ISSUER` and `AUTH_AUDIENCE` pointing at your `identity-service` deployment
- `MONGO_URI`, `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_CONTROL_DB`, `MONGO_DB_PREFIX`
- `S3_ENDPOINT`, `S3_BUCKET` — MinIO locally
- `RECORD_SINK` — `local` (default) or `http` with `RECORD_SINK_URL`
- `EVALUATOR_BASE` — optional; without it, evaluations are recorded but never requested

Against a real `identity-service`, register the service as an Application with the role catalogue
(`author`, `reviewer`, `workspace_admin`, `auditor`), a public client for the console, and a
client-credentials principal for agents — `identity-service/config/seed.mstr-specs.yaml` is the
structural seed the ds1 deployment uses. The deploy itself is `config/ds1/` plus
`.github/workflows/deploy-ds1.yml`.

Health at `GET /health`.

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
