# PS7 — Data Service — Service Design

**Status:** Draft v0.4 — for refinement
**Repo:** `maestro/products/data-service`. *(Corrected in v0.4 — this line read `mstr-data` since v0.1 and contradicted the `Name:` line three rows below it, which has said "not its own repository" since v0.2. **It was a plan, not a stale line**: a `Repositories/fps4/mstr-data` directory was created against it. T53 reverses the plan and the empty directory is what remains of it.)*
**Companions:** `conceptual-design.md` (v1.0) is authoritative for *what* and *why*; `technical-design.md` (v1.1) is authoritative for *what we build first, on what, and in what order*; `ps2-record-spine.md` (v0.2) defines the payload boundary this service is the other half of; `ps3-specs-service.md` (v0.1) owns the artifacts whose bodies land here. Where any of them conflict, that order of precedence holds and this document is wrong.
**Scope:** One service. All application data behind one contract — record, document, event, series; streaming and batch — plus schema evolution, temporal history, lineage, retention classification, and erasure. **Not connectors** (T19; AE6 and PS9). **Not telemetry** (PS6). **Not the governance record** (PS2).
**Name:** `data-service`, per **T32**. One deployable in the **maestro monorepo**, under `products/data-service` (§1.3, decided upstream as **T53**) — not its own repository. **Started new, not evolved out of `event-integration-platform`** (**T33**), which is now retired as a candidate entirely.
**Shape:** A full end-to-end service with its own domain, its own console, and SSO through `identity-service` — usable on its own, and composable under maestro as PS7. The same posture `specs-service` takes toward PS3. **That posture is about the service's shape, not about where its code lives** (§1.3).

---

## 1. What PS7 is, in one paragraph

§9's provided row names *data plane and history (all four shapes, streaming and batch)*, and §4.6 names it *data and history*. Both names carry the same two halves, and the second one is the service. A store that holds four shapes is database-as-a-service; what makes PS7 a platform service is that every fact it holds knows where it came from, which schema version it was written under, what classification governs it, and when it must be gone. **PS7 is the one place in the platform where a fact and its obligations are stored together.**

**The one-sentence idea, which the standalone product needs and maestro gets for free:**

> Every fact carries its lineage, its schema version, and its expiry — whatever shape it arrived in, and whichever way it is read back.

That sentence is the test for every feature proposed for this service. Authoring, transformation, connectors, dashboards, and alerting all fail it.

### 1.1 Why eventing and data are one service

**T18, restated because this document is where it becomes concrete.** The application event plane consolidates here rather than living beside PS2:

- **Business events routinely carry personal data**, and T5 places personal data in the data plane under a retention and erasure rule. A separate event hub would therefore need this service's classification, erasure machinery, and schema evolution — so it would either *be* PS7 or a second implementation of PS7's hardest parts.
- **Two schema registries diverge.** §9 names schema evolution as a place things fail catastrophically rather than visibly, and the fastest route there is two registries with different compatibility rules over overlapping types.
- **Lineage that stops at a shape boundary is not lineage.** §4.2 requires traceability in both directions. A fact in a registry and the same fact on a stream belong to one graph, and they only do if one service owns both.
- ***Event* is already one of §8's four shapes.** A separate event store duplicates the taxonomy rather than extending it.

**Streaming and batch are access modes, not services.** Both are modes over the same shapes.

### 1.2 What PS7 is not

| Not | Owner | Why the confusion arises |
|---|---|---|
| Connectors, ingress, egress, delivery | **AE6** with **PS9** | Both move events. T19 keeps them apart: a connector crosses a trust boundary and enforces a capability grant — volume ceiling, value ceiling, approval threshold, reversal path — which is Tier 1 governance, not data. Folding them in is how capability enforcement quietly becomes a data-plane feature |
| Telemetry and metrics | **PS6** | Both are high-volume series. §14.7 makes telemetry substitution **1** and the data plane **last, often never**; fusing them deletes the cheapest rung of every N3 engagement (T18, T23) |
| The governance record | **PS2** | Both are append-only and event-shaped. T5 and T12 separate them on personal data, retention, and mutability |
| Dashboards | Generated (§9) | PS6 supplies the runtime, the composition plane generates the dashboard. PS7 supplies the series it reads |
| The transformation surface | **Open — H-A** | Flink SQL over a stream is arguably an access mode; Flink SQL at an ingress boundary is arguably AE6. §13 does not resolve it |

### 1.3 Where it lives

*Recorded here; decided upstream in **T53** (technical design §3.4). **Corrected in v0.4** — this section cited **T35** for two versions, which is *PS14 added as the fourteenth service*; §16.4 reported the conflict and the decision has now been written under a free number.*

`data-service` is **one deployable in the maestro monorepo**, under `products/data-service`, alongside the platform's other services and a set of shared substrate packages. It is not its own repository, and does not need to be yet: `specs-service` earned one by being derived from **two** consumers — maestro v1 and this rebuild — and this service has one. **The trigger for splitting it out is a consumer that is not maestro** — the same test, applied as a condition rather than assumed in advance. *Note under T42: the rename makes `specs-service`'s two consumers two iterations of one product, so its own trigger is not retrospectively satisfied either; the test below is unchanged and now applies symmetrically to both services.*

H1 is unaffected, because it is a claim about the service's *shape* rather than its git hosting: own domain, own console, own SSO, no dependency on maestro internals. What co-location changes is that those properties must now be **enforced rather than assumed**, because the distance that used to enforce them is gone. Three rules bind this service, and they belong in CI rather than in review:

| Rule | Protects |
|---|---|
| `products/data-service` imports nothing from `services/` | H1 — a product that reaches into maestro internals is not one |
| `data-service` and `record-spine` share only `packages/`, never each other | The **PS2 → PS7 → PS2 cycle**. PS7 already depends on PS2 (§3 of the technical design) and appends `PayloadErased` to it (H8); co-location makes the return edge easy to create by accident and hard to see afterwards |
| `data-service` and `exchange-service` share only declared substrate packages | T19's trust boundary, now enforced by lint rather than by repository distance |

