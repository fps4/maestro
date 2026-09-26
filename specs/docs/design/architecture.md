---
title: specs-service architecture
status: draft
last_updated: 2026-09-20
owners: [architect]
related:
  - ./decisions/0001-artifact-types-are-configuration.md
  - ./decisions/0002-identity-service-is-the-only-dependency.md
  - ./decisions/0003-immutable-versions-mutable-drafts.md
  - ./decisions/0004-facets-are-evaluated-bodies-are-read.md
  - ./decisions/0005-agents-may-author-never-decide.md
  - ./decisions/0006-workspace-isolation-by-database.md
  - ./decisions/0007-mongodb-with-inline-bodies.md
  - ./decisions/0019-the-outbox-holds-spine-envelopes.md
  - ./decisions/0020-the-payload-store-and-the-rebuild.md
  - ./decisions/0021-the-store-is-dynamodb.md
---

# specs-service — architecture

**Status:** Draft v1.4
**Scope:** The whole product. Model, authoring, rendering, configuration, ports, isolation,
interfaces, storage, build order.
**Shape:** A full end-to-end service with its own domain, its own console, and SSO through
`identity-service` — usable on its own, and one of maestro's components (`docs/components/specs-service.md` at the repository root).

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

| Concept | maestro (the ops engine) | maestro v1 |
|---|---|---|
| Isolation boundary | Tenant — one deployment by default | The organisation |
| Artifact chain | Cause analysis; intake assessment; specification; change record pinned to the specification it implements | Charter → Functional spec → Technical design + tasks |
| Evaluable units | Facets against the type's schema — the floor; a standards engine only in its regulated branch | EARS acceptance criteria `AC-N`, NFRs |
| Unit attributes | Facets with provenance | `priority`, `verify`, `source`, `rationale` |
| Gates | RCA review, intake, specification, release | Functional, technical design, technical merge |
| Gate owner resolution | A seat — operations, sponsor, owner — as a role in the tenant | `config/reviewers.yaml` routing matrix |
| Outcomes | accept / request changes / reject, labelled per gate | approve / request-changes / reject |
| Agent posture | An RCA run proposes; a named human decides | Produces artifacts; never decides a gate |
| Proportionality | Consequence class; onboarding level | Risk tier relaxing human review |
| Pre-gate assist | Facet extraction by a run, then a person's confirmation | The clarify pass |

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
        └── Question         a fact about a version: asked, answered (by anyone), closed by a human
Gate
  └── Decision               immutable, attributed to a named human principal
Lifecycle
  └── Phase                  declared states and legal transitions; a transition is a decision
