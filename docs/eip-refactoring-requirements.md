# Refactoring `event-integration-platform` — Requirements

**Status:** Draft v0.1 — for refinement
**Companions:** `technical-design.md` (v0.6) is authoritative for the service set and the build order; `ps7-data-service.md` (v0.1) is authoritative for what `data-service` must be. This document is subordinate to both and is wrong where it conflicts.
**Scope:** What `event-integration-platform` becomes, what moves where, what is dropped, what must be built new, and the order. Requirements only — not a design for the exchange service, which has no design document yet.
**Audience:** Whoever performs the refactor, and the Assess gate that authorises it.

---

## 1. Why this document exists

Technical design §3.0.1 lists `event-integration-platform` as a candidate for **PS7 *(event shape)*** and **AE6** simultaneously. **T19 forbids those from being one service**: connectors cross a trust boundary and enforce capability grants — volume ceiling, value ceiling, approval threshold, reversal path (§11.2) — which is Tier 1 governance, not data. The repository as it stands is a single deployable spanning both.

So the reuse question has an answer that neither *adopt* nor *replace* describes: **the repository splits** (**T33**), one half becomes `data-service` (PS7, **T32**), the other becomes `exchange-service` (AE6), and a third part is dropped because maestro already has it. Both decisions are the technical design's; this document records and operationalises them and makes neither.

§3.0.1 requires this to run through an **Assess gate (§14.3)** with all five outcomes genuinely available, including *replace*. This document is the input to that gate, not a decision that precedes it.

---

## 2. Current state, honestly

**The documentation describes a target the code does not implement.** `LIMITATION-0001` records this openly and it changes what "reuse" means:

| Documented as the centre of the product | Actual state |
|---|---|
| Apache Flink SQL as the single transform runtime (ADR-0002) | **Not built.** Backlog EP-01. A JSONata worker is what exists |
| `transform-runtime` service | Not present in `services/` |
| `agent-services` AI assist layer (ADR-0004) | **Not built.** Backlog EP-03 |
| Web control plane on the ADR-0003 stack | Prior MUI-based app; replatform is backlog EP-02 |
| `control-api`, `authorizer`, connectors, observability | **Built and working** |

**What the repository actually contributes is a multi-tenant control plane over Kafka, an ingress/egress surface, a schema registry integration, and DLQ/replay** — plus a documentation architecture and a working Compose topology. That is real and worth keeping. It is not a transformation engine, and any plan that assumes one is planning against the README rather than the code.

### 2.1 Inventory and destination

| Current | Destination | Note |
|---|---|---|
| `services/control-api` | **Split.** Workspaces, topics, schemas → `data-service`; pipelines, connections, transforms → `exchange-service` | The single largest piece of work. Neither half survives intact |
| `services/connector-http-source` | `exchange-service` | Becomes the ingress that writes `ingested_from` (DS-18) |
| `services/connector-http-sink` | `exchange-service` | Consumer skeleton today |
| `services/kafka-connect` | `exchange-service` | Connector runtime |
| `packages/connector-core` | `exchange-service` | HTTP primitives, `validateTopicName`, retry policy |
| `services/clickhouse` | `data-service` | The series shape's engine (PS7 §3) |
| `services/webapp` | **Split** into two consoles | Replatform (EP-02) folds into the split rather than preceding it |
| `services/observability` (Loki, Promtail, `observability-api`) | **Dropped** | PS6 is adopted, not built (T8). Both services emit to it |
| `services/authorizer` | **Dropped** | `identity-service` is PS1 (T31). Both services SSO through it, per the `specs-service` pattern |
| `services/worker-jsonata` | **Dropped** | Already superseded by ADR-0002 within the repository itself |
| `services/connectors`, `services/workers` | Dropped | Empty |
| `packages/data-models` | **Split**, and mostly rewritten | Mongoose schemas assume the current model; PS7 §4's classification envelope is not in them |
| `packages/logging-utils`, `packages/openapi-components` | Duplicated into both | Small; a shared package across two repositories costs more than it saves at this size |

### 2.2 Documentation and decisions

