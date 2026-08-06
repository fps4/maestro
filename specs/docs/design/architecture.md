---
title: specs-service architecture
status: draft
last_updated: 2026-08-04
owners: [architect]
related:
  - ./decisions/0001-artifact-types-are-configuration.md
  - ./decisions/0002-identity-service-is-the-only-dependency.md
  - ./decisions/0003-immutable-versions-mutable-drafts.md
  - ./decisions/0004-facets-are-evaluated-bodies-are-read.md
  - ./decisions/0005-agents-may-author-never-decide.md
  - ./decisions/0006-workspace-isolation-by-database.md
  - ./decisions/0007-mongodb-with-inline-bodies.md
---

# specs-service — architecture

**Status:** Draft v0.2
**Scope:** The whole product. Model, authoring, rendering, configuration, ports, isolation,
interfaces, storage, build order.
**Shape:** A full end-to-end service with its own domain, its own console, and SSO through
`identity-service` — usable on its own, and later composable under a larger platform.

---

## 1. The problem this solves

A large class of processes share one shape and re-implement it every time: an artifact is drafted,
reviewed, and approved by someone accountable, and later work must be traceable back to the approved
version. Delivery methods, compliance workflows, architecture review, editorial pipelines, change
advisory.

Each re-implementation gets the same three things wrong. **Approval is advisory** because the store
allows an edit after the fact. **Attribution is weak** because "approved by" is a string. And **the
trail is not portable**, because versions live in one tool's database with no export that means
anything to an auditor.

specs-service fixes those three, and provides enough authoring around them to be a product rather
than a component.

### 1.1 Derived from two consumers, not one

Extraction from a single caller produces that caller's implementation with a package boundary around
it. The model here is the **overlap** between two systems that already exist:

| Concept | adel | maestro |
|---|---|---|
| Isolation boundary | Tenant | The organisation |
| Artifact chain | Opportunity → Business case → Specification | Charter → Functional spec → Technical design + tasks |
| Evaluable units | Sufficiency and conformance standards | EARS acceptance criteria `AC-N`, NFRs |
| Unit attributes | Facets with provenance | `priority`, `verify`, `source`, `rationale` |
| Gates | Explore, Assess, specification, release | Functional, technical design, technical merge |
| Gate owner resolution | Role in a tenant, per application | `config/reviewers.yaml` routing matrix |
| Outcomes | Five recorded Explore outcomes | approve / request-changes / reject |
| Agent posture | Proposes; a named human decides | Produces artifacts; never decides a gate |
| Proportionality | Consequence class | Risk tier relaxing human review |
| Pre-gate assist | Facet extraction, then human confirmation | The clarify pass |

**Every row is the same mechanism with different words.** That is the product; the words are
configuration (ADR-0001).

---

## 2. Model

```
Workspace                    the confidentiality and ownership boundary
  └── Artifact               a lineage, of a declared type
        ├── Draft            MUTABLE. Where authoring happens, by humans and agents
        └── Version          IMMUTABLE. A snapshot of a draft, proposed for a decision
              ├── facets     typed, schema-validated, evaluable, with provenance
              ├── body       authored content in a declared format. Rendered, diffed, searched
              ├── attachments  images, PDFs and files, content-addressed in object storage
              └── links      typed edges; at most one pinned at acceptance
Gate
  └── Decision               immutable, attributed to a named human principal
Lifecycle
  └── Phase                  declared states and legal transitions; a transition is a decision
```

**The draft/version split is the centre of the design** (ADR-0003). Editing is continuous, messy, and
collaborative; a record is none of those things. Making them the same object forces a choice between
an unusable editor and a worthless record. Keeping them apart gives both.

### 2.1 Workspace

The isolation boundary (ADR-0006). adel maps a tenant onto it; maestro maps its organisation.
Nothing crosses a workspace — not a link, not a lineage, not a query.

**A workspace is logical, never physical.** Which database or deployment it lives in is a choice
(§6), and the workspace id never encodes it. If it did, moving a workspace would change every export
and every pinned reference.

Choose the altitude by asking: *what must never leak, and what must be queryable together?* adel
answers "tenant", because the portfolio queries across every application within one. maestro answers
"the organisation", because a charter is shared across products.

### 2.2 Draft — where authoring happens

