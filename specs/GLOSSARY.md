# Glossary

The service ships no domain vocabulary (ADR-0001). These are the generic terms and what each maps to
in the two consumers that shaped the model. *maestro* is the governed application platform designed in
`../maestro`; *maestro v1* is its retired first iteration, an agentic delivery platform, kept as the
second consumer. (Until 2026-09-15 these columns read *adel* and *maestro*.)

| Term | Means | maestro | maestro v1 |
|---|---|---|---|
| **Workspace** | The confidentiality and ownership boundary. Owns its definitions and everything inside. Nothing crosses one | A tenant | The organisation |
| **Artifact** | A lineage of a declared type, with a stable id | A business case, a specification | A functional spec, a technical design |
| **Draft** | A **mutable** working copy. Where authoring happens. Not a record; nothing may cite it | A case being shaped | A spec being written by the crew |
| **Version** | An **immutable** snapshot of a draft. Superseded, never edited | A specification version | A revision put to a gate |
| **Type** | A declared artifact class: facet schema, body format, link types, attachment policy | `business_case`, `specification` | `charter`, `functional_spec` |
| **Facet** | A typed, schema-validated field. The only thing a gate or evaluator reads | Declared outcome, beneficiary, regime | `AC-N`, `NFR-N`, scope |
| **Provenance** | How a facet came to hold its value: `declared`, `extracted`, `reconstructed` | Marks reconstructed intake data | Marks clarify-pass output |
| **Body** | Authored content in a declared format. Rendered, diffed and searched — never evaluated | The prose of a case | The markdown spec |
| **Attachment** | An image, PDF or file. Content-addressed in object storage, referenced from the body | A site photo, a drawing | A diagram export |
| **Contributor** | A principal that edited a draft. Accumulates, and carries onto the version | The case-shaping agent plus the human who confirmed | A crew agent plus the architect |
| **Link** | A typed, directional edge between artifacts | Case → specification | Spec → design |
| **Pinned link** | The one link per type resolved to a *version* at acceptance and frozen | The case version that justified a specification | The spec version a design implements |
| **Gate** | A declared decision point: what it decides on, who may decide, what must be true first | Explore, Assess, release | Functional, technical design, technical merge |
| **Decision** | An immutable, attributed record of a gate outcome | Sponsor decision at Explore | Architect approval at merge |
| **Attribution profile** | Which fields a decision must carry and what each must resolve to | `accountable`, `acting`, `seat`, `oversight_level` | Reviewer and agent |
| **Accountable** | The named human answerable for a decision. Never an agent (ADR-0005) | The gate owner | The architect or functional reviewer |
| **Acting** | Who or what performed the act. May be an agent | An agent on a seat | A crew agent |
| **Lifecycle** | Declared phases and transitions, each authorised by a gate | Explore → Prove → Build → Run → Retire | Draft → in review → approved |
| **Evaluation** | A verdict recorded against a version by an external evaluator. The service never computes one | A standards evaluation | Spec-adherence tests, the clarify pass |
| **Record sink** | The outbound port every state change is emitted to. Local by default; an external spine when configured | The record spine, which becomes authoritative | Local |
| **Principal** | A local identity — human, agent or service — mapped from an issuer subject | A registered principal | A participant or crew agent |
| **Redaction** | The single permitted mutation of a version: content removed under a lawful erasure, recorded as an event | A GDPR erasure | Rare |
| **Register** | Everything in flight in a workspace, with lifecycle state | The opportunity register and portfolio | The backlog |

## Choosing the workspace altitude

The question a new consumer gets wrong: *what must never leak, and what must be queryable together?*

Cross-workspace queries do not exist (ADR-0006), so the workspace has to sit **above everything you
need to see at once**. maestro answers "tenant" because its portfolio queries across every application
within one. maestro v1 answers "the organisation" because a charter is shared across products — mapping
a workspace to a product would make that link impossible.

## Vocabulary across services

Three services meet in a consumer's code, and two rules keep them from fusing.

| Concept | specs-service | maestro | identity-service |
|---|---|---|---|
| Confidentiality boundary | **Workspace** | Tenant | *none* — ADR-0018 removed it |
| Physical instance | *not modelled* | Deployment (a choice, not an entity) | Deployment = realm |
| Identity | **Principal** | Principal | User, OAuth client; `principal*` in the audit log |

**1. Translate explicitly, never by renaming.** A consumer maps its own boundary onto a workspace
through an adapter — `workspaceFor(tenant)` — in one auditable place. A variable named `workspaceId`
holding a tenant id is how two concepts silently become one.

**2. Neither side adopts the other's identifiers.** specs-service mints its own workspace and
principal ids and keeps an optional `external_ref`; a consumer keeps its own and maps. Ids re-mint
when a deployment moves, and mapping rows are cheap while immutable history is not.

**`principal` is the one term deliberately shared** across all three, because it crosses every
request. Do not introduce "actor", "subject" or "user" as synonyms for it.

## Terms deliberately absent

**Page.** There is no page tree and no hierarchy — artifacts have typed links. The word invites the
wiki, which §10 of the architecture names as the failure mode to guard against.

**Approval workflow.** The service holds gates and decisions; it does not route, escalate or remind.
That is orchestration and belongs to the consumer.

**Tenant.** Too specific. A workspace is a tenant only in a multi-tenant consumer; in maestro v1 it is
an organisation, and one word meaning two things is worse than a neutral one.