| ADR | Disposition |
|---|---|
| **0002** Flink SQL as transformation engine | **Blocked on H-A** (§11). Survives in whichever service transformation lands in |
| **0003** Web application stack | Survives in both consoles unchanged |
| **0004** Agentic capabilities | Splits. NL→SQL authoring and DLQ triage are `exchange-service`; schema-aware mapping is arguably `data-service` |
| **0005** Kafka internal-only | **Survives and strengthens.** In `data-service` it is restated as PS7 H3 — Kafka is an engine, never the contract — which is a stronger claim than *not externally exposed* |
| **0006** Documentation standard and IA | Survives in both. The two-plane IA is good and should be kept |
| **0001** Record architecture decisions | Survives in both |

ADRs are immutable once accepted. In the new repositories they are **superseded with a pointer**, not edited.

---

## 3. Target end state

Two services, each independently viable, each composable under maestro.

```
                    ┌───────────────────────────────────────┐
  external ────────▶│  exchange-service        (AE6 + PS9)   │
  systems           │  ingress · transform? · connectors ·   │
                    │  DLQ · replay · capability grants      │
                    └──────────────────┬────────────────────┘
                                       │  writes, with ingested_from
                                       ▼
                    ┌───────────────────────────────────────┐
                    │  data-service                  (PS7)  │
                    │  record · document · event · series   │
                    │  classification · schema · lineage ·  │
                    │  history · erasure                    │
                    └───────────────────────────────────────┘
```

**The boundary is the trust boundary.** Everything that talks to a system the platform does not control is `exchange-service`. Everything that holds a fact and its obligations is `data-service`. The interface between them is one direction and one edge: **AE6 writes into PS7 and stamps `ingested_from`** (PS7 H13).

---

## 4. Requirements — `data-service` (PS7)

Sourced from `ps7-data-service.md`. Numbered for the Assess gate to track; **M** = must for first release, **L** = later.

### 4.1 Contract

| # | | Requirement |
|---|---|---|
| DS-1 | **M** | The public contract binds **shape** (`record`/`document`/`event`/`series`) and **access mode** (`batch`/`streaming`). It never names a store, engine, vendor, topic, or table (T19, T22, PS7 H2) |
| DS-2 | **M** | The operation set is closed at the eight in PS7 §2.1. Adding a ninth requires a recorded decision tested against PS7 §1's sentence |
| DS-3 | **M** | A `ps7://` reference never encodes the engine. Reference format is validated at write (PS7 H3) |
| DS-4 | **M** | Engines are independently operable and independently replaceable; no shared transaction or schema spans two engines (T19, §14.7) |

### 4.2 Classification, retention, erasure

| # | | Requirement |
|---|---|---|
| DS-5 | **M** | Every write carries a classification. A write without one is **rejected**, on every shape, with no default (PS7 H4). This ships before the first byte of application data |
| DS-6 | **M** | `retention.rule` names a rule; `expires_at` is **derived** from it and never accepted from a caller (PS7 H4) |
| DS-7 | **M** | `personal_data: true` requires `subject_ref` and `lawful_basis`; `erasable: false` requires a named overriding obligation (PS7 H5) |
| DS-8 | **M** | `subject_ref` is a maestro principal id. A provider `sub` is rejected (T30) |
| DS-9 | **M** | `origin` distinguishes `ingested`, `derived`, `authored`, `reconstructed` (PS7 §4.1, S5) |
| DS-10 | **M** | `erase(subject_ref, lawful_basis, requested_by)` resolves across **all** shapes and returns a receipt enumerating what was erased and what was retained under which obligation (PS7 H8) |
| DS-11 | **M** | Erasure appends `PayloadErased` to PS2 where a PS2 reference exists. Standalone deployments append to the configured record sink instead — the `specs-service` port pattern (its ADR-0002) |
| DS-12 | **M** | On the event shape, a collection carrying personal data must reference a payload rather than inline it, unless it declares compaction-on-subject-key or a retention shorter than the erasure SLA. Enforced at **collection creation** (PS7 H7) |
| DS-13 | **L** | Classification vocabulary loads from PS11 at a pack version. Until then a built-in placeholder, marked as one, with no effective dating (PS7 H6) |

