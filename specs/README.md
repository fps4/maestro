# specs-service

A **governed specification service** — write specifications, version them, and put them through gates
a named human has to pass. It has its own domain, its own console, and single sign-on through
[`identity-service`](../identity-service), so it is a product on its own; it is also the component
of [maestro](../maestro) that holds what was agreed.

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
| **maestro** (an ops engine for running applications) | Cause analysis; intake assessment; specification; change record | RCA review, intake, specification, release |
| **maestro v1** (agentic delivery platform, retired) | Charter → Functional spec → Technical design + tasks | Functional, technical design, technical merge |

**Naming.** *maestro* is an ops engine for running applications; its design lives in
[`../maestro`](../maestro), and [`docs/components/specs-service.md`](../maestro/docs/components/specs-service.md)
there is the page about this service. *maestro v1* is the first iteration of that project — an
agentic delivery platform, retired — and it stays here because it is the second consumer that shaped
the model. Earlier revisions of this repository called the first *adel* and the second *maestro*;
that vocabulary is gone. (Until 2026-09-18 maestro was designed as a governed application platform
with a different chain; the chain changed and no code did — see the demo definition.)

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

And a draft is **one document**: markdown with front-matter, where a table under a declared heading
*is* a facet. The gate reads structure; the author writes prose; the same bytes are both
([ADR-0017](docs/design/decisions/0017-one-document.md)).

## What it is not

- **Not a wiki.** Artifacts have typed links, not a page tree. The editor exists to produce a version
  a gate will decide on; authoring features that do not serve a gated artifact are out of scope. The
  one thing attached to a version besides a decision is a **question** — a fact about it, never a
  change to it ([ADR-0014](docs/design/decisions/0014-questions-on-a-version.md)).
- **Not a policy engine.** It calls an evaluator and records the verdict. Gates read structured
  facets and **never** the body
  ([ADR-0004](docs/design/decisions/0004-facets-are-evaluated-bodies-are-read.md)).
- **Not a workflow engine.** It holds lifecycle state and decisions. Orchestration is yours.
- **Not an audit substrate — unless you want it to be.** Every state change is emitted to a record
  sink. Point that at a durable spine and the spine is authoritative, and this database becomes a
  projection. In maestro that spine is an S3 archive fed by a relay from the outbox.

## Project Layout

```
maestro-specs/
 ├── api/              # REST API + MCP server. domain/ is pure; a lint rule keeps it that way
 ├── web/              # The console (Next.js) — author, review, decide, read the standards
 ├── config/workspaces/  # THE domain model, as data: the demo tenant (aannemer-x) and the catalogue
 ├── infra/docker/     # Dockerfiles + compose — the local loop and CI, not a deployment target
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
make apply     # load config/workspaces/catalogue.yaml and aannemer-x.yaml
make test      # after `make mongo`
```

`make help` lists the rest. Configuration is environment only — `api/src/config.ts` is the schema and
every value has a local default:

- `AUTH_MODE` — `dev` (default, no identity provider needed) or `jwks`, with `AUTH_JWKS_URL`,
  `AUTH_ISSUER` and `AUTH_AUDIENCE` pointing at your `identity-service` deployment
- `MONGO_URI`, `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_CONTROL_DB`, `MONGO_DB_PREFIX`
- `S3_ENDPOINT`, `S3_BUCKET` — MinIO locally
- `RECORD_SINK` — `local` (default): the outbox relays to a filesystem archive at `RECORD_ARCHIVE_DIR` (`./archive`) — the laptop's spine, readable by `spine-verify` with everything off; `s3`: maestro's spine, with `ARCHIVE_BUCKET`, `ARCHIVE_PREFIX` and `EVENTS_TOPIC_ARN` as the spine's Terraform module outputs them; `off`: write the outbox, relay nothing (the scheduled relay Lambda drains it)
- `EVALUATOR_BASE` — optional; without it, evaluations are recorded but never requested

Against a real `identity-service`, register the service as an Application with the role catalogue
(`author`, `reviewer`, `workspace_admin`, `auditor`), a public client for the console, and a
client-credentials principal for agents — `identity-service/config/seed.mstr-specs.yaml` is the
structural seed a deployment registers.