```

**The draft/version split is the centre of the design** (ADR-0003). Editing is continuous, messy, and
collaborative; a record is none of those things. Making them the same object forces a choice between
an unusable editor and a worthless record. Keeping them apart gives both.

### 2.1 Workspace

The isolation boundary (ADR-0006). maestro maps a tenant onto it; maestro v1 maps its organisation.
Nothing crosses a workspace — not a link, not a lineage, not a query.

**A workspace is logical, never physical.** Which table or deployment it lives in is a choice
(§6), and the workspace id never encodes it. If it did, moving a workspace would change every export
and every pinned reference.

Choose the altitude by asking: *what must never leak, and what must be queryable together?* maestro
answers "tenant", because the portfolio queries across every application within one. maestro v1 answers
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

**But they are authored as one document** (ADR-0017). A draft is written and saved as one markdown
text: front-matter carries the envelope and any facet, and a type may declare `body_blocks` — *the
table under the heading "Acceptance criteria" is the facet `acceptance_criteria`* — so a block is
prose to the reader and structure to the gate, and the same bytes are both. The service derives the
projection at save, marks its provenance from the saver, and shows it beside the editor as *what the
gate will read*. There is no second form. A version's document is composed from the record; the
digest is over facets and body as before.

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
*version* at acceptance and freezes. Everything else points at a lineage and follows it. A version
whose type declares a pin must carry it: the gate refuses one that does not, so the trail cannot be
bypassed by omission (ADR-0016).

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

**Which outcome accepts is declared** — `accepts_on: publish` — or taken as `approve` / `accept` when
the gate lists one; a gate for which neither resolves is refused at apply (ADR-0013). The service
does not know what "publish" means, and must not.

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

maestro populates `seat` and `oversight_level`; maestro v1 does not. **The generic rule is that a named
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

### 3.4 The decision page, and the decider's packet

The page a person decides on is built from one call, `GET /gates/:gate/:artifact/:ordinal/packet`,
in plain language and in reading order: what the gate asks, what the artifact is, what changed since
the last version anyone decided on, what the checks found, what each outcome would do, whether this
principal may decide, and what was decided before (ADR-0013). The same object is the
`decision_packet` MCP tool, so an agent explaining a decision reads what the sponsor reads — and,
like everything on MCP, it carries no way to decide.

**An author can ask what a draft still needs.** `GET /drafts/:id/readiness` turns the type's schema
into the questions it asks — each required facet not yet answered, in the schema's words, plus what
the gate ahead will require — split into what stops *propose* and what the gate will refuse
(ADR-0015). The editor shows it and re-asks after every save; over MCP it is `draft_readiness`.

**A specification may be a file next to the code** (ADR-0016). `specs propose` turns a markdown file
with front-matter into a proposed version — withdrawing the lineage's earlier undecided proposal,
checking readiness first, running the gate's evaluations — and a composite GitHub Action does the
same from a pull request and comments the decider's packet. Nothing in CI decides: `accountable`
resolves from the token and the profile refuses a non-human. See
[`guides/git-native-specs.md`](../guides/git-native-specs.md).

**A reviewer may ask.** A question attaches to an immutable version, never to a draft, and never
changes it: it is a fact about the version, like a decision (ADR-0014). Anyone asks, anyone answers
— an agent's answer is marked as an agent's — and a human closes it. A gate may declare
`requires.questions_resolved` to hold shut over an open question; undeclared, open questions are
shown and never block.

### 3.5 Search

Search is a filtered read of the workspace's versions — title and body, case-insensitively, a title
hit outweighing a body hit — bounded by the workspace's own partition, so search cannot cross the
boundary by construction (§6; ADR-0021 §5). Adequate for the MVP; a search service is a later
decision, taken when a workspace outgrows it.

---

## 4. Configuration is the product

A workspace definition is data, versioned like anything else. Applying a new definition is a
governed change: existing versions were written against the definition in force at the time, and
that definition version is stamped on them.

```yaml
workspace: maestro-v1-core
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

**Every identifier is declared once and labelled beside it** (D14, ADR-0012). `title` and `description`
on types and gates, `outcome_labels` on a gate, `phase_labels` on the lifecycle, `label` on a link,
`field_labels` on an attribution profile. The record carries the identifier; the console shows the
label; the api returns the complete set with a humanised fallback so no screen is ever forced back
to `request_changes`.

---

## 5. Ports — why this runs alone

`identity-service` is the only required runtime dependency (ADR-0002). Everything else is an outbound
port with a working local default.

| Port | Local default | Production adapter | Consumer |
|---|---|---|---|
| **Record sink** | Outbox items holding the spine's envelope, relayed to a filesystem archive; payloads — a version's text, a reasoning, a question, findings — in a directory beside it, named on the event by locator and digest | maestro's spine: a scheduled relay drains the outbox to an S3 archive; SNS/SQS deliver to consumers; payloads in this service's own bucket, erasable; the rebuilder replays the verified archive and its payloads into an empty workspace prefix | maestro — the archive becomes the record and this table a projection (ADR-0019, ADR-0020); the rebuild is the MVP's acceptance scenario R2 |
| **Evaluator** | `builtin: facet_schema` — the type's own schema, one finding per required facet (ADR-0015) | HTTP callout, `${VAR}` resolved from the environment; result recorded on the version | maestro: the builtin floor in the MVP; a standards engine only in its regulated branch. maestro v1: spec-lint, EARS check |
| **Notifier** | Log line | HTTP webhook (Slack); SES | Gate awaiting a decision; changes requested |
| **Object storage** | MinIO | S3 | Attachments, and body overflow |
| **Principal directory** | — | `identity-service` **(required)** | Authentication and attribution |