### 4.3 Schema, history, lineage

| # | | Requirement |
|---|---|---|
| DS-14 | **M** | **One** schema registry and one type namespace across all four shapes, with per-shape compatibility policy (PS7 H9). A second registry anywhere in either service is a defect |
| DS-15 | **M** | An unregistered type or an incompatible version is a rejected write |
| DS-16 | **M** | Breaking change creates a new type. On the event shape, readers upcast and stored bytes are never rewritten; on the other three, a migration is permitted and is recorded as a `migrated_from` lineage event (PS7 §6) |
| DS-17 | **M** | `read(..., as_of: t)` on record and document shapes (PS7 §7) |
| DS-18 | **M** | One lineage graph across all shapes, with typed edges. `erased` nodes are retained, never deleted (PS7 §8) |
| DS-19 | **M** | Collections are `mutable` or `immutable` at creation. `immutable` rejects update at the API and is content-addressed (PS7 H10) |

### 4.4 Tenancy, interfaces, exit

| # | | Requirement |
|---|---|---|
| DS-20 | **M** | Isolation is topological, by binding a tenant-scoped handle once per request. No query path filters by tenant (T6, T28) |
| DS-21 | **M** | Event shape: exclusive **topic** per tenant, tenant-chosen partition count, explicit stored tenant→topic map (PS7 H12). **Not** PS2's exclusive-partition model |
| DS-22 | **M** | The `tenant_id` (workspace id in standalone deployments) never encodes the deployment or the engine (T28) |
| DS-23 | **M** | UI, API, MCP (T17). MCP exposes read, lineage, classification, schema, `as_of` — **never `write`, never `erase`** (PS7 H14) |
| DS-24 | **M** | Authentication is OIDC through `identity-service`; it is the **only** required external dependency. Record sink, pack source, and notifier are outbound ports with working local defaults (the `specs-service` ADR-0002 pattern) |
| DS-25 | **M** | `export(tenant)` produces data, classifications, schemas, and lineage that a third party can reconstruct without the service running (P9, PS7 H15) |
| DS-26 | **L** | Offline tolerance as a design input, before the record shape is finalised (T16) |

---

## 5. Requirements — `exchange-service` (AE6 + PS9 seam)

No design document exists for this service yet, so these are boundary and interface requirements only — enough to make the split correct and to stop PS7 absorbing governance.

| # | | Requirement |
|---|---|---|
| EX-1 | **M** | Every fact written into `data-service` is stamped `ingested_from` identifying the connector, the external system, and the ingress time (PS7 H13). **This is the load-bearing interface of the split** |
| EX-2 | **M** | The exchange service supplies a classification on every write it performs into `data-service`. It may not write unclassified data on the grounds that it does not know — a connector that cannot classify its payload is misconfigured, and that is a configuration error at pipeline creation, not a runtime default |
| EX-3 | **M** | Outbound calls are subject to capability grants — volume ceiling, value ceiling, approval threshold, reversal path (§11.2, P8). The **enforcement** is the exchange service's or PS9's; it is never a `data-service` feature (T19) |
| EX-4 | **M** | Connector *definitions* come from the domain pack (§5.6, PS11); the engine is platform; the wiring is generated. Core carries zero domain knowledge (§16) |
| EX-5 | **M** | DLQ, replay, and dead-letter triage stay here. A dead letter has not become a fact and does not belong in `data-service` |
| EX-6 | **M** | The exchange service holds **no** system of record. Anything it needs to keep beyond pipeline configuration is a `data-service` write |
| EX-7 | **M** | Kafka is not exposed externally (ADR-0005, carried forward). The external surfaces are REST ingress and the control API |
| EX-8 | **L** | Above an approval threshold, a grant is a **proposal**, not a capability — which makes PS9 depend on PS4 (technical design, PS9). Deferred with PS9, and the interface should not preclude it |

---

## 6. Estate-level requirements