```yaml
draft:
  workspace:   ws-aannemer-x
  artifact:    art-4417          # or absent, for a new lineage
  type:        functional_spec
  revision:    23                # optimistic concurrency token; bumped on every save
  facets:      { … }             # same schema as a version, validated on save but not enforced
  body:        "## Scope\n…"     # the live text
  attachments: [ … ]
  contributors:
    - { principal: prn-7Q2K…, kind: human, first: …, last: … }
    - { principal: prn-agent-3, kind: agent, first: …, last: … }
  based_on:    7                 # the version this draft started from, if any
```

- **Saves are ordinary writes.** Autosave, partial facets, an empty body — a draft has no integrity
  obligations because it is not a record.
- **Concurrency is optimistic.** A save carrying a stale `revision` is refused with the current
  state. Real-time collaborative editing is deliberately out of scope for v1 (§11).
- **Contributors accumulate**, and carry onto the version. *"An agent drafted this section and a
  human proposed it"* is recorded rather than inferred.
- **Facets are validated on save and not enforced.** A draft may be invalid; a proposal may not.

### 2.3 Version — the record

Proposing snapshots a draft into an immutable version.

```yaml
version:
  workspace:    ws-aannemer-x
  artifact:     art-4417
  type:         functional_spec
  ordinal:      8
  state:        proposed | accepted | superseded | rejected | withdrawn | expired
  digest:       sha256:9f2c…       # over envelope + facets + body + attachment digests
  supersedes:   7
  proposed_by:  prn-7Q2K…          # the acting principal
  contributors: [ … ]              # carried from the draft
  proposed_at:  2026-08-04T09:14:22Z
```

**There is no update operation on a version** (ADR-0003). A change is a new draft, then a new
version. `expired` exists for types declaring a verification interval — an artifact describing
something outside this service can rot silently, and *expired* is deliberately a harder word than
*stale*.

### 2.4 Facets and body — different jobs

Every type declares a **facet schema** (JSON Schema) and a **body format** (ADR-0004).

```yaml
facets:
  acceptance_criteria:
    - { id: AC-1, text: "…", priority: must, verify: test, source: PRD-12 }
  scope: { in: […], out: […] }
provenance:
  acceptance_criteria: { source: extracted, by: prn-agent-3, confirmed_by: prn-7Q2K… }
  scope:               { source: declared,  by: prn-7Q2K… }
body:
  format: markdown/v1
  content: "## Scope\n\nThe system shall…\n\n![site plan](attachment:att-91)"
```

**Facets are what a machine reads. The body is what a person reads.** The service renders, diffs and
searches the body; it never *evaluates* it, and no gate requirement may depend on it. That single
rule is what lets a body format change without invalidating a record, and lets prose stay prose.

**Provenance is per field** — `declared` (a human wrote it), `extracted` (an agent proposed it),
`reconstructed` (recovered after the fact). **Only confirmed facets are evaluated or gated**: an
agent may extract, and its extraction cannot reach a gate unconfirmed. That is what makes generous
agent authority safe.

### 2.5 Attachments

Images, PDFs, spreadsheets, diagrams — everything that is not the body.

```yaml
attachments:
  - { id: att-91, filename: "site-plan.pdf", media_type: application/pdf,
      size: 2481203, digest: sha256:4c1e…, key: ws-aannemer-x/att/4c1e… }
```

- **Content-addressed and deduplicated.** An unchanged attachment across ten versions is stored once.
- **Referenced from the body** as `attachment:<id>`, which the renderer resolves to a short-lived
  signed URL. The body never contains a raw storage URL.
- **Snapshotted at propose.** A version's attachment set is fixed; a new attachment is a new version.

### 2.6 Links, and the pin

Links are typed, directional, many-to-many, and declared per artifact type — `derives_from`,
`addresses`, `implements`.

**Exactly one link per type may be declared `pinned`.** A pinned link resolves to a specific
*version* at acceptance and freezes. Everything else points at a lineage and follows it.

That distinction is what makes the trail hold: a technical design pinned to functional spec `v4`
still reads against `v4` after the spec is superseded eleven times.

### 2.7 Gates and decisions

A gate is declared, not coded (ADR-0001):