**The record sink is the seam between product and platform component.** Every state change — draft
proposed, decision recorded, link pinned, body redacted — is emitted as an attributed event,
transactionally with the change via an outbox. Run with the default and this table is the record.
Point it at a durable spine and **the spine becomes authoritative and this table becomes a
projection.** One configuration value. In maestro that spine is an S3 archive fed by a relay from
this outbox (`docs/components/spine.md` at the repository root); nothing in this service names it, which is
what keeps the default and the spine the same code path.

---

## 6. Isolation

**One key prefix per workspace** (ADR-0006, amended by ADR-0021). The rule, stated once:

> A workspace-scoped handle is acquired once per request, and no query names a workspace.

```ts
// The only way to reach a store. No repository accepts a raw client or a workspace id; every key
// the handle's repositories build begins with `ws#<workspace>#`, and any other is refused.
type WorkspaceHandle = { readonly workspace: WorkspaceId; readonly versions: VersionRepository; … };
```

**This fails closed, and that is the argument.** A forgotten `WHERE tenant_id` returns every tenant's
rows. A forgotten handle has no prefix to query — it does not compile, and at worst it errors — and a
key built for another workspace is an `IsolationViolation` before a request is made. The failure
mode of the mistake is what matters, not the elegance of the mechanism.

Two deployment levels, and the code cannot tell them apart:

| Level | Mechanism | Isolation |
|---|---|---|
| **Shared** | One table, a key prefix per workspace | Structural — resolved once, never filtered |
| **Dedicated deployment** | One tenant, one table, one workspace (or several of the tenant's own) | Physical |

Object storage mirrors it: prefix per workspace.

**maestro's default is the second row.** A tenant is one deployment of maestro (its ADR-0007): one
stack, one identity realm, one archive prefix, one table — so a tenant's specs-service holds one
workspace, or several for a tenant with several estates, and never another tenant's. The shared
level stays available, unchanged in code, for a consumer that wants it.

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

**SSO is transparent because the session is `identity-service`'s.** A user signed in for maestro and
landing on specs-service's domain completes the authorization-code flow against an existing session
and never sees a login form. That works because both are Applications in one deployment over a
shared user pool — the property `identity-service`'s ADR-0018 exists to provide.

### 7.2 What each side owns

**Authentication is `identity-service`'s** — credentials, federation, token issuance, JWKS.
Consistent with its own ADR-0005: identity authority and Policy Information Point, never a Policy
Decision Point.

**Authorisation is ours**, and narrow: who may author in a workspace, and who may decide at a gate.
Gate ownership resolves through a declared resolver — role claim, explicit assignment, or a routing
table — which is how maestro v1's `reviewers.yaml` and maestro's tenant roles become one mechanism.

**Principal ids are maestro's, never an issuer's subject.** A registry maps `(issuer, subject) →
principal id`, and only the principal id is written to a draft, version, decision, or export. An
issuer's subject is minted per deployment; move the identity deployment and every subject re-mints,
against decisions retained for years. The id is the one identity-service mints and carries in every
token as `prn`, registered here on first sight; this service mints none for a real identity, and an
id it minted before it read `prn` is superseded by the operator's `principal:adopt`, the record left
as it is ([ADR-0022](../decisions/0022-the-principal-id-is-identity-services.md)).

**Agents are principals of kind `agent`**, distinct from the credential they authenticate with and
from the human accountable for their work — which is what makes §2.8's rule enforceable.

### 7.3 Under an umbrella later

Nothing above changes under maestro. maestro's other components are Applications in the same
identity deployment; its landing page ("Today") links to this console's decision page; the record
sink points at its spine. The service does not learn it has been absorbed.

---

## 8. Storage

**One DynamoDB table, with bodies inline and blobs in object storage** (ADR-0021, superseding
ADR-0007; maestro ADR-0018).

### 8.1 Items

Every item carries `kind`. A workspace's items share the prefix `ws#<workspace>#`
(`api/src/db/keys.ts` is the layout; ADR-0021 §1 the table of keys):