| # | | Requirement |
|---|---|---|
| ES-1 | **M** | Two repositories, `data-service` and `exchange-service`, each with the `specs-service` layout: `service/`, `console/`, `sdk/`, `config/`, `docker/`, `docs/` |
| ES-2 | **M** | Both register as Applications in `identity-service` with their own role catalogues. Neither ships an authorizer |
| ES-3 | **M** | Both emit to PS6; neither ships Loki, Promtail, or an observability API (T8) |
| ES-4 | **M** | Neither service names its substrate in its contract (T22) |
| ES-5 | **M** | The two-plane documentation IA (ADR-0006) and the `CODEBASE.md` / `AGENTS.md` / `GLOSSARY.md` triad carry into both repositories |
| ES-6 | **M** | `event-integration-platform` is **archived**, not deleted, with a pointer to both successors. Its git history is the provenance for the Assess gate's record |
| ES-7 | **L** | Topic naming (`<env>.<workspace>.<pipeline>.<stream>.<variant>`) becomes internal to `data-service`'s event engine and disappears from the public contract — it names a substrate concept (DS-1) |

---

## 7. What must be built new — the honest gap

**The reuse is the front third.** Everything in §4.2 and §4.3 — classification, retention derivation, erasure across shapes, the receipt, the lineage graph, `as_of`, one registry with per-shape policy, immutable collections — **does not exist in `event-integration-platform` in any form.** What exists is transport, a schema registry integration, DLQ/replay, and a control plane.

Sequenced roughly by cost:

| New work | Why it is not reuse |
|---|---|
| Classification envelope on every write, all shapes | No equivalent concept. Touches every write path |
| Retention rules and derived expiry | No equivalent concept |
| Erasure across four shapes plus the receipt | No equivalent concept. The hardest single item |
| Lineage graph with typed edges | No equivalent concept |
| `as_of` on record and document | No equivalent concept |
| Record and document shapes | The repo is event-and-series only; MongoDB is used for *config*, not as a document shape |
| One registry, four shapes, per-shape policy | The registry integration is event-only |
| Immutable content-addressed collections | No equivalent concept |
| Tenant-scoped handle binding | Current isolation model must be audited against T6 and T28 before reuse |

**Anyone estimating this from the README will estimate the wrong service.** State the gap at the Assess gate.

---

## 8. Sequencing

The order is set by two constraints: classification cannot be retrofitted (PS7 §4.2), and maestro's first wave needs **record + series**, not the event shape.

| Phase | Work | Rationale |
|---|---|---|
| **0** | Assess gate. Five outcomes available. This document is the input | §3.0.1 — *"it exists, therefore we use it"* is not an assessment |
| **1** | Stand up `data-service` **new**: contract, classification, retention, schema registry, tenancy binding. No code moved yet | DS-5 must ship before any data. Building it into the existing tree means retrofitting the one thing that cannot be retrofitted |
| **2** | Record and series shapes; erasure and receipt; lineage; `as_of`; `export` | maestro's *◐ record + series* first wave, and the standalone product's first release |
| **3** | Fork `exchange-service` from `event-integration-platform`: connectors, ingress, Kafka Connect, DLQ/replay, the pipeline half of `control-api`, one console. Drop authorizer, observability, JSONata worker | The half that is genuinely reusable, moved once the target it writes into exists |
| **4** | `ingested_from` and EX-2 classification at the boundary; the two services meet | The interface, tested with both halves real |
| **5** | Document shape, immutable collections — unblocks PS3's T25 bodies | Arrives with AE4 and PS3's step 6 |
| **6** | Event shape and streaming mode in `data-service`; `exchange-service` writes through the contract rather than to Kafka directly | Arrives with AE6. **Not on maestro's critical path** |
| **7** | Archive `event-integration-platform` (ES-6) | After both successors are running |

**Phase 1 starts new rather than in-place, and that is the load-bearing sequencing decision.** The alternative — evolve the existing tree into `data-service` — means adding a mandatory classification to a system with unclassified data already in it, which is precisely the unrecoverable case PS7 §4.2 describes.

---

## 9. Acceptance gates

One per phase, each a demonstration rather than a review.