**Five packages are genuinely shared with PS2 and should be extracted deliberately rather than discovered twice:** tenant-handle binding; the explicit tenant→partition map; the type registry with compatibility checking and upcast-on-read; content-addressed blob storage (§3.1); and export packaging.

**That sharing is the whole saving the single repository buys, and it is worth being precise about what it is not.** It is not the audit substrate and the data plane becoming one service — T12 forbids that, the dependency cycle above makes it unbuildable, and a repository boundary was never what prevented it. Shared libraries collapse maintenance; they do not move a plane boundary.

---

## 2. The contract, which is the product

**T19: a caller names a shape and an access mode. It never names a store and never names a vendor.** T22 extends the same rule to the platform's own services, so this binds PS7's callers *and* PS7's own service contract.

| | May name | May never name |
|---|---|---|
| A specification, or any caller | `record` · `document` · `event` · `series`; `batch` · `streaming` | A store, an engine, a vendor, a topic, a table |

**The failure mode this exists to prevent** is stated in the technical design and is worth repeating because it is the likely one: *"an interface that is the union of four products' APIs, owned by nobody."* Deriving the contract from §8's data-shape axis rather than from product categories is what prevents it — and it means **a new shape in §8 is the only thing that may add a store**.

### 2.1 The operations

```
write(shape, collection, payload, classification, schema_ref)   → fact_id, digest
read(shape, collection, selector, as_of?)                       → facts
stream(shape, collection, from)                                 → ordered facts   [event shape]
lineage(fact_id, direction)                                     → graph
classify(fact_id)                                               → classification, retention, expiry
erase(subject_ref | fact_id, lawful_basis, requested_by)        → erasure receipt
schema(register | get | compatibility)                          → schema versions
export(tenant, scope)                                           → portable archive          [P9]
```

Eight operations, and the list is deliberately closed. Every request to add a ninth should be tested against §1's sentence first.

**`classification` is a required argument on `write`, not an optional one.** See §4 — this is the field an implementation will be tempted to default, and defaulting it is unrecoverable.

---

## 3. The four shapes and their engines

**Consolidate the contract; keep the engines separable** (T19). The engines below stay independently operable, independently replaceable, and independently substitutable — which is what §14.7 requires and what a single fused data platform cannot offer.

| Shape | Engine (PoC → MVP) | Primary access | The property that puts it here |
|---|---|---|---|
| **Record** | Postgres → RDS PostgreSQL | batch query, `as_of` | System-versioned history is native; the reference shape for temporal reads |
| **Document** | MongoDB → DocumentDB *(compromise, §12)*; bodies and attachments held as blobs (§3.1) | batch fetch, search | Bulky, schema-loose, referenced far more often than queried |
| **Event** | Kafka (KRaft) → MSK | **streaming** and replay | Ordered, replayable, retention-bounded. The one shape whose history is the stream |
| **Series** | ClickHouse | batch aggregate | Rollups and expiry are first-class; the shape where retention is a storage decision as much as a legal one |

**The event shape is Kafka-native inside and shape-and-mode on the outside.** That is not a hedge — it is the whole reconciliation between a standalone product (where *Kafka-native* is a feature a buyer wants) and PS7 (where T22 forbids a platform service from naming its substrate). Kafka appears in the operations manual, the deployment topology, and the marketing page. It does not appear in the contract, in a specification, or in a stored reference.

**A `ps7://` reference never encodes the engine.** `ps7://business-case/bc-4417@7` resolves through the contract. `ps7://postgres/...` is a defect, because PS2 holds these references immutably for years and an engine change would invalidate the archive.

### 3.1 Blobs — a substrate capability, not a fifth shape

§8's axis has four shapes, and §2 says a new shape is the only thing that may add a store. **A blob is not a fifth shape.** It is bytes that a fact of *any* shape may reference: a document shape's body, a PS3 attachment (image, PDF, site drawing), a large event payload held out of the stream (§5.1), an export package, a series' cold partition. Making it a shape would put a storage mechanism into a taxonomy derived from what applications *are* — which is the drift §2 exists to prevent. So it sits beneath the shapes and has its own rules.

**The object store is S3-API, and that API is the portability surface.** MinIO on the PoC, S3 on the MVP, unchanged code (T21). Handover works because the client can be handed an S3-compatible open equivalent along with the code that runs against it.

#### 3.1.1 Addressing

A blob is addressed **by digest, never by path**:

```yaml
blob_ref:
  uri:        ps7://blob/sha256:9f2c…      # content-addressed
  digest:     sha256:9f2c…
  size:       4812003
  media_type: application/pdf
  encoding:   identity | gzip
```

The physical key — `<tenant-prefix>/<shard>/<digest>` — is never exposed and never stored on a fact. **PS2 holds these references immutably for years** (§3), so a key encoding a bucket, a region, or a layout would turn a storage change into a migration through sealed records.

Content addressing is not a convenience here. **It is the same digest PS2 binds its `payload_ref` with** (§5), so a blob's identity and its audit binding are one value rather than two that can disagree.

#### 3.1.2 Six rules

1. **A blob is never inlined in a fact.** A fact carries a `blob_ref`. This is T25's mechanism one level down, and it is what makes erasure a delete rather than a rewrite.
2. **Dedup is scoped to the tenant prefix, never global.** Cross-tenant content-addressed dedup is a **side channel**: a tenant uploads a guessed byte sequence and learns from the dedup response whether another tenant already holds it. That is a Tier 1 isolation failure (T6) arriving through a storage optimisation — cheap to prevent now, and undetectable afterwards.
3. **The digest is computed and verified server-side on completion.** A client-asserted digest is not a digest. On multipart upload the verification runs at completion, before the blob becomes referenceable at all.
4. **Transfer is by short-lived presigned URL, and the presign is the recorded access.** Bytes never proxy through the service — that is throughput and cost. But a presign is scoped to one object, one method, and minutes; and **the presign is what gets logged**, because the fetch happens at the object store where the service cannot observe it. An unlogged presign against a `personal_data: true` blob is an unrecorded personal-data access.
5. **Lifecycle and tiering are driven by the classification's `expires_at`, never by a bucket policy.** §4.1's rule 2 applied to storage: an operator-typed lifecycle rule is a number nobody can re-derive when the retention rule version changes.
6. **Object Lock, bucket versioning, and server-side encryption are defence in depth, never the mechanism.** T24 says exactly this for PS2's archive and it binds here for the same reason: immutability is enforced at the API by the collection's `immutable` flag (H10), not by a bucket setting an account administrator can change and that does not hand over at exit.