Deployment is serverless AWS as a Terraform module this repository will ship (`terraform/`), composed
by a tenant's private configuration repository (`fps4/maestro-config-<tenant>` —
[`../maestro/docs/tenancy-and-config.md`](../maestro/docs/tenancy-and-config.md)) and applied by the
tenant's own pipeline; maestro's ADR-0016 and ADR-0017. The module is M1 of maestro's roadmap. Nothing
in this repository deploys anywhere — its CI runs on GitHub-hosted runners and ends at the gate — and
the earlier self-hosted deployment is gone.

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
| `GET /v1/gates/:gate/:id/:n/packet` | The decider's packet: everything a person needs to decide, in plain language, in one call |
| `…/versions/:n/questions` | Ask a question of a version; answer one; a human closes it. Never a mutation |
| `GET /v1/drafts/:id/readiness` | What a draft still needs, in the schema's words, before propose |
| `GET`/`PUT /v1/drafts/:id/document` | The draft as one document; save it as one, facets derived |
| `GET …/versions/:n/document` | A version as one document, composed from the record |
| `POST …/versions/:n/evaluate` | Re-run the evaluations a gate requires; builtin or endpoint, per the definition |
| `POST …/versions/:n/withdraw` | The proposer takes a proposed version back, before any decision |
| `POST /v1/gates/:gate/decisions` | The gate's declared outcomes. Attributed, human-only |
| `GET /v1/workspaces/:id/register` | Everything in flight, with lifecycle state |
| `GET /v1/search` | Facets and bodies, within one workspace |
| `GET /v1/export/:workspace` | The full chain of record, portable |

**MCP** exposes reads, the document (read and save), draft writes, readiness, propose,
evaluations, the decider's packet, and questions (list, ask, answer) — so agents author through it and can explain a pending decision to
the human accountable for it — and **no decision surface at all**, and no way to close a question.

## From a file next to the code

```bash
cd api && SPECS_URL=… SPECS_TOKEN=… npm run specs -- propose ../../my-service/docs/spec.md --workspace aannemer-x
```

A markdown file with YAML front-matter is a complete authoring surface, and
[`.github/actions/specs`](.github/actions/specs/action.yml) proposes it from a pull request and
comments the decider's packet. Nothing in CI decides — see
[`docs/guides/git-native-specs.md`](docs/guides/git-native-specs.md).

## Documentation

Two planes: a **Docs** plane you read and a **Delivery** plane you track. Start at
[`docs/README.md`](docs/README.md); the design is
[`docs/design/architecture.md`](docs/design/architecture.md).

## Status

**Aligned with the maestro MVP (2026-09-18).** maestro was re-scoped to an ops engine and its design
rewritten; this service is one of its components, unchanged in model and code. The demo workspace
now carries the four types the MVP uses — `cause_analysis` at `rca_review`, `intake_assessment` at
`intake`, `specification`, `change_record` at `release` — and the earlier chain is the integration
fixture. The console shows the catalogue only for a workspace that declares `catalogue_refs`; the
standards surface waits for maestro's regulated branch. The self-hosted deployment configuration is
removed; the CDK stack is M1.

**Second build (2026-09-15).** The first build made the record trustworthy; this one made it
usable by the three kinds of reader it has — a person who decides, a person who writes next to the
code, and an agent — without weakening the record. ADR-0012 to ADR-0017: labels instead of
identifiers, the decision page built from one packet shared with MCP, questions on a version, an
evaluator port with a floor and an outbound call, readiness before propose, the `specs` CLI and a
proposing GitHub Action, and one document from which the facets are derived. Two defects found on
the way and closed: the catalogue's `publish` outcome would have recorded a standard as `rejected`,
and a specification with no pinned link could be accepted. 178 tests pass, including the loop
through HTTP and through the CLI, the adversarial cross-workspace read, and the MCP surface with
no way to decide.

**Not built yet:** the TypeScript SDK, export, and redaction. The catalogue holds no
real standards — the pack registry does not exist, and a fixture presented as a standard would be
worse than an empty shelf.

## Licence

MIT — see [LICENSE](LICENSE). The tree holds code, the design and one fictional tenant; a real tenant's configuration lives in its own private repository, and CI fails on anything that identifies one (`scripts/check-public.sh`).