| Kind | Holds |
|---|---|
| `artifact` | Lineage metadata, current accepted ordinal |
| `draft` | Mutable working copies; `expires_at` is the table's TTL |
| `version` | Envelope, facets, **body inline**, attachment refs, links; on `gsi1` by state, on `gsi2` by `standard_id` |
| `decision` | Immutable gate decisions |
| `evaluation` | Verdicts recorded against versions |
| `membership` | Who may author, who may decide |
| `question` | Questions on a version, with their answers and who closed them (ADR-0014); on `gsi1` by version |
| `acceptance` | This tenant's acceptances of catalogue standards, with their status (ADR-0010) |
| `outbox` | The record sink: spine envelopes with the relay's bookkeeping (ADR-0019); on the sparse `pending` index while undelivered |
| `counter` | The workspace's `seq` and each subject's `subject_seq`, moved in the emitting transaction on the condition that they had not |
| `meta` | One item: the `projection_version` this workspace was written by; behind the code's, it refuses to serve until rebuilt (ADR-0020) |

Control items, under `ctl#`: `workspace`, `workspace_definition`, `principal`, and the `unique`
item that maps a principal's `(issuer, subject)`.

### 8.2 Bodies inline, blobs outside

**The body lives in the version item.** A specification is tens of kilobytes; fetching a version is
one round trip, and rendering, diffing and searching need no second store.

- **Ceiling: 256 KiB inline** (`BODY_CEILING_BYTES`), capped at 300 000: an item is at most 400 KB,
  and the facets, provenance, links and keys sit beside the body. Enforced at propose rather than
  discovered. The payload store holds the same version without a ceiling (ADR-0020).
- **Attachments are always external**, content-addressed and deduplicated (§2.5).
- **Lists travel without the body.** Registers, search results, lineage and the catalogue's shelf
  return versions without their text. DynamoDB bills the item read, not what travels, so the
  ceiling is what bounds the cost of a list; this is the one operational discipline the choice
  demands.

### 8.3 Redaction — the single permitted mutation

Bodies inside version documents mean erasure cannot be a blob delete. So it is explicit:

**Redaction replaces the body content and the affected attachments, in place, and is recorded as a
`BodyRedacted` event.** The envelope, the digest, the decisions and the links all survive — the
record still proves *what was accepted* without retaining the content.

The digest no longer matches the stored body afterwards, **and that is the point**: the mismatch is
detectable, and the redaction event explains it. A mismatch with no event is corruption; a mismatch
with one is a lawful erasure. Silent deletion would be indistinguishable from tampering.

### 8.4 What the store does not give us

Recorded rather than glossed. There are no foreign keys, so a pinned link pointing at a real version
is enforced in application code. There are no check constraints, so a legal state transition is
enforced in one code path rather than by the store. Both are accepted costs (ADR-0007, carried by
ADR-0021), and the compensating control is the record sink: an illegal transition is detectable
after the fact because every transition is emitted, and a divergence between the emitted stream and
stored state is an alertable condition.

What the store *does* give: a condition on every write. The transaction that records an act
carries the condition that makes each read still true — the version still proposed, the counter
where it was — so a record that moved is refused rather than half-applied (ADR-0021 §2). Reads of
an index are eventually consistent, by milliseconds; where that shows is written down (ADR-0021 §4).

---

## 9. Stack

TypeScript on Node 22 LTS, matching `identity-service`. Fastify with zod validation at the route
boundary. The AWS SDK's DynamoDB document client directly, behind typed repositories — one method
per access pattern, every key built from the workspace's layout (`api/src/db/`). **Ajv with draft
2020-12** for facet schemas. Next.js console, token-driven Tailwind. Vitest, with the integration
tests driving DynamoDB Local, since the meaningful behaviour here is integration-shaped: a
transaction that half-applies, a pin that resolves against stored state, a prefix that stops a
query crossing a boundary.

**The repository layout is `api/` and `web/`**, each with its own `package.json`, lockfile and
Dockerfile, plus `infra/docker/`, `config/` and `docs/`. There is deliberately no npm workspace: each
image's build context is streamed to the Docker daemon on the CI runner, and independent lockfiles
keep those contexts small and the two builds genuinely independent.