| Phase | Gate |
|---|---|
| 1 | A write with no classification is rejected on every configured shape. `expires_at` recomputes when the rule version changes. A tenant-scoped handle cannot read another tenant's data by any query |
| 2 | A subject is erased across record and series; the receipt names what was retained and why; lineage still shows the erased nodes; `as_of` returns yesterday's state after two updates today |
| 3 | An ingress pipeline delivers end to end with no authorizer and no Loki in the tree; auth is `identity-service`; telemetry lands in PS6 |
| 4 | Every fact whose `origin` is `ingested` resolves an `ingested_from` edge to a named connector and external system. Coverage is 100%, and the metric exists |
| 5 | PS3 stores a specification body; PS2 holds the digest; the body cannot be updated in place; erasing the subject leaves the digest verifiable in PS2 |
| 6 | An event-shape collection carrying personal data cannot be created with an inlined payload; erasing the referenced payload empties the stream's content |
| 7 | A third party reconstructs a tenant's data, classifications, schemas, and lineage from `export` alone, with neither service running |

---

## 10. Non-requirements

Recorded so their absence reads as a decision.

- **Feature parity with `event-integration-platform`.** The AI assist layer and the Flink runtime are documented, not built; there is no parity to hold.
- **A shared package across the two repositories** beyond duplication of the two small utility packages. A shared library across a trust boundary is how the boundary erodes.
- **Migrating existing data.** There is no production tenant. If one appears before phase 3, this becomes a real requirement and the sequencing above does not survive it.
- **`data-service` authoring surfaces.** No editor, no transformation authoring, no dashboards. All fail PS7 §1's sentence.
- **Kafka exposed externally**, from either service (ADR-0005).

---

## 11. Open

- **R-A.** **Where transformation lives** — PS7 **H-A**, and the largest open item here. Three candidate answers: (a) all transformation is `exchange-service`, and `data-service` stores what it is given; (b) boundary transformation is `exchange-service`, stream-to-stream transformation is `data-service`'s streaming access mode; (c) transformation is a third service. **(a) is the cheapest and keeps §3's boundary clean**; (b) is closer to what the existing repository does; (c) is probably right eventually and wrong now. This must be answered before phase 3, and it decides whether ADR-0002 moves or is superseded.
- **R-B.** Whether `exchange-service` needs its own design document before phase 3, or whether §5 plus an ADR set is sufficient. Given AE6 is deferred in the technical design's build order, the lighter answer is probably right.
- **R-C.** Whether the split is two repositories or one repository with two deployables. Two repositories match the `identity-service` / `specs-service` pattern and make the trust boundary visible; one repository is cheaper while both are pre-release.
- **R-D.** Who occupies the Sponsor and architect seats for the Assess gate on the platform's own repositories. §3.3 puts the architect's archetype-fit co-signature at O3 and the platform is its own first onboarded application (D39) — but the client-side Sponsor role has no obvious occupant when the client is us.
- **R-E.** Whether `exchange-service` is a saleable product on its own, or only a component. It is the half with the obvious buyer, which argues yes and is not this document's call.

*Inherited:* **T-G** (deployment topology for PS2 and PS7's event shape), **H-B** (whether the series shape and PS6 share an engine), **T-E**.

---

## 12. Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-08-04 | Initial requirements. `event-integration-platform` splits into `data-service` (PS7) and `exchange-service` (AE6), because T19 forbids the PS7-and-AE6 assignment §3.0.1 currently carries. Inventory and destination recorded for every service and package, with the authorizer, observability stack, and JSONata worker dropped against T31, T8, and the repository's own ADR-0002. Twenty-six `data-service` requirements sourced from the PS7 design, eight boundary requirements for `exchange-service`, and seven estate-level requirements. §7 states the honest gap — classification, retention, erasure, lineage, `as_of`, and three of the four shapes do not exist in any form. Seven-phase sequencing with `data-service` started new rather than in place, because mandatory classification cannot be retrofitted onto stored data. Acceptance gates per phase. R-A to R-E opened, with transformation placement (R-A / H-A) named as the item blocking phase 3 |