#### 3.1.3 Erasing a blob, which has two traps

**Bucket versioning turns a delete into a delete marker.** With S3 versioning enabled — which the MVP wants anyway for the PS2 archive — a `DELETE` leaves every prior version intact and retrievable. An erasure that issues a plain delete against a versioned bucket **has erased nothing while reporting success**. Erasure must remove all versions of the object, and §5's receipt is only truthful if it does.

**Content addressing makes a blob shareable, and erasure is per subject.** Two facts about two different subjects can reference one blob by digest. Deleting it on the first erasure destroys the second subject's data; not deleting it fails the first erasure. So a blob carries a **reference count within the tenant**, and the object is deleted when the last referencing fact is erased. Until then the receipt reports *retained: referenced by n other facts* — which is a true statement, and an auditable one.

*Whether dedup and reference counting earn their complexity at all, against simply copying per fact, is open — **H-G**.*

**Crypto-shredding stays rejected.** PS2 §8's argument holds unchanged one plane over: destroying a key instead of the bytes puts key management inside the erasure path and makes every historical object unverifiable the day a key is lost. SSE remains defence in depth.

#### 3.1.4 Blobs add no operation to §2.1

`write` accepts and returns a `blob_ref`; `read` returns a presigned URL. **Multipart initiate and complete are the transport mechanics of `write`, not new operations**, and `export` packages blobs alongside facts. Stated explicitly because the obvious next move is to add `upload()` and `download()` to the contract — and H2's closed list is the only thing standing between this service and the union-of-four-products'-APIs failure T19 names.

---

## 4. Classification and retention — the half that makes this a governance service

### 4.1 Classification is mandatory at write

Every write carries a classification. It is validated, never inferred, and never defaulted.

```yaml
classification:
  personal_data:   true
  categories:      [contact, employment]        # from the pack's vocabulary (PS11)
  subject_ref:     prn-8H3M…                    # whose data — a maestro principal id, never a provider sub (T30)
  lawful_basis:    contract
  retention:
    rule:          nl-chain-liability-7y        # a pack-supplied rule, not a duration typed by a caller
    expires_at:    2033-08-04
  erasable:        true                         # false only where a retention obligation overrides erasure
  origin:          ingested | derived | authored | reconstructed
```

**Five rules, enforced at write rather than documented** — deliberately parallel to PS2 §3.1, because this is the same class of unretrofittable field:

1. **A write without a classification is rejected.** Not warned, not defaulted to `personal_data: false`. A default here is a silent Tier 1 violation that surfaces years later at a subject access request.
2. **`retention.rule` names a pack rule; `expires_at` is derived from it, never typed by a caller.** §5.7 derives deadlines from `effective_from` for the same reason: a hand-entered date is a number nobody can re-derive when the rule changes.
3. **`personal_data: true` requires `subject_ref` and `lawful_basis`.** Erasure is per subject, so personal data with no subject reference is personal data that cannot be erased.
4. **`erasable: false` requires a named overriding obligation.** A retention obligation can outrank an erasure request; an implementation convenience cannot.
5. **`origin` distinguishes `reconstructed`**, matching PS3's S5 and §14.3 — an onboarded application's backfilled data is legitimate and must be visibly so.

### 4.2 Why this cannot be retrofitted

PS2 §2.1 argues that every conformance record produced before the record spine exists is permanently weaker. **The same argument applies here and is the reason classification is build step 1 rather than step 4.** Data written without a classification is not merely unclassified — it is *unclassifiable*, because the lawful basis and the subject were known at write time and are not recoverable from the bytes afterwards. A backfill guesses, and a guessed lawful basis is worse than none.

**This is the single most important sentence in this document for build sequencing:** ship the classification envelope before the first byte of application data, on every shape, even where the shape is a demo.

### 4.3 Classification vocabulary is pack content, not code

Categories, retention rules, and lawful bases are domain knowledge — `nl-chain-liability-7y` is Dutch construction, not platform. §16's rule binds: core carries zero domain knowledge, so the vocabulary lives in **PS11** and PS7 validates against the pack version in force. Until PS11 exists, PS7 carries a minimal built-in vocabulary marked explicitly as a placeholder with no effective dating — which is T7's rule applied one service along.

---

## 5. Erasure — the other half of T25

PS2 §8 states the rule: *erasure is recorded as an event; it is never performed on events.* PS7 is where the deletion actually happens, and the two designs only work as a pair.

```
┌─ PS2 ─────────────────────────────┐        ┌─ PS7 ────────────────────────┐
│ envelope + structural body        │───────▶│ payload under retention      │
│ immutable, multi-year, no PII     │  ref   │ classified, erasable         │
│ payload_digest binds the bytes    │ digest │                              │
└───────────────────────────────────┘        └──────────────────────────────┘
        after erasure: digest remains, envelope remains, payload is gone
```

**The sequence:**

1. `erase(subject_ref, lawful_basis, requested_by)` resolves every fact in the tenant carrying that `subject_ref`, across all four shapes.
2. Facts with `erasable: false` are reported, not silently skipped — with the overriding obligation named. **A partial erasure that reads as a complete one is the failure mode here.**
3. Erasable payloads are deleted. The event shape is the hard case (§5.1) and blobs are the trap-laden one (§3.1.3).
4. PS7 appends `PayloadErased { subject, payload_ref, payload_digest, lawful_basis, requested_by, executed_at }` to PS2 for each erased fact under a PS2 reference.
5. The caller receives an **erasure receipt** enumerating what was erased, what was retained, and under which obligation. The receipt is itself an audit artifact and is what a subject access response is built from.