```yaml
gates:
  - id: functional
    decides_on: functional_spec
    owner:   { resolver: role, role: functional_reviewer }
    outcomes: [approve, request_changes, reject]
    blocking: true
    requires:
      confirmed_facets: true
      evaluations: [ears_lint]
    separation_of_duties: exclude_proposer
    attribution_profile: default
```

A **decision** is immutable, attributed, and carries every evaluation result in force at the time.
The service resolves who *may* decide and refuses everyone else. It never decides (ADR-0005).

`separation_of_duties: exclude_proposer` refuses a decision from the principal who proposed the
version. It is declared per gate because small organisations legitimately cannot honour it — in which
case the exemption is visible rather than assumed.

### 2.8 Attribution profile

The one place consumer vocabulary would otherwise reach a decision record:

```yaml
attribution_profiles:
  default:
    required: [accountable, acting]
    rules:
      accountable: { must_resolve_to: principal, kind: human }
      acting:      { must_resolve_to: principal }
    optional: [seat, oversight_level, consequence_class]
```

adel populates `seat` and `oversight_level`; maestro does not. **The generic rule is that a named
human is answerable and an agent can never occupy that field** — enforced at write time. A decision
missing a required field is rejected, and the rejection is itself recorded.

---

## 3. Authoring, rendering, and agents

New in v0.2, and the reason this is a product rather than a component.

### 3.1 The editing loop

```
open draft ──▶ edit (human or agent) ──▶ save (revision++) ──▶ propose ──▶ decide
     ▲                                                            │
     └──────────────── request_changes reopens a draft ───────────┘
```

A `request_changes` outcome creates a **new draft based on the rejected version**, carrying the
reviewer's comments. The rejected version stays in the record — the loop is visible, not erased.

### 3.2 Rendering

The service renders bodies server-side, per format:

| Format | Renders to | Notes |
|---|---|---|
| `markdown/v1` | Sanitised HTML | CommonMark + tables; `attachment:` references resolved to signed URLs |
| `text/v1` | Escaped preformatted | The always-available fallback |

**Sanitisation is not optional.** Bodies are authored by humans and agents and rendered to other
users in the same workspace; unsanitised HTML is stored XSS against exactly the people the record is
meant to protect. Render server-side with a strict allow-list, never `dangerouslySetInnerHTML` over
raw content.

**Diff renders per format too.** Facet diff is structural and available for every type; body diff is
per format, with a line differ as the default. A body diff a reviewer cannot read is a defect in the
format — the bar is whether they can confirm their intent was captured.

### 3.3 Agents author; they never decide

Agents edit drafts and propose versions through the same API as humans, as attributed principals of
kind `agent`. What they cannot do is decide (ADR-0005). Two consequences:

- **Agent authority can be generous** — draft freely, extract facets, propose. The constraint sits at
  the point of consequence rather than spread across everything an agent touches.
- **MCP carries the authoring surface**, because agent authoring is a first-class use case. It
  exposes reads, draft writes, and propose. It exposes **no decision endpoint**, and no MCP tool can
  reach one.

### 3.4 Search

Bodies and facets are indexed per workspace. MongoDB text indexes cover v1; the index lives in the
workspace's own database, so search cannot cross the boundary by construction (§6).

---

## 4. Configuration is the product

A workspace definition is data, versioned like anything else. Applying a new definition is a
governed change: existing versions were written against the definition in force at the time, and
that definition version is stamped on them.

```yaml
workspace: maestro-core
types:
  - id: functional_spec
    facet_schema: ./schemas/functional-spec.json
    body_format: markdown/v1
    attachments: { max_size: 25MB, media_types: [image/*, application/pdf] }
    links:
      - { id: derives_from, to: charter }
      - { id: addresses,    to: work_item, pinned: true }
lifecycle: { … }
gates: [ … ]
attribution_profiles: [ … ]
```

**Schema changes are additive-only against accepted versions.** A breaking facet change creates a new
*type*, not a new version of one — history cannot be migrated, so it must stay readable under the
schema it was written against.

---

## 5. Ports — why this runs alone

`identity-service` is the only required runtime dependency (ADR-0002). Everything else is an outbound
port with a working local default.