**No workflow or event-sourcing framework.** Propose, accept and supersede are the product; a
framework that owns them owns the thing being sold.

**Deployment is serverless AWS**, as maestro's ADR-0002 rules for every component: the api as a
Lambda behind an HTTP API Gateway through the Lambda Web Adapter, code unchanged; the console
through OpenNext to Lambda and CloudFront; one DynamoDB table, the module's, a prefix per workspace
(maestro ADR-0018); S3 for attachments and payloads; the record-sink relay as a scheduled Lambda;
the whole as the Terraform module in `terraform/` (maestro ADR-0016) that a tenant's private
configuration repository (`fps4/maestro-<tenant>`) composes with the spine's and applies
at a tag (maestro ADR-0017). `docker compose` is the development loop, not a deployment target;
the self-hosted deployment this repository used to carry is gone.

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

**One narrowing, made deliberately** (ADR-0014): *anything attached to a version is a fact about it
— a decision, an evaluation, a question — and never a change to it.* A question on an immutable
version is admitted on that test. Comments on drafts, page trees and freeform spaces still fail it.

---

## 11. Decisions

| # | Decision | Where |
|---|---|---|
| D1 | Artifact types, links, gates, lifecycles and attribution profiles are configuration | [ADR-0001](../decisions/0001-artifact-types-are-configuration.md) |
| D2 | `identity-service` is the only required dependency; everything else is a port | [ADR-0002](../decisions/0002-identity-service-is-the-only-dependency.md) |
| D3 | Drafts are mutable, versions are immutable; propose snapshots one into the other | [ADR-0003](../decisions/0003-immutable-versions-mutable-drafts.md) |
| D4 | Facets are evaluated; bodies are authored, rendered and diffed but never evaluated | [ADR-0004](../decisions/0004-facets-are-evaluated-bodies-are-read.md) |
| D5 | Agents author and propose; only a named human decides; no decision surface on MCP | [ADR-0005](../decisions/0005-agents-may-author-never-decide.md) |
| D6 | Workspace isolation is one key prefix per workspace, bound once per request | [ADR-0006](../decisions/0006-workspace-isolation-by-database.md), amended by [ADR-0021](../decisions/0021-the-store-is-dynamodb.md) |
| D7 | Bodies inline; attachments content-addressed in object storage | [ADR-0007](../decisions/0007-mongodb-with-inline-bodies.md), superseded by [ADR-0021](../decisions/0021-the-store-is-dynamodb.md) |
| D8 | Principal ids are maestro's (identity-service's `prn` since ADR-0022); an issuer's `sub` is never stored on a record | §7.2 |
| D9 | At most one link per type is pinned, resolved to a version at acceptance and frozen | §2.6 |
| D10 | Redaction is the single permitted mutation, recorded, and detectable by digest mismatch | §8.3 |
| D11 | The catalogue is a workspace, reached read-only; a tenant carries a reference, never a link | [ADR-0008](../decisions/0008-the-catalogue-is-a-workspace.md) |
| D12 | External and platform standards are distinct types; licence disposition is a required facet | [ADR-0009](../decisions/0009-external-and-platform-standards-are-distinct-types.md) |
| D13 | Versions may be effective-dated; only a *material* change lapses an acceptance | [ADR-0010](../decisions/0010-effective-dating-and-acceptance-lapse.md) |
| D14 | Every identifier a workspace declares has a label, and no surface shows the identifier | [ADR-0012](../decisions/0012-labels-not-identifiers.md) |
| D15 | The decision page is the product; the decider's packet is one call shared by console and MCP; the accepting outcome is declared | [ADR-0013](../decisions/0013-the-decision-page-is-the-product.md) |
| D16 | A question on a version is a fact about it: asked by anyone, answered by anyone, closed by a human, never a mutation; a gate may declare `questions_resolved` | [ADR-0014](../decisions/0014-questions-on-a-version.md) |
| D17 | The evaluator port has a floor (`builtin: facet_schema`) and an outbound call; both run at propose; a draft can ask its readiness | [ADR-0015](../decisions/0015-the-evaluator-port-has-a-floor.md) |
| D18 | A specification may be a file next to the code; `specs propose` and a GitHub Action propose, nothing in CI decides; a version must carry its declared pin | [ADR-0016](../decisions/0016-the-git-native-path.md) |
| D19 | One document is the artifact; facets are derived from it at save; `body_blocks` declare which table is which facet | [ADR-0017](../decisions/0017-one-document.md) |
| D20 | specs-service stays the record for every maestro repository; OpenSpec is interoperated with — its requirement/scenario layout as a block shape, EARS statements with GIVEN/WHEN/THEN scenarios — and not adopted as a system | [ADR-0018](../decisions/0018-openspec-interoperate-not-adopt.md) — *accepted* |
| D21 | The outbox holds the spine's envelope, built and validated in the transaction; an agent acts under a seat occupancy naming the answerable human; free text leaves the body; principal ids carry the kind | [ADR-0019](../decisions/0019-the-outbox-holds-spine-envelopes.md) — *accepted* |
| D22 | What the record cannot say goes to an erasable payload store, named on the event by locator and digest; evaluations are events; a workspace is rebuilt from a verified archive and its payloads alone, and a stale projection refuses to serve; memberships are grants, drafts are not record | [ADR-0020](../decisions/0020-the-payload-store-and-the-rebuild.md) — *accepted* |
| D23 | The store is one DynamoDB table (maestro ADR-0018): a prefix per workspace under the same handle, every query a key or an index, the outbox one transaction conditioned on the workspace's counter, the relay on a sparse index, search a filtered read, expiry the table's TTL, the rebuild a deleted prefix; no database credential | [ADR-0021](../decisions/0021-the-store-is-dynamodb.md) — *accepted* |
| D24 | The principal id is the token's `prn`, identity-service's; none is minted here for a real identity; an id minted before is superseded by an operator's `principal:adopt` that moves grants and rewrites no record, and separation of duties reads the supersession | [ADR-0022](../decisions/0022-the-principal-id-is-identity-services.md) — *accepted* |