**PS7 is therefore a writer into PS2**, which PS2 §9 already permits — `append` is API-only and service-to-service, authenticated as a PS1 principal. It is the C4 container diagram's prose note that is now incomplete, not PS2's design. Recorded in §16.

### 5.1 Erasure and the event shape

A Kafka topic does not support deleting one record. Three mechanisms, and the choice is per collection, declared at creation:

| Mechanism | How | When it is right |
|---|---|---|
| **Compaction on subject key** | Key by `subject_ref`; erasure writes a tombstone | The collection is genuinely keyed by subject and history-per-key is not needed |
| **Reference, not payload** | The stream carries the envelope and a `ps7://` reference to a record- or document-shape payload; erasing the payload erases the stream's content | **The default.** It is T25's mechanism applied within PS7 rather than only across the PS2 boundary |
| **Retention shorter than the erasure SLA** | The stream expires before an erasure request could arrive | Only for genuinely transient collections, and it must be *declared*, not noticed |

**The default is the second**, and it is stated as a design rule rather than a tuning option: a stream that inlines personal data has made erasure a compaction problem, and compaction is a best-effort background process that no GDPR response should depend on.

---

## 6. Schema evolution — the actual payoff of the merge

§9 names schema evolution as a place things fail catastrophically rather than visibly. One registry across four shapes is the single biggest reason T18 consolidated eventing into the data plane.

**One registry, one type namespace, per-shape compatibility policy.**

| | Event shape | Record, document, series |
|---|---|---|
| Stored bytes | **Immutable.** The stream is the history | Mutable under a recorded migration |
| Evolution | Backward-compatible only; **upcast on read** | Backward-compatible, or migrate |
| Breaking change | **A new type**, never a new version | A new type, or a migration recorded as a lineage event |
| Who translates | The reader | The migration, once |

**Shared across all four:** an unregistered type or an incompatible version is a **rejected write**. The registry is the gate, exactly as in PS2 §7.

**Where PS7 differs from PS2, and it matters:** PS2 cannot migrate, because its stored bytes *are* the audit record and the digest chain makes a rewrite detectable by design. PS7 can, for three of its four shapes — but a migration is a lineage event with a recorded `migrated_from`, never a silent `ALTER`. The distinction is why the two services can share a schema *discipline* without sharing a registry implementation.

---

## 7. Temporal history and `as_of`

`read(..., as_of: t)` returns the state as it stood at `t`, for the record and document shapes. The event shape answers the same question by replay; the series shape answers it natively.

**This is not a convenience feature.** §4.2 requires traceability in both directions and §5.8 requires a conformance record covering *which standards applied over which period, with what evidence*. An assurance re-evaluation asking *what did this application's data look like when the gate decided* has no answer without `as_of`, and PS12 would otherwise have to snapshot everything it might later need — which is a second copy of the data plane with a worse retention story.

---

## 8. Lineage

**Lineage that stops at a shape boundary is not lineage.** One graph across all four shapes, with typed edges:

| Edge | Meaning | Written by |
|---|---|---|
| `ingested_from` | Entered the platform at a boundary | **AE6**, at the exchange boundary — the one edge PS7 does not author |
| `derived_from` | Computed or transformed from another fact | Whatever performed the derivation |
| `projected_from` | A read model over another shape | The projection |
| `migrated_from` | A schema migration moved these bytes | PS7 |
| `erased` | The payload is gone; the node remains | PS7 |

**`ingested_from` is the seam with AE6 and is a hard requirement on the exchange service**, not a nice-to-have: without it, everything the platform knows about a fact begins after it arrived, and *where did this number come from* — the question a conformance record exists to answer — stops at the ingress. This is the single most important interface between the two services that come out of the `event-integration-platform` refactor.

**The `erased` node is deliberately not deleted.** Lineage after erasure must still show that a fact existed, was used to derive something, and is now gone — which is the same property PS2's retained digest gives the audit chain.

---

## 9. What PS7 holds for the platform itself

**T25.** The personal-data-bearing and free-text fields of every PS3 artifact live here, referenced by digest from PS2. That is not a widening of the remit — it is the retention-and-erasure rule PS7 already applies, applied to the one artifact class that would otherwise force personal data into the audit substrate.

It does create **two write disciplines in one service**, and conflating them would be a defect:

| | Application data | Platform artifact bodies (T25) |
|---|---|---|
| Written by | Generated applications, AE6 | PS3 |
| Mutability | Ordinary — updates, deletes under classification | **Write-once, content-addressed.** A version's body never changes |
| Referenced by | Other application data | **PS2, immutably, by digest, for years** |
| Erasure | Per subject, ordinary | Per subject, and the digest survives in PS2 (§5) |

**The discipline is a property of the collection, declared at creation, not of the caller.** A collection marked `immutable` rejects an update at the API, which is what makes PS2's digest binding a guarantee rather than a convention.

### 9.1 P13 does not bind PS7 writes, and this needs saying

T17 requires every service to expose UI, API, and MCP, and states that *every write proposes and only PS4 accepts*. **That rule binds writes to the chain of record. It does not bind application data**, and reading it as though it did would make a timesheet entry a governed proposal.

The boundary is exact: **a write to an `immutable` collection under §9 is part of the chain of record and reaches PS7 only via PS3, which has already proposed it.** Everything else is application data and is an ordinary write. PS7 itself accepts nothing and gates nothing — it has no propose/accept semantics, for the same reason PS2 has none (PS2 §6.3).

---

## 10. Tenancy

Per technical design §2.2 and §3.3.2 — isolation is topological, enforced by binding a tenant-scoped handle once per request, never by filtering (T6, T28).