| Port | Local default | Production adapter | Consumer |
|---|---|---|---|
| **Record sink** | Outbox collection, relayed to a log | Kafka, or an external durable spine | adel points this at its record spine, which becomes authoritative |
| **Evaluator** | None — evaluations optional | HTTP callout; result recorded on the version | adel: standards engine. maestro: spec-lint, EARS check |
| **Notifier** | Log line | HTTP webhook; notification service | Gate awaiting a decision; changes requested |
| **Object storage** | MinIO | S3 | Attachments, and body overflow |
| **Principal directory** | — | `identity-service` **(required)** | Authentication and attribution |

**The record sink is the seam between product and platform component.** Every state change — draft
proposed, decision recorded, link pinned, body redacted — is emitted as an attributed event,
transactionally with the change via an outbox. Run with the default and this database is the record.
Point it at a durable spine and **the spine becomes authoritative and this database becomes a
projection.** One configuration value.

---

## 6. Isolation

**Database per workspace** (ADR-0006). The rule, stated once:

> A workspace-scoped handle is acquired once per request, and no query names a workspace.

```ts
// The only way to reach a store. No repository accepts a raw client or a workspace id.
type WorkspaceHandle = { readonly db: Db; readonly workspace: WorkspaceId };
```

**This fails closed, and that is the argument.** A forgotten `WHERE tenant_id` returns every tenant's
rows. A forgotten handle has no database to query — it does not compile, and at worst it errors. The
failure mode of the mistake is what matters, not the elegance of the mechanism.

Three deployment levels, and the code cannot tell them apart:

| Level | Mechanism | Isolation |
|---|---|---|
| **Shared** | One MongoClient, database per workspace | Structural — resolved once, never filtered |
| **Dedicated database** | Per-workspace client and per-workspace Mongo user | Structural **and** authenticated |
| **Dedicated deployment** | One workspace configured | Physical |

Object storage mirrors it: prefix per workspace, and a prefix-scoped credential at the dedicated
levels.

**An adversarial isolation test is a build gate** — acquire workspace A's handle, attempt B's data,
assert failure. It belongs in the tier that proves the service works at all.

---

## 7. Identity, SSO, and the product surface

The service has its **own domain** and its **own console**, and authenticates through
`identity-service` so a user who is already signed in is not asked again.

### 7.1 Registration in identity-service

specs-service is one **Application** there, with:

- A **role catalogue** — `author`, `reviewer`, `workspace_admin`, `auditor` — stamped into the token
- **Credentials** under it: a public client for the console (authorization code + PKCE), a
  confidential client-credentials principal for service-to-service and agent runtimes
- **Redirect URIs and CORS origins** for its own domain

**SSO is transparent because the session is `identity-service`'s.** A user signed in for adel and
landing on specs-service's domain completes the authorization-code flow against an existing session
and never sees a login form. That works because both are Applications in one deployment over a
shared user pool — the property `identity-service`'s ADR-0018 exists to provide.

### 7.2 What each side owns

**Authentication is `identity-service`'s** — credentials, federation, token issuance, JWKS.
Consistent with its own ADR-0005: identity authority and Policy Information Point, never a Policy
Decision Point.

**Authorisation is ours**, and narrow: who may author in a workspace, and who may decide at a gate.
Gate ownership resolves through a declared resolver — role claim, explicit assignment, or a routing
table — which is how maestro's `reviewers.yaml` and adel's tenant roles become one mechanism.

**Principal ids are ours.** A registry maps `(issuer, subject) → principal id`, and only the local id
is written to a draft, version, decision, or export. An issuer's subject is minted per deployment;
move the identity deployment and every subject re-mints, against decisions retained for years. The
indirection costs one collection now and is unavailable later.

**Agents are principals of kind `agent`**, distinct from the credential they authenticate with and
from the human accountable for their work — which is what makes §2.8's rule enforceable.

### 7.3 Under an umbrella later

Nothing above changes when adel adopts it. adel becomes another Application in the same identity
deployment, links to or embeds specs-service's console, and points the record sink at its spine. The
service does not learn it has been absorbed.

---

## 8. Storage

**MongoDB, with bodies inline and blobs in object storage** (ADR-0007).

### 8.1 Collections

Per-workspace database:

| Collection | Holds |
|---|---|
| `artifacts` | Lineage metadata, current accepted ordinal |
| `drafts` | Mutable working copies |
| `versions` | Envelope, facets, **body inline**, attachment refs, links |
| `decisions` | Immutable gate decisions |
| `evaluations` | Verdicts recorded against versions |
| `memberships` | Who may author, who may decide |
| `outbox` | Pending record-sink emissions |