---

## 12. Build order

| # | Step | Gate |
|---|---|---|
| 1 | Workspace definitions, type registry, facet schema validation | An invalid facet set is refused with the failing schema path named; the definition version is stamped on every version written under it |
| 2 | Principal registry over `identity-service`, console SSO | A user signed in for another Application reaches the console without a login form; an agent principal is distinguishable from the human accountable for its work and from its credential |
| 3 | Workspace handle and a key prefix per workspace | Every access binds a handle; a code search finds no query naming a workspace; the adversarial cross-workspace read fails, and a key outside the handle's prefix is refused |
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
- **G.** Full-text search beyond a filtered read of the workspace's versions. An external index
  crosses the workspace boundary awkwardly; the trigger is a workspace whose search outgrows the
  read (ADR-0021 §5).

---

## 14. Change log

| Version | Date | Change |
|---|---|---|
| 1.4 | 2026-09-20 | **The store is DynamoDB** (D23, ADR-0021; maestro ADR-0018). One table per component, the Terraform module's, reached by a role and never by a credential. A workspace's items share the prefix `ws#<workspace>#` and the handle refuses any other key; the handle's repositories are one method per access pattern, and every former index maps to a key, a partition, `gsi1`, `gsi2`, the sparse `pending` index or the TTL (ADR-0021 §4). The outbox is one `TransactWriteItems` conditioned on the workspace's counter; search is a filtered read of the workspace's versions; the body ceiling is 256 KiB; the rebuild deletes a prefix. Tests, the compose loop and CI run on DynamoDB Local. §3.5, §5, §6, §8, §9, §12 and §13.G amended |
| 1.3 | 2026-09-20 | **The payload store and the rebuild** (D22, ADR-0020; D21 recorded for ADR-0019). Every free-text write — a version, a decision's reasoning and its evaluations snapshot, a question, an answer, a withdrawal's reason, an evaluator's findings — is a payload in an erasable store (`PAYLOAD_STORE`: a directory or this service's bucket), written before the transaction and named on the event by `payload_ref` and `payload_digest`. `EvaluationRecorded` joins the record: a gate's openness is a function of it. A version is stored in canonical key order, the form the record carries. `RebuildService` and `workspace:rebuild` replay a verified archive and its payloads into an empty workspace database; `meta.projection_version` refuses a stale projection. `tests/integration/rebuild.test.ts` is the M1 gate. §5 and §8.1 amended |
| 1.2 | 2026-09-18 | **Aligned with the maestro MVP.** maestro was re-scoped on 2026-09-18 from a governed application platform to an ops engine, its design corpus retired (tag `corpus-2026-09` on `fps4/maestro`) and rewritten; this service is one of its components. §1.1's maestro column now reads in the MVP's words; §5 names the spine the record sink drains to (an S3 archive via a relay, SNS/SQS delivery) and drops Kafka as the example; §6 records that tenant = deployment is maestro's default; §9 gains the deployment shape (Lambda + API Gateway, OpenNext, Atlas Flex, S3, CDK). The shipped demo workspace is `config/workspaces/aannemer-x.yaml` v2 — cause analysis, intake assessment, specification, change record — and the earlier chain lives on as the integration fixture; the console shows the catalogue only for a workspace that declares `catalogue_refs`. The self-hosted deployment configuration and workflow are removed. No model, port or decision changed |
| 1.1 | 2026-09-15 | **OpenSpec: interoperate, do not adopt** (D20, ADR-0018 — the first *accepted* decision). Its requirement/scenario layout becomes the second `body_blocks` shape; requirement statements stay EARS with GIVEN/WHEN/THEN scenarios; no `openspec/` directory in a maestro repository. The change workflow is recorded as owed by work-service and skills, not by a spec convention |
| 1.0 | 2026-09-15 | **One document** (D19, ADR-0017). ADR-0004's split stays in the record and leaves authoring: a draft is saved as one markdown text (`PUT /drafts/:id/document`), the facets derived from front-matter and from the type's declared `body_blocks` — a table under a named heading is a facet — with provenance from the saver and a human's confirmation surviving an unchanged value. A version composes its document from the record; the digest is unchanged. The console editor is one textarea with the derived projection beside it; the second form is gone. The CLI sends the file as the document; MCP gains `read_document` and `save_document`. The specification type declares its acceptance-criteria table. §2.4 amended |
| 0.9 | 2026-09-15 | **The git-native path** (D18, ADR-0016). `specs` CLI — propose a markdown file with front-matter (readiness first, one live proposal per lineage, evaluations run), print the decider's packet as markdown, decide under one's own token, withdraw. `withdraw` reaches the api for the first time. A composite GitHub Action proposes from a pull request and posts the packet; no decide step in CI, by design. **A version whose type declares a pin must carry it** — a gate requirement computed once for view and decision — closing a bypass where a specification with no `justified_by` could be accepted. Guide added |
| 0.8 | 2026-09-15 | **The evaluator port has a floor, and the callout exists** (D17, ADR-0015). An evaluator is `builtin: facet_schema` or an `endpoint` with `${VAR}` resolved from the environment; both run at propose and on demand, and report `recorded` or `unavailable` with a reason. The committed definition makes sufficiency a builtin and leaves conformance an endpoint. **Readiness**: a draft's schema turned into the questions still to answer, split into what stops propose and what the gate will refuse; in the editor after every save, and over MCP. ADR-0002's port table amended; §5 and §3.4 updated. Standalone now runs the whole loop with nothing behind the port |
| 0.7 | 2026-09-15 | **Questions on a version** (D16, ADR-0014). The one thing "not a wiki" wrongly excluded, admitted narrowly: a question attaches to an immutable version, never a draft, never changes it, is asked by anyone, answered by anyone with an agent's answer marked as such, and closed only by a human. Three events on the sink carrying a digest of the text, never the text. `requires.questions_resolved` on a gate, declared on the specification gate. Over MCP: list, ask, answer — no close. The decision page and the version page gain the panel; the packet carries `questions`. §2, §3.4 and §10 amended |
| 0.6 | 2026-09-15 | **The decision page is the product** (D15, ADR-0013). One column, one call: the decider's packet returns what the gate asks, the document, the facts with their schema labels, what changed since the last *decided* version, the checks with findings, what each outcome would do (computed from the definition and stored state, with a refusal flagged before it happens), who may decide, and the history. The same object is the `decision_packet` MCP tool. The console's client-side `consequence()` is deleted. **The accepting outcome becomes declarative** (`accepts_on`), which fixes a latent defect: the catalogue's `publish` outcome would have recorded a standard as `rejected`. `gate-view.ts` extracted so the MCP import graph provably never reaches `DecisionService`, now enforced by lint. §2.7 and §3.4 added |
| 0.5 | 2026-09-15 | **Labels beside identifiers** (D14, ADR-0012). The definition gains `description` on types and gates, `outcome_labels`, `phase_labels`, link `label` and attribution `field_labels`; the api returns the complete label set with a humanised fallback; the console renders labels and never an identifier a workspace could have named. The record is untouched. This is the first of the changes that turn the console from an auditor's surface into one a sponsor can use — the decision page and the decider's packet build on the descriptions this adds |
| 0.4 | 2026-09-15 | **Consumer vocabulary aligned with the platform it serves.** The repository is now `maestro-specs` (was `mstr-specs`), and the two consumers are named as the platform names them: *maestro* is the governed application platform (`../maestro`, as its design corpus of the time described it — retired 2026-09-18, tag `corpus-2026-09`) and *maestro v1* its retired first iteration, the agentic delivery platform. Until now this repository called the first *adel* and the second *maestro* — so after the rename it used its own name for the wrong product. Swapped throughout the docs, ADRs 0001/0004/0005/0006, the glossary and the example workspace; the example workspace id is `maestro-v1-core`. Console wordmark, page title, MCP `serverInfo.name` and the npm package names follow the repository. **The deployed identifiers do not** — compose project, container names, `AUTH_AUDIENCE`, the identity client ids and the bucket still read `mstr-specs`, because changing them is a coordinated deploy with an `identity-service` seed on the other side. README Quick Start rewritten against the tree that exists (`make up`, ports 8020/8021, `AUTH_MODE`). No model, port, or decision changed |
| 0.3 | 2026-08-06 | **First build.** Steps 1–9 of §12 implemented, plus MCP. Three additions the build made necessary, each with an ADR: the **catalogue as a workspace reached through a read-only handle** (D11, ADR-0008), which resolves the tension between a pack being shared across tenants and §6 saying nothing crosses a workspace; **external and platform standards as distinct types** (D12, ADR-0009), because ISO's licence forbids holding the text while the Bbl's does not, and "is this the obligation or our reading of it" must not be a settable flag; and **effective dating with acceptance lapse on a material change** (D13, ADR-0010), which is the one real addition to the version model — accepted and *in force* are different questions. The console ships with the password grant rather than PKCE, and §7.1's transparent-SSO property therefore does not hold yet (ADR-0011). §9 rewritten to match what was built; §11 gains D11–D13 |
| 0.2 | 2026-08-04 | **Authoring and rendering brought in scope** — the service is a full product with its own domain, console and SSO, not a headless registry. Drafts added as a mutable entity distinct from immutable versions (D3), which is what lets editing and an audit record coexist. Bodies are now authored, rendered, diffed and searched — but still never evaluated (D4), the one property preserved from v0.1. MCP gains draft writes and propose, keeping only the decision surface closed (D5). **Storage moved to MongoDB with bodies inline** and attachments content-addressed in object storage (D7); isolation reworked to database-per-workspace with the fail-closed argument (D6); redaction recorded as the single permitted mutation (D10). §3 authoring, §7 identity and SSO, and §8.4 on what MongoDB does not give us added. The wiki risk named explicitly in §10 |
| 0.1 | 2026-08-04 | Initial architecture. Model derived from the overlap between maestro and maestro v1. Configuration-driven types, links, gates and lifecycles. Ports with local defaults. Immutable supersede-only versions; facets separated from an opaque body; the service records decisions and never makes one; workspace isolation by binding |