| Shape | Logical level (L1) | Physical level (L2) |
|---|---|---|
| Record | Schema per tenant, per-tenant role, `search_path` | Own RDS instance |
| Document | Database per tenant, scoped credential | Own cluster |
| Event | **Exclusive topic per tenant** (see below) | Own cluster |
| Series | Database per tenant | Own instance |
| Blobs (§3.1) | Prefix per tenant, prefix-scoped credential, **dedup scoped to the prefix** | Own bucket |

**The event shape's topology differs deliberately from PS2's.** PS2 uses an exclusive *partition* per tenant because strict per-tenant ordering makes its hash chain a rolling computation, and it can afford that because its volume is tiny by construction. PS7 carries business volume, needs partition parallelism *within* a tenant, and has no chain to compute — so it takes a topic per tenant with a tenant-chosen partition count. **Copying PS2 §4's model here would cap every tenant's throughput at one partition**, which is the kind of thing that is discovered under load rather than in review.

The tenant→topic map is explicit and stored, never hash-derived — same rule as PS2 §4.1, same reason: a hot tenant must be movable and the partition count must be changeable.

---

## 11. Interfaces

Per T17: UI, API, and MCP — with two constraints.

| Operation | Surface | Notes |
|---|---|---|
| `write` | API | Service-to-service and application-to-service. Classification required |
| `read`, `stream`, `as_of` | API, MCP, UI | Broad reads, tenant-scoped by binding |
| `lineage`, `classify` | API, MCP, UI | First-class. *Where did this come from and what governs it* is the product |
| `schema` | API, MCP, UI | Register, inspect, check compatibility |
| `erase` | **API only** | Never MCP. §11.1 |
| `export` | API | P9's exit deliverable, built in the first wave |

### 11.1 MCP reads and never erases

The parallel with PS2's R11 is exact. Erasure is irreversible, requires a lawful basis and a named requester, and above a consequence class should itself be a governed decision. Exposing it to an agent over MCP puts an irreversible privacy-affecting act behind the interface designed for broad read access. **MCP exposes read, lineage, classification, schema, and `as_of` — never `write`, never `erase`.**

*Whether `erase` above a consequence class requires a PS4 gate is open — H-D.*

### 11.2 The console

The standalone product needs one and maestro benefits from it: browse collections by shape; inspect a fact's classification, schema version, and lineage graph; run an erasure and read the receipt; inspect and evolve schemas. It is an operator and steward surface, not an authoring surface — nothing in it creates application data.

---

## 12. Substrate

| | PoC (Docker) | MVP (K8s + AWS) | Handover |
|---|---|---|---|
| Record | Postgres | **RDS PostgreSQL** | Open-code |
| Document | MongoDB | **DocumentDB** *(compromise)* | Partial — see below |
| Event | Kafka, KRaft, single broker | **MSK** | Kafka API |
| Series | ClickHouse | ClickHouse on EKS or ClickHouse Cloud | Open-code |
| **Blobs** (§3.1) | MinIO | **S3** — versioning on, Object Lock and SSE as defence in depth only (T24) | **S3 API** |
| Schema registry | Open-source registry | Same, self-hosted | Open-code |

**Every entry is a hosted build of an open component** (T21), which is what keeps §13.5's handover honest. **DocumentDB is the one genuine compromise** and the technical design already marks it: MongoDB compatibility is partial, so the handover claim is weaker here than for RDS. If the document shape needs what DocumentDB does not implement, self-hosting is the fallback — and that belongs in the decision now rather than in an incident later.

**Ruled out, with the shape each would otherwise obviously serve:** DynamoDB (record), EventBridge and Kinesis (event), Timestream (series). Each is a reasonable engineering choice and each ends the exit promise (T21). EventBridge additionally fuses PS2 and PS7, which T12 says destroys the audit substrate (T23).

---

## 13. Build order and gates

Shapes arrive as the archetypes that need them arrive (§5.3). **Classification comes before all of them** (§4.2).

| # | Step | Gate |
|---|---|---|
| 1 | **Classification envelope, retention rules, schema registry, the contract, the blob store** | A write with no classification is rejected on every shape. A `personal_data: true` write with no `subject_ref` is rejected. `expires_at` is derived from a rule and recomputes when the rule version changes. A blob round-trips by digest with server-side verification, and an identical blob uploaded under two tenants produces two objects (§3.1.2 rule 2) |
| 2 | **Record shape**, batch mode, `as_of`, tenancy by binding | A tenant-scoped handle cannot read another tenant's schema by any query. `as_of` returns yesterday's state after two updates today |
| 3 | **Series shape**, rollups, expiry | An outcome metric (§10.5) is written, aggregated, and expires on its retention rule |
| 4 | **Erasure and the receipt**, `PayloadErased` into PS2 | A subject is erased across record, series, and blobs; the receipt names what was retained and why; **an erased blob is gone from a versioned bucket, not merely delete-markered** (§3.1.3); PS2 still verifies and still shows the digest |
| 5 | **Lineage graph**, `derived_from`, `projected_from`, `migrated_from` | A derived fact resolves back to its source across a shape boundary; an erased node remains in the graph |
| 6 | **Document shape**, content-addressed bodies, immutable collections (T25) | PS3 stores a specification body; PS2 holds the digest; the body cannot be updated in place |
| 7 | **Event shape**, streaming mode, topic per tenant, `ingested_from` from AE6 | A stream carries a reference rather than an inlined payload by default; erasure of the referenced payload empties the stream's content; the ingress edge resolves |
| 8 | **`export`** | A third party reconstructs a tenant's data, classifications, schemas, and lineage from the export alone (P9) |

**Steps 1–4 are the standalone product's first release and maestro's first wave.** The technical design marks PS7 as *◐ record + series* in the first wave, which means **the event shape is not on maestro's critical path** — it arrives with AE6 in step 7. That is what makes it safe to build this product-first rather than platform-first, and it is the strongest scheduling argument for the refactor happening now rather than under demo pressure.