Control database: `workspaces`, `workspace_definitions`, `principals`.

### 8.2 Bodies inline, blobs outside

**The body lives in the version document.** A specification is tens of kilobytes; fetching a version
is one round trip, and rendering, diffing and searching need no second store.

- **Ceiling: 1 MB inline.** Well under MongoDB's 16 MB document limit, leaving room for facets and
  metadata. Beyond it the body overflows to object storage behind the same accessor — a reader cannot
  tell, and the ceiling is enforced at propose rather than discovered.
- **Attachments are always external**, content-addressed and deduplicated (§2.5).
- **Projections are mandatory on list queries.** Registers, search results and lineage must exclude
  the body. Inline bodies make the wrong query expensive, and this is the one operational discipline
  the choice demands.

### 8.3 Redaction — the single permitted mutation

Bodies inside version documents mean erasure cannot be a blob delete. So it is explicit:

**Redaction replaces the body content and the affected attachments, in place, and is recorded as a
`BodyRedacted` event.** The envelope, the digest, the decisions and the links all survive — the
record still proves *what was accepted* without retaining the content.

The digest no longer matches the stored body afterwards, **and that is the point**: the mismatch is
detectable, and the redaction event explains it. A mismatch with no event is corruption; a mismatch
with one is a lawful erasure. Silent deletion would be indistinguishable from tampering.

### 8.4 What MongoDB does not give us

Recorded rather than glossed. There are no foreign keys, so a pinned link pointing at a real version
is enforced in application code. There are no check constraints, so a legal state transition is
enforced in one code path rather than by the database. Both are accepted costs (ADR-0007), and the
compensating control is the record sink: an illegal transition is detectable after the fact because
every transition is emitted, and a divergence between the emitted stream and stored state is a
alertable condition.

Multi-document transactions require a **replica set** — the outbox is unsound without them, so a
standalone `mongod` is not a supported configuration, including in development.

---

## 9. Stack

TypeScript on Node 22 LTS, matching `identity-service`. Fastify with JSON-Schema-compiled validation
at the route boundary, since facet validation is the enforcement point. MongoDB driver directly, no
ODM — the document shapes are ours and per-workspace databases are resolved at runtime. Ajv for facet
schemas, TypeBox for derived types. `@modelcontextprotocol/sdk` for MCP. Next.js console.
Vitest plus Testcontainers, since the meaningful tests are integration-shaped.

**No workflow or event-sourcing framework.** Propose, accept and supersede are the product; a
framework that owns them owns the thing being sold.

---

## 10. Non-goals

| Not doing | Because |
|---|---|
| Evaluating bodies | Gates read facets. A gate requirement over prose is unfalsifiable |
| Orchestrating work | Lifecycle state and decisions, not task execution |
| Real-time collaborative editing | §11. Optimistic concurrency in v1 |
| A page tree or a wiki | Artifacts have typed links, not a hierarchy. This is the failure mode to guard against |
| Cross-workspace queries | §6. Aggregation across workspaces is the consumer's |
| Deciding anything | ADR-0005. The whole point |

**The wiki risk deserves naming.** Adding authoring and rendering moves this closer to Confluence in
appearance, and the pressure to add comments, page trees, templates and freeform spaces will be
constant. Following it produces a worse Confluence with a governance story bolted on. The line: **the
editor exists to produce a version that a gate will decide on.** Authoring features that do not serve
a gated artifact are out of scope, and a proposal to relax that is a strategy change, not a feature.

---

## 11. Decisions

| # | Decision | Where |
|---|---|---|
| D1 | Artifact types, links, gates, lifecycles and attribution profiles are configuration | [ADR-0001](decisions/0001-artifact-types-are-configuration.md) |
| D2 | `identity-service` is the only required dependency; everything else is a port | [ADR-0002](decisions/0002-identity-service-is-the-only-dependency.md) |
| D3 | Drafts are mutable, versions are immutable; propose snapshots one into the other | [ADR-0003](decisions/0003-immutable-versions-mutable-drafts.md) |
| D4 | Facets are evaluated; bodies are authored, rendered and diffed but never evaluated | [ADR-0004](decisions/0004-facets-are-evaluated-bodies-are-read.md) |
| D5 | Agents author and propose; only a named human decides; no decision surface on MCP | [ADR-0005](decisions/0005-agents-may-author-never-decide.md) |
| D6 | Workspace isolation is database-per-workspace, bound once per request | [ADR-0006](decisions/0006-workspace-isolation-by-database.md) |
| D7 | MongoDB with bodies inline; attachments content-addressed in object storage | [ADR-0007](decisions/0007-mongodb-with-inline-bodies.md) |
| D8 | Principal ids are local; an issuer's `sub` is never stored on a record | §7.2 |
| D9 | At most one link per type is pinned, resolved to a version at acceptance and frozen | §2.6 |
| D10 | Redaction is the single permitted mutation, recorded, and detectable by digest mismatch | §8.3 |