**The blob store lands in step 1 rather than with the document shape**, even though the document shape is step 6. Two reasons: `packages/cas` is shared with PS2's archive (§1.3), and PS2's sealer needs it at *its* build step 3 — well before PS7 has a document; and a blob store retrofitted after facts exist inherits the same problem §4.2 describes, because dedup scoping and digest verification are properties of every object ever written, not of new ones.

**`export` at step 8 is built, not promised.** PS2 R12's argument transfers verbatim: an exit path first exercised at exit is not a capability.

---

## 14. Failure modes

| Failure | Detection | Response |
|---|---|---|
| **A write defaults its classification** | Contract test on every shape; a rejected-write counter that should never be zero in staging | Hard failure at the API. §4.2 — this is the unrecoverable one |
| Personal data inlined on a stream | Classification says `personal_data: true` on an `event`-shape collection with no `ps7://` reference | Blocked at collection creation, not at write. §5.1 |
| Partial erasure reads as complete | Receipt enumerates retained facts with the overriding obligation | The receipt is the control. An erasure API that returns `204` is the defect |
| `expires_at` drifts from a changed rule | Recompute on pack publication (PS11 → PS12) | Re-derive; a hand-entered date cannot be re-derived, which is why rule 2 exists |
| Two registries appear | One type namespace; a second registry is a review failure, not a runtime one | The whole argument for T18 collapses quietly here |
| A `ps7://` reference names an engine | Reference format validation at write | Reject. PS2 holds these immutably for years (§3) |
| Lineage graph gaps at the ingress | `ingested_from` coverage over facts whose `origin` is `ingested` | An AE6 defect, detected here. §8 |
| The contract grows into a union of four APIs | Any operation outside §2.1's eight | Test it against §1's sentence. This is the slow failure T19 names |
| Tenant filter appears in a query path | Code review plus a per-tenant role that makes the filter unnecessary | Tier 1 violation (T6) |
| **An erased blob survives as a prior version** | Post-erasure probe for any version of the object, run as part of the erasure job | The receipt is false until this passes. §3.1.3 — the most likely silent GDPR failure in the whole design |
| Blob dedup crosses a tenant prefix | Upload the same bytes under two tenants and assert two objects (build gate 1) | Tier 1 isolation via a storage optimisation. §3.1.2 rule 2 |
| Object Lock used as the immutability mechanism | An `immutable` collection must reject an update at the API with Object Lock switched off | T24. A bucket setting does not hand over and can be changed by an account administrator |
| A presigned URL issued without a logged access | Presign count reconciled against access-log entries for `personal_data: true` blobs | The presign is the record (§3.1.2 rule 4); the fetch is invisible to the service |
| `products/data-service` imports from `services/` | CI import rule (§1.3) | H1 — the co-location cost. Caught by lint or not at all |

---

## 15. Decisions

| # | Decision | Rationale |
|---|---|---|
| H1 | **PS7 is realised as `data-service` — a standalone product with its own domain and console, composable under maestro as PS7** | The specs-service posture. §13.5 hands platform services over at exit, and a service that is independently viable hands over as a product rather than as a pile of maestro-shaped code. It also makes the event shape's schedule independent of maestro's first wave (§13) |
| H2 | **The contract binds shape and access mode, and closes at eight operations** | T19 and T22. The stated failure mode is an interface that is the union of four products' APIs; a closed operation list plus §1's sentence is the only defence that survives feature pressure |
| H3 | **Kafka-native inside, shape-and-mode outside; a `ps7://` reference never encodes the engine** | Reconciles a standalone product that sells *Kafka-native* with T22, which forbids a platform service from naming its substrate. PS2 holds these references immutably for years, so an engine change must not invalidate the archive |
| H4 | **Classification is mandatory at write, with `retention.rule` naming a pack rule and `expires_at` derived from it** | §4.2 — data written without a classification is unclassifiable, not merely unclassified. This is PS2 R1's argument on a different field, and it is why classification is build step 1 |
| H5 | **`personal_data: true` requires `subject_ref` and `lawful_basis`; `erasable: false` requires a named overriding obligation** | Erasure is per subject; personal data with no subject reference cannot be erased. An implementation convenience must not be able to make data permanent |
| H6 | **Classification vocabulary is pack content (PS11), not code; PS7 ships a placeholder marked as one until PS11 exists** | §16 — core carries zero domain knowledge, and `nl-chain-liability-7y` is domain knowledge. T7's rule applied one service along |
| H7 | **On the event shape, the default is a reference to a payload rather than an inlined one** | Erasure on a stream otherwise becomes a compaction problem, and compaction is best-effort background work no GDPR response should depend on. T25's mechanism applied within PS7 |
| H8 | **PS7 appends `PayloadErased` to PS2 and returns an erasure receipt enumerating what was retained and why** | PS2 §8 requires erasure to be recorded as an event and PS2 §9 already permits service-to-service append. A partial erasure that reads as complete is the failure mode, and the receipt is the only control against it |
| H9 | **One schema registry and one type namespace across all four shapes, with per-shape compatibility policy** | The largest single payoff of T18's consolidation. §9 names schema evolution as a catastrophic-failure surface, and two registries over overlapping types is the fastest route to it |
| H10 | **Collections are `mutable` or `immutable` at creation; T25 artifact bodies are `immutable` and content-addressed** | Two write disciplines in one service must be a property of the collection, enforced at the API, or PS2's digest binding is a convention rather than a guarantee |
| H11 | **P13 does not bind PS7 writes; PS7 has no propose/accept semantics** | T17's rule binds the chain of record, not application data. Chain-of-record writes reach PS7 only through PS3, which has already proposed them. PS2 §6.3's argument, one plane over |
| H12 | **The event shape uses an exclusive topic per tenant with a tenant-chosen partition count — not PS2's exclusive-partition model** | PS2 buys per-tenant ordering for a hash chain at tiny volume. PS7 carries business volume and needs partition parallelism within a tenant; copying PS2's model caps every tenant at one partition |
| H13 | **`ingested_from` is a hard requirement on AE6, not an optional enrichment** | Lineage that begins after arrival cannot answer *where did this number come from*, which is the question a conformance record exists to answer. It is the load-bearing interface of the `event-integration-platform` split |
| H14 | **MCP exposes read, lineage, classification, schema and `as_of` — never `write`, never `erase`** | PS2 R11's argument. Erasure is irreversible and privacy-affecting; it does not belong behind the broad-read interface |
| H15 | **`export` is built in step 8 of the first build, not at exit** | PS2 R12 verbatim. §13.5's exit promise is contractual and a path first exercised at exit is a promise, not a capability |
| H16 | **A blob is a substrate capability beneath the shapes, not a fifth shape: content-addressed, never inlined in a fact, dedup scoped to the tenant prefix, and transferred by short-lived presigned URL** | §8's axis has four shapes and §2 makes a new shape the only thing that may add a store, so a storage mechanism must not enter the taxonomy. Content addressing makes the blob's identity and its PS2 audit binding one value. Prefix-scoped dedup closes a cross-tenant existence side channel that is a Tier 1 failure and is undetectable after the fact |
| H17 | **Erasure of a blob removes every version, and a shared blob is reference-counted within the tenant rather than deleted on first erasure** | Two silent failures otherwise: a `DELETE` against a versioned bucket erases nothing while reporting success, and deleting a deduped blob destroys another subject's data. The receipt in H8 is only truthful if both are handled |
| H18 | **Object Lock, bucket versioning, and SSE are defence in depth; immutability is enforced at the API and erasure is deletion, never key destruction** | T24 for the archive, applied to blobs. A bucket setting does not hand over at exit and an account administrator can change it. PS2 §8's rejection of crypto-shredding holds one plane over |
| H19 | **`data-service` is one deployable in the maestro monorepo, and H1's product properties are enforced by CI import rules rather than by repository distance** | **T53** upstream *(cited as T35 through v0.3 — see §16.4)*. `specs-service` earned its own repository from two consumers — maestro v1 and this rebuild (T42) — and this service has one, so the split-out trigger is a consumer that is not maestro, unsatisfied for both. Co-location is what makes the PS2 → PS7 → PS2 cycle easy to create by accident, so the rules are lint, not review (§1.3) |

---

## 16. Changes required elsewhere

Recorded rather than made, per this repository's precedence convention.

**16.1 `ps2-record-spine.md` — no design change, one clarification.** §9's append table already permits service-to-service append, so PS7 appending `PayloadErased` is consistent with PS2 as written. Worth making explicit in a future v0.3 that **PS7 is a named appender for the Custody group**, because §6.3 and R11 are written as though PS3 and PS4 are the only writers and a reader will infer that.

**16.2 `c4-diagrams.md` — §3's prose note is now incomplete.** *"Nothing writes to it except through PS3 and PS4, and PS13"* omits PS7. Updated in that document's v0.2, which is legitimate because the diagrams are explicitly derived and never authoritative.

**16.3 Conceptual design §4.6 — a platform service may be an independently viable product.** §4.6 says platform services are *never generated, identical for every tenant*, and D39 adds that they are onboarded onto themselves. Neither anticipates a platform service with its own consumers outside maestro, which is now true of `identity-service`, `specs-service`, and `data-service`. Suggested addition: *a platform service may be an independently viable product with consumers outside the platform; this strengthens P9 rather than complicating it, because a service with its own users hands over as a product rather than as an extraction.* Carried into technical design §11.6 for writing there.

**16.4 ✅ Made in technical design v1.1 as §3.4 and T53.** The topology is now written upstream, with the numbering conflict resolved in this document's favour rather than by renumbering T35: the decision took the next free number. Two of the four import rules this section asked for were written as named; the third and fourth were extended — `packages/chain-verifier` gained an explicit rule (T24, P9) and a fifth was added for D20's export boundary. **PS2's placement was settled at the same time and settled harder than requested**: not merely co-located, but the one service that could never earn a repository, because its genericity would cost P12 (PS2 §1.2, R14). *The original text follows, retained because a resolved request records what was owed and by whom.*

**~~T35 is referenced here and not yet written there.~~** §1.3 and H19 record a repository topology this document does not own: one maestro monorepo holding the platform-internal services, `data-service`, `exchange-service`, and the shared packages, with `identity-service` and `specs-service` staying outside because maestro consumes rather than builds them. It needs writing upstream, together with the four CI import rules — three of which bind this service (§1.3) and the fourth of which protects PS2's verifier package from acquiring maestro dependencies (PS2 §5.4, P9). **It cannot be written as T35, which this document and `ps15-agent-service.md` §15.2 both cite for it: the technical design already assigns T35 to *PS14 added as the fourteenth service*.** The next free number there is T43. **Until it exists under some number, §1.3 is this document citing a decision its companion has not recorded**, which is the inversion the precedence rule exists to prevent.

---

## 17. Open

- **H-A.** **Where transformation lives.** Flink SQL over a PS7 stream is arguably the streaming access mode; Flink SQL at an ingress boundary is arguably AE6. Nothing in the design distinguishes the two cases, and the boundary decides how much of this service the streaming access mode is. *No longer a refactor question — `event-integration-platform` is retired, so there is no inherited transformation layer to place. Carried upstream as **T-P**.*
- **H-B.** Whether the series shape and PS6 share an engine. Both want columnar storage and both expire. §14.7 says they must remain separately substitutable (T18), which constrains the deployment but may not forbid a shared engine — and the answer bears on T-E.
- **H-C.** Whether `as_of` is offered on the event shape at all, or whether replay is the only answer there. Offering both invites a caller to treat a stream as a table.
- **H-D.** Whether `erase` above a consequence class is itself a PS4 gate. It is irreversible and privacy-affecting, which argues yes; it is also a data-subject right the platform must not obstruct, which argues no. The likely answer is that *refusing* an erasure needs a gate and performing one does not.
- **H-E.** Whether the document shape's search is PS7's or is left to the caller. Search is where a data service grows into a product it did not intend to be, and §1's sentence does not obviously cover it.
- **H-F.** Retention of the event shape's streams, independent of the classification's `expires_at`. A stream's retention is an operational parameter and a classification's expiry is a legal one; they interact and are not the same number.
- **H-G.** Whether blob dedup and reference counting earn their complexity, against simply copying per fact. Dedup saves storage on the case that actually occurs — the same drawing attached to twenty observations — but it buys a refcount that has to stay correct across erasure, export, and migration, and a refcount that drifts is a blob that is either leaked or destroyed early. Copy-per-fact is dumber and has no correctness surface. Decide before build step 1, because it is a property of every object ever written (§3.1.3).
- **H-H.** Whether the classification attaches to the blob or only to the referencing fact. Attaching to the fact is what makes refcounted erasure coherent; attaching to the blob is what would let a blob be scanned for policy without resolving its referrers. They may both be needed, and if so the two must not be allowed to disagree.