---

## 12. Build order

| # | Step | Gate |
|---|---|---|
| 1 | Workspace definitions, type registry, facet schema validation | An invalid facet set is refused with the failing schema path named; the definition version is stamped on every version written under it |
| 2 | Principal registry over `identity-service`, console SSO | A user signed in for another Application reaches the console without a login form; an agent principal is distinguishable from the human accountable for its work and from its credential |
| 3 | Workspace handle and database-per-workspace | Every access binds a handle; a code search finds no query naming a workspace; the adversarial cross-workspace read fails |
| 4 | Drafts, save, optimistic concurrency, contributors | Two concurrent saves — one human, one agent — resolve without silent loss, and both appear as contributors |
| 5 | Propose, immutable versions, supersede | No API path mutates a version; a stale-revision propose is refused |
| 6 | Rendering, attachments, diff | A body renders sanitised, an attachment resolves to a signed URL, and a reviewer reads a diff without knowing the format |
| 7 | Gates, decisions, attribution profile | A decision missing a required field is refused; a decision naming an agent as accountable is refused; both refusals are recorded |
| 8 | Record sink with outbox | The sink is stopped, writes continue, and every record arrives on recovery in order |
| 9 | Links and the pin, lineage, register, search | A pinned link resolves to the accepted version after the target is superseded twice |
| 10 | Evaluator port, MCP, SDK, export, redaction | A gate requiring an evaluation refuses to open without a passing result; an export is read by a third party with the service switched off |

Steps 1–7 are the product. Everything after makes it complete.

---

## 13. Open

- **A.** Whether a lifecycle is per workspace or per artifact type. Per type is more expressive; per
  workspace is what both current consumers need.
- **B.** When real-time collaborative editing becomes necessary. Optimistic concurrency is right
  until two people routinely edit one draft; the trigger is a conflict rate, not a request.
- **C.** Whether a workspace definition change can retroactively invalidate accepted versions, or is
  always additive. Additive is safer and eventually cramped.
- **D.** Whether evaluations are versioned artifacts themselves. They have authorship, a subject and
  a time — which is most of an artifact.
- **E.** Whether `expired` needs a scheduler in-service or is driven by a consumer.
- **F.** Whether comments belong on drafts. Reviewers want them, and they are the first step onto the
  wiki path — the safe version is comments on a *decision*, which the record already carries.
- **G.** Full-text search beyond MongoDB text indexes. Atlas Search or an external index both cross
  the workspace boundary awkwardly.

---

## 14. Change log

| Version | Date | Change |
|---|---|---|
| 0.2 | 2026-08-04 | **Authoring and rendering brought in scope** — the service is a full product with its own domain, console and SSO, not a headless registry. Drafts added as a mutable entity distinct from immutable versions (D3), which is what lets editing and an audit record coexist. Bodies are now authored, rendered, diffed and searched — but still never evaluated (D4), the one property preserved from v0.1. MCP gains draft writes and propose, keeping only the decision surface closed (D5). **Storage moved to MongoDB with bodies inline** and attachments content-addressed in object storage (D7); isolation reworked to database-per-workspace with the fail-closed argument (D6); redaction recorded as the single permitted mutation (D10). §3 authoring, §7 identity and SSO, and §8.4 on what MongoDB does not give us added. The wiki risk named explicitly in §10 |
| 0.1 | 2026-08-04 | Initial architecture. Model derived from the overlap between adel and maestro. Configuration-driven types, links, gates and lifecycles. Ports with local defaults. Immutable supersede-only versions; facets separated from an opaque body; the service records decisions and never makes one; workspace isolation by binding |