*Inherited:* **T-G** (whether PS2 and PS7's event shape share a cluster — the service boundary is settled by T18, the deployment topology is not; §10 above narrows it further by giving the two different topologies), **T-E** (telemetry storage, via H-B), **T16** (offline tolerance is a PS7 design input now, though AE7 is built last — not yet addressed in this document and it should be before step 2).

---

## 18. Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-08-04 | Initial design. PS7 realised as a standalone `data-service` (H1), with the contract closed at eight operations binding shape and access mode (H2) and Kafka held inside the implementation rather than in the contract (H3). **Classification made mandatory at write and placed first in the build order** as the unretrofittable field (H4–H6), with the pack-supplied vocabulary deferred to PS11. Erasure designed as the other half of T25 — reference-not-inline as the event-shape default (H7), `PayloadErased` appended to PS2, and an erasure receipt enumerating retentions (H8). One schema registry across four shapes recorded as the payoff of T18's consolidation (H9). Two write disciplines separated by collection immutability (H10) and P13 held not to bind application-data writes (H11). Event-shape tenancy separated from PS2's model to avoid a one-partition throughput cap (H12). `ingested_from` made a hard requirement on AE6 as the load-bearing interface of the `event-integration-platform` split (H13). MCP read-only with respect to writes and erasure (H14); first-wave `export` (H15). Build order in eight gated steps, with steps 1–4 covering maestro's *◐ record + series* first wave and the event shape arriving with AE6. H-A to H-F opened; §16 records the changes this design requires in PS2, the C4 diagrams, and the conceptual design |
| 0.2 | 2026-08-04 | **§3.1 added — blobs as a substrate capability beneath the shapes rather than a fifth shape** (H16), on an S3-API store that is the portability surface. Content-addressed by digest with the physical key never exposed, since PS2 holds these references immutably for years; the digest is the same value PS2 binds its `payload_ref` with. Six rules, of which two are new findings: **dedup is scoped to the tenant prefix** because cross-tenant content-addressed dedup is an existence side channel and therefore a Tier 1 isolation failure arriving through a storage optimisation, and **the presign is the recorded access** because the fetch happens where the service cannot observe it. §3.1.3 records the two erasure traps (H17): a `DELETE` against a versioned bucket erases nothing while reporting success, and a deduped blob deleted on first erasure destroys another subject's data — so erasure removes every version and a shared blob is reference-counted within the tenant. Object Lock, versioning, and SSE held to defence in depth with immutability enforced at the API and crypto-shredding still rejected (H18, T24). §3.1.4 states that blobs add no ninth operation, since multipart is transport mechanics of `write`. Blob store moved into build step 1 rather than arriving with the document shape, because `packages/cas` is shared with PS2's sealer and because dedup scoping is a property of every object ever written. **§1.3 added — repository placement** (H19): one deployable in the maestro monorepo under `products/data-service`, with the split-out trigger stated as *a consumer that is not maestro*, and H1's product properties moved from repository distance onto three CI import rules — the sharpest of which guards the PS2 → PS7 → PS2 cycle that co-location makes easy to create by accident. Five shared packages named. Five failure modes and H-G, H-H added. §16.4 records that **T35 is cited here and not yet written in the technical design**, along with the `R-C` and `ES-1` revisions it forces |
| 0.4 | 2026-08-06 | **The `Repo:` header line corrected from `mstr-data`**, which it has read since v0.1 while the `Name:` line three rows below it has said *not its own repository* since v0.2 — a contradiction inside one header block, surviving four versions and two reviews, which is a smaller instance of exactly what §16.4 was reporting. **Recorded correctly on the second attempt: it was a *plan*, not a stale line.** An empty `mstr-data` directory exists on disk, created against the header rather than against §1.3, so the two halves of the header were two live intentions rather than one typo and one truth — which is a worse defect than the one first written down here, and the reason T53 had to be a rule rather than a placement. **§16.4 closed — the repository topology is written upstream as technical design §3.4 and T53**, and the numbering conflict resolved in this document's favour: the decision took the next free number rather than renumbering T35, so §1.3 and H19 are corrected in place and no longer cite a decision that means something else. Two of the four import rules this document asked for were written as named; a rule protecting `packages/chain-verifier` from maestro dependencies was added explicitly (T24, P9), and a fifth added for D20's export boundary. **PS2's placement was settled harder than this document requested** — not co-located pending a trigger, but the one service that could never earn a repository, since its genericity would cost P12 (PS2 §1.2, R14). The split-out trigger for `data-service` is unchanged and still unmet. No shape, contract, wave, or dependency changed |
| 0.3 | 2026-08-05 | **Renamed to `maestro` throughout** (conceptual D44) — filenames, cross-references, and identifiers, with the `adel-` prefix dropped. **T42 recorded from upstream** in §1.3 and H19: `specs-service`'s two consumers are two iterations of one product, so its own split-out trigger was not retrospectively satisfied either, and **the trigger — a consumer that is not maestro — now applies symmetrically to both services**. This strengthens rather than weakens §1.3's position: the test was already written as a condition rather than an assumption, and it stays unmet for the same reason here as there. The stale `ps1-identity.md` and `ps3-specification-service.md` companion references corrected. No shape, wave, or dependency changed |
