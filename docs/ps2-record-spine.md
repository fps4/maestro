# PS2 — Record Spine — Service Design

**Status:** Draft v0.2 — for refinement
**Companions:** `conceptual-design.md` (v0.8) is authoritative for *what* and *why*; `technical-design.md` (v0.5) is authoritative for *what we build first, on what, and in what order*; `ps1-identity-service.md` (v0.1) holds the principal model this service records against. Where any of them conflict, that order of precedence holds and this document is wrong.
**Scope:** One service. The append-only governance event log, the durable archive, the integrity chain, and the projection contract. Not the projections' own contents — those belong to the services that own them (PS3, PS4, PS12).
**Why this one:** PS2 is the second service in the build order and the first that cannot be retrofitted (§2.1). Every conformance record produced before it exists is permanently weaker.

---

## 1. What PS2 is, in one paragraph

The chain of record in §4.2 — opportunity, business case, specification, application, conformance record — is described there as a set of artifacts with versions, lineage, and diffs. It is one append-only stream and several projections, not five stores kept consistent with each other (T4). PS2 is that stream, the durable archive it feeds, and the guarantee that what was written can be shown years later to be what was written. Everything else in §3 reads from it.

**What makes PS2 affordable is that its traffic is tiny by construction.** It carries decisions, not business data. A tenant produces governance events in the hundreds or low thousands per day, not the millions — business volume lives in PS7. That is the fact that makes strict single-writer ordering, a per-tenant hash chain, and full replay cheap here and impossible one plane over. **If PS2's volume ever looks like PS7's, something has leaked across the boundary in §4.2 and the fix is upstream, not here.**

### 1.1 What PS2 is not

| Not | Owner | Why the confusion arises |
|---|---|---|
| Application data | PS7 | Both are event-shaped; T5 and T12 separate them on personal data, retention, and mutability |
| Telemetry | PS6 | Both are high-volume append streams; PS6 stays separate for §14.7's substitution order (T18) |
| The conformance record | PS12 | v0.3 listed it as a PS2 projection. A projection can replay; it cannot re-evaluate against a new pack version or produce an attestation |
| Pack storage | PS11 | Pack *publication* is an event here; the pack is not |
| The gate | PS4 | PS2 records that a gate decided; it does not decide, and it has no propose/accept semantics of its own (§6.3) |

---

## 2. Two prerequisites, one of which is not yet decided

**2.1 PS1's principal model (T2, T30, T31).** Every event carries attributions that must be separately resolvable: the accountable human, the acting principal, and the seat. An agent must be a first-class principal, distinct from the human accountable for its seat and from the service account it runs under. **PS2 cannot record what PS1 cannot distinguish**, and events written against a weaker model are the exact artifact §2.1 of the technical design says cannot be repaired later.

**Every principal reference in an event is a maestro principal id, never an identity provider's `sub`** (R13). A local subject is minted per `identity-service` deployment, so moving a tenant between deployment models re-mints it — against records that are immutable and retained for years. The registry indirection lives in PS1 (`ps1-identity-service.md`); PS2's obligation is simply never to accept anything else in an attribution field.

**2.2 The tenancy partition — settled.** T-L closed in technical design v0.5 (§3.3): logical isolation between tenants by default, physical between deployments by choice, enforced by binding a tenant-scoped handle rather than by filtering. **§4 is PS2's realisation of the logical level**, and the same design runs unchanged at the physical level with one cluster per tenant instead of one partition.

---

## 3. The event

### 3.1 Envelope

Modelled the way §5.5 models a standard: the object is the specification.

```yaml
event:
  # identity and ordering
  event_id:          01J9F2K7QH…          # UUIDv7 — time-ordered, globally unique
  tenant_id:         tnt-aannemer-x       # never null, never inferred from context
  tenant_seq:        148203               # monotonic per tenant; the chain ordinal
  subject_type:      business_case        # the aggregate this event is about
  subject_id:        bc-4417
  subject_seq:       7                    # monotonic per subject; optimistic concurrency

  # what happened
  type:              BusinessCaseAccepted
  type_version:      2
  occurred_at:       2026-08-03T09:14:22Z       # when the act happened
  recorded_at:       2026-08-03T09:14:22.418Z   # when PS2 durably held it

  # attribution — all four required; rejected at append if absent (§12.4, P12)
  accountable:       usr-j-dekker         # the named human answerable — never an agent
  acting:            agt-case-shaper-3    # who or what performed the act
  seat:              case_shaping         # the seat occupied (§3.3)
  oversight_level:   O2                   # in force at the time, not current

  # governance context
  consequence_class: c3                   # assigned at Explore (§10.2); drives proportionality
  gate:              explore              # present only on gate decisions

  # lineage, traceable in both directions (§4.2)
  causation_id:      01J9F2K5…            # the event that caused this one
  correlation_id:    01J9F2J1…            # the thread of activity
  supersedes:        01J9EZ4B…            # monotonic versioning; never an edit

  # the payload boundary (T5, T25)
  body:              { outcome: accepted, conditions: [] }   # structural, non-personal, inline
  payload_ref:       ps7://business-case/bc-4417@7           # everything else
  payload_digest:    sha256:9f2c…                            # binds the reference to bytes
```

**Five envelope rules, each enforced at append rather than documented:**

1. **`accountable` must resolve to a human principal in PS1.** An agent in that field is a rejected write, not a warning. This is P12 made structural — the one place where "accountability never transfers" stops being a sentence and becomes a constraint.
2. **All four attribution fields are mandatory.** §12.4 requires *what* approved this, at *what oversight level*, under *whose* accountability, answerable years later. Three separate fields, three separate answers, no defaults.
3. **`oversight_level` is the level in force at the time**, copied onto the event, never joined to a current configuration table. Levels change; the record of what governed a decision must not.
4. **`body` is validated against a schema that forbids free text.** T25's split is only real if it is mechanical. Anything that could carry a name, an address, or a note is a `payload_ref` into PS7 under a retention and erasure rule.
5. **`occurred_at` and `recorded_at` are both kept.** They differ on backfill, on onboarding intake (§14.3 reconstructs history that happened before the platform saw it), and under clock skew. Collapsing them loses the only signal that a record was constructed rather than observed.

### 3.2 The payload boundary, which is the whole of T25

```
┌─ PS2 ─────────────────────────────┐        ┌─ PS7 ────────────────────────┐
│ envelope + structural body        │───────▶│ payload under retention      │
│ immutable, multi-year, no PII     │  ref   │ erasable, classified         │
│ digest binds the reference        │ digest │                              │
└───────────────────────────────────┘        └──────────────────────────────┘
```

The digest is what makes the split safe: PS2 can prove *what the payload was* without holding it. After erasure the payload is gone and the digest remains, so the record still shows that a specific byte sequence was accepted at a specific gate — which is the audit fact — without retaining the personal data. **This is the only mechanism in the design that satisfies GDPR erasure and an immutable audit substrate at the same time**, and it is why the boundary is drawn at the field rather than at the artifact.

### 3.3 First-wave event taxonomy

Derived from §4.2's chain and §10's lifecycle. Fifteen types is the whole of the first wave; the temptation to add a sixteenth before it is needed is how a log becomes a message bus.

| Group | Types |
|---|---|
| **Opportunity** | `OpportunityRaised` · `OpportunityDeclined` · `OpportunityExpired` |
| **Business case** | `BusinessCaseProposed` · `BusinessCaseSuperseded` |
| **Specification** | `SpecificationProposed` · `SpecificationSuperseded` · `SpecificationClassChanged` *(descriptive ⇄ generative, D27 — one-way in practice)* |
| **Governed decision** | `GateDecisionRecorded` · `PhaseTransitioned` · `OversightLevelChanged` |
| **Standards** | `StandardsEvaluationRecorded` *(empty result until PS5, §5.1)* · `PackVersionPublished` |
| **Custody** | `PayloadErased` · `ArtifactDeployed` *(PS13; see T-O)* |

**Acceptance is not a separate event type**, and this is deliberate. A `GateDecisionRecorded` with `outcome: accepted` referencing a proposed version *is* the acceptance. Two types would let a version become accepted without a decision behind it, which is precisely what P13 forbids.

---

## 4. Streams and tenancy topology — a proposed answer to T-B and T-L

### 4.1 The logical level

*Technical design §3.3's L1, realised for PS2. The physical level (L2) is the same design with a cluster, a database, and a bucket per tenant rather than a partition, a schema, and a prefix — which is the point of T28: **the service code cannot tell which level it is running at**, because every access goes through a tenant-scoped handle acquired once per request.*

| Layer | Partition | Isolation property |
|---|---|---|
| **Log** | One topic `governance.events`; **one exclusive partition per tenant** | A consumer is assigned partitions, never rows. Cross-tenant reads require a partition assignment that does not exist |
| **Projections** | **Schema per tenant** in Postgres, with a per-tenant role | A read is scoped by role and `search_path`, not by `WHERE tenant_id = …` |
| **Archive** | **Prefix per tenant** in object storage | A per-tenant credential cannot address another tenant's prefix |

The tenant→partition map is **explicit and stored**, never hash-modulo. Hashing looks simpler and makes two things impossible: moving a hot tenant, and changing the partition count without reshuffling every tenant's history.

### 4.2 Why exclusive partitions, and when that stops working

Exclusive partitions buy strict ordering per tenant for free, which is what makes the chain in §5 a rolling computation rather than a distributed one. The cost is a partition budget: MSK's practical ceiling is in the low thousands of partitions per broker, against tens to low hundreds of tenants in the foreseeable case.

**So the model has a stated expiry.** Below the partition budget, exclusive partitions. Above it, tenants share partitions and `tenant_seq` is assigned by a sequencer rather than derived from partition order. **The explicit tenant→partition map is what makes that migration possible without rewriting history**, which is the entire reason it is not a hash.

**`tenant_seq` is assigned by PS2, never read from the broker's offset** (T22). Offsets are a Kafka concept; a service that stores them in its own records has named its substrate and made the MSK-to-anything migration a data migration.

### 4.3 One writer per tenant

Monotonic `tenant_seq` needs a single writer per tenant. A per-tenant lease held by one append-service instance is sufficient and cheap at this volume (§1). On lease loss the successor reads the last sealed sequence and resumes; a duplicate sequence is a hard failure, not a repair — see §10.

---

## 5. The archive and the integrity chain

### 5.1 The split, restated because everything below depends on it

The log is transport and ordering with short retention. **The archive is the system of record for anything retained** (T4, §13.4), and it is what an auditor is shown. That is why the integrity chain lives in the archive and not in the event envelope.

### 5.2 Segments and the chain

A **sealer** consumes each tenant's partition in order and writes sealed segments — one per tenant per day, or per size threshold, whichever first.

```yaml
segment:
  tenant_id:           tnt-aannemer-x
  period:              2026-08-03
  first_seq:           148100
  last_seq:            148412
  event_count:         313
  merkle_root:         sha256:4c1e…    # over the canonicalised events in sequence order
  prev_segment_digest: sha256:1a0b…    # chains this segment to yesterday's
  segment_digest:      sha256:7e41…    # over this manifest, including prev
  sealed_at:           2026-08-04T00:07:11Z
  sealer_version:      3
```

Canonicalisation is **JCS (RFC 8785)**, named here because "hash the JSON" is not a specification and two implementations that disagree about key order produce a chain that cannot be verified by the party it exists to serve.

**Why the chain is computed in the sealer rather than carried in the envelope.** Putting `prev_digest` on each event forces a strict single writer at append time, makes retries poisonous, and couples write latency to chain computation. Computing it downstream keeps append fast and puts the chain where the retention obligation actually is. The log is not tamper-evident under this design and does not need to be — it is short-lived transport, and the archive is the artifact.

### 5.3 Anchoring, because a self-held chain proves consistency and not honesty

A hash chain the platform computes, stores, and verifies proves only that the platform has been internally consistent. It is not evidence against the platform, and a conformance record's integrity claim is worth exactly what an adversarial reader will grant it.

**Each day's `segment_digest` is delivered to the tenant's named contact and to the Auditor role through PS8** (R7). Sixty-four bytes, once per tenant per day, and the tenant then holds independent evidence the platform cannot revise. It also produces the PS8 delivery record — *"the daily root was delivered on this date"* — which is the same audit artifact §8 of the technical design values for advisor re-solicitation.

This is deliberately cheaper than a public timestamp authority or a transparency log. Either can be added later behind the same interface if a client's auditor asks for it; neither should gate the first build.

### 5.4 Verification

`verify(tenant, period_range)` re-reads segments from the archive, recomputes roots and the segment chain, and returns pass or **the first divergent sequence number**. The verifier is part of the open-code service and depends on no vendor primitive (T24) — given the archive and the service, any party can run it, including after exit (§13.5, P9).

---

## 6. Projections

### 6.1 The contract

A projection is a consumer with a checkpoint and a version. It owns its store, never writes to the log, and can be rebuilt from zero at any time. **Every read model in the platform is a projection or a defect** — the alternative is a store that drifts from the record and cannot be reconciled with it.

| Projection | Owner | First wave |
|---|---|---|
| Specification chain — versions, diff, lineage | PS3 | ✅ |
| Decision and oversight records | PS4 | ✅ |
| Portfolio view (§6) | PS3 / UI | ✅ |
| Audit read model | PS2 | ✅ |
| Conformance record (§5.8) | **PS12** | ◐ record only |
| Artifact ledger | **PS13** | T-O open |

### 6.2 Rebuild reads the archive first, then the log

This follows from §5.1 and is the consequence most likely to be missed: **log retention is shorter than the history a rebuild needs.** The replay source is therefore archive-then-log, with the handover at the last sealed sequence. A projection that can only replay from the log is one retention window away from being unrebuildable, which quietly makes it a store rather than a projection.

Rebuild runs alongside the live version and swaps on completion. Projection version is recorded with the checkpoint; a version change forces a rebuild rather than an in-place migration.

### 6.3 PS2 has no propose/accept semantics

P13's *writes propose, gates accept* lives in PS4. PS2 records that a proposal was made and that a gate decided — both are facts, and a fact is not a proposal. Attempting to mirror P13 inside PS2 creates a second acceptance point, which is exactly the failure T17 warns about.

---

## 7. Schema evolution

§9 names schema evolution as a place things fail catastrophically rather than visibly, and a log makes it worse: history cannot be migrated.

- **Envelope version and payload `type_version` evolve independently.** The envelope changes rarely and for everyone; a payload changes per type.
- **Backward-compatible changes only** — add optional fields, never remove or retype. A breaking change is a **new type**, not a new version.
- **Upcast on read, never rewrite.** Readers translate old versions forward; the stored bytes are the record, and the digest chain makes rewriting detectable by design.
- **The registry is the gate.** An unregistered type or an incompatible version is a rejected append.

---

## 8. Erasure

**Erasure is recorded as an event; it is never performed on events** (R9).

```
PayloadErased { subject, payload_ref, payload_digest, lawful_basis, requested_by, executed_at }
```

The PS7 payload is deleted. The log and archive are untouched. What remains is the envelope, the digest, and an event stating that erasure occurred, by whose request, on what basis. The audit chain stays intact and verifiable; the personal data is gone.

**The failure mode this avoids is crypto-shredding**, which sounds equivalent and is not: it puts a key-management dependency in the middle of the audit substrate and makes every historical record unverifiable the day a key is lost.

---

## 9. Interfaces

Per T17, every service exposes UI, API, and MCP — under one constraint here.

| Operation | Surface | Notes |
|---|---|---|
| `append(event)` | API only, service-to-service | The only write. Caller authenticated as a PS1 principal; idempotency key required |
| `read_stream(tenant, subject?, from_seq)` | API, MCP | Ordered replay |
| `query(projection, …)` | API, MCP | Read models |
| `verify(tenant, period_range)` | API, MCP | Returns pass, or the first divergent sequence |
| `export(tenant)` | API | Archive + manifests + verifier. The P9 exit deliverable, tested from the first build |

**MCP exposes read, verify, and export — never append** (R11). An external agent appending directly to the record spine bypasses the semantics PS3 and PS4 own, and PS2 has no gate of its own to catch it (§6.3). Agents write by proposing through PS3 and being accepted by PS4, which is what P13 describes.

**`export` is built in the first wave, not at exit.** An exit path first exercised at exit is a promise, not a capability — and §13.5 makes it contractual.

---

## 10. Substrate

| | PoC (Docker) | MVP (K8s + AWS) | Handover |
|---|---|---|---|
| Log | Kafka, KRaft, single broker | **MSK** | Kafka API (T21) |
| Archive | **MinIO** | **S3**, versioning on, Object Lock as defence in depth only | S3 API |
| Projections | Postgres, schema per tenant | **RDS PostgreSQL**, schema per tenant | Open-code |
| Sequencer / lease | Postgres advisory lock | Same | Open-code |
| Integrity | Computed in service code | Same — **never KMS-dependent** (T24) | Open-code |

**A single-broker PoC proves shape, not throughput**, and shape is what PS2 is for. Three things must be real on the PoC even though they look optional there (§3.2): the archive as a separate store, the tenant→partition map, and the daily seal.

---

## 11. Build order and gates

| # | Step | Gate |
|---|---|---|
| 1 | Envelope, schema registry, append with validation | An append missing any attribution field, or naming an agent as `accountable`, is rejected — and the rejection is itself recorded |
| 2 | Exclusive partitions, tenant→partition map, per-tenant lease | Two tenants' events are never on one partition; a consumer holding tenant A's assignment cannot read tenant B by any query |
| 3 | Sealer, segments, chain, archive | A day seals; `verify` passes; a byte flipped in the archive is reported at the correct sequence number |
| 4 | Projection framework, audit read model, rebuild | A projection is dropped and rebuilt from archive-then-log to the identical state, with the handover crossing the log retention boundary |
| 5 | Anchoring via PS8, `export` | A tenant receives a daily root; `export` produces an archive a third party verifies with the open-code verifier alone |

Step 5 depends on PS8, which is why the §5.1 build order branches PS8 off PS2 rather than sequencing it after PS3.

---

## 12. Failure modes

| Failure | Detection | Response |
|---|---|---|
| Sealer lag | Unsealed sequence age vs threshold | Alert; the audit claim degrades before it breaks — an unsealed day is not yet evidence |
| Duplicate `tenant_seq` after lease loss | Sealer detects on the ordered read | **Hard stop for that tenant.** Never repaired in place; the divergence is investigated and recorded as an event |
| Partition budget exhausted | Tenant count vs configured budget | The stated migration in §4.2, triggered on a threshold rather than on an incident |
| Projection divergence | Checkpoint plus periodic recompute against a sample | Rebuild. A projection is never patched |
| Dangling `payload_ref` | Digest resolution fails on read | Distinguish erased (expected, `PayloadErased` present) from lost (a PS7 incident) |
| Clock skew, `occurred_at` before predecessor | Append validation | Accept and flag — a backfilled or reconstructed record is legitimate (§14.3) and must be visibly so |

---

## 13. Decisions

| # | Decision | Rationale |
|---|---|---|
| R1 | **The four attribution fields are mandatory at append, and `accountable` must resolve to a human principal** | §12.4 requires three separate answers years later; P12 becomes structural instead of aspirational. It is also the field an implementation will be tempted to default |
| R2 | **`oversight_level` is copied onto the event, never joined to current configuration** | Levels change under §12.2's promotion and demotion; the record of what governed a decision must not change with them |
| R3 | **`body` is schema-constrained to forbid free text; anything else is a `payload_ref` with a digest** | T25 is only real if mechanical. The digest is what lets PS2 prove what a payload was without holding it |
| R4 | **Exclusive partition per tenant, with an explicit stored tenant→partition map and a stated budget ceiling** | Answers T-B. Gives ordering for free below the ceiling; the explicit map is what makes the above-ceiling migration possible without rewriting history |
| R5 | **`tenant_seq` is assigned by PS2, never derived from a broker offset** | T22 — a service that stores offsets has named its substrate |
| R6 | **The integrity chain is computed by the sealer over archived segments, not carried in the event envelope** | Keeps append fast and retry-safe, and puts the chain where the retention obligation is. The log is transport; the archive is the artifact |
| R7 | **Each day's segment digest is delivered to the tenant and the Auditor through PS8** | A self-held chain proves internal consistency, not honesty. Sixty-four bytes a day converts it into evidence the platform cannot revise |
| R8 | **Projection rebuild reads archive-then-log, and every read model is a projection** | Log retention is shorter than the history a rebuild needs; a projection that cannot replay past that boundary is a store pretending |
| R9 | **Erasure is recorded as an event and never performed on events** | Preserves both the audit chain and GDPR erasure, and avoids crypto-shredding putting key management inside the audit substrate |
| R10 | **Breaking payload changes create a new type; readers upcast, history is never rewritten** | §9 names schema evolution as a catastrophic-failure surface, and the digest chain makes rewriting detectable anyway |
| R11 | **MCP exposes read, verify, and export — never append** | PS2 has no gate of its own (§6.3); an agent write here bypasses the semantics PS3 and PS4 own, which is what P13 exists to prevent |
| R12 | **`export` is built in the first wave** | §13.5's exit promise is contractual; a path first exercised at exit is not a capability |
| R13 | **Every principal reference in an event is a maestro principal id; an identity provider's `sub` is rejected at append** | T30. Subjects are minted per identity deployment and re-mint on a deployment-model change, against records that are immutable and multi-year. This is the one field where the indirection cannot be added later, because the archive is already sealed |

---

## 14. Open

- **R-A.** Segment period. Daily is assumed throughout; a low-volume tenant may produce a segment of four events, and a busy day may want size-based sealing. Bears on §5.3's anchoring cost, which is per segment.
- **R-B.** Whether the sealer signs the manifest at all. Signing proves origin, not integrity, and origin is only meaningful with a key custody story — which is PS10, deferred. Anchoring (R7) may make signing unnecessary.
- **R-C.** Whether the audit read model is one projection or per-tenant. Cross-tenant audit is a platform function; per-tenant audit is the client's. §4.1's isolation rule pushes toward per-tenant with a separate, explicitly privileged platform view.
- **R-D.** Backfill semantics for onboarding (§14.3). Intake reconstructs history that predates the platform. `occurred_at` handles it; whether reconstructed events enter the same chain or a marked prior segment is not decided, and an auditor is entitled to tell them apart (D27's spirit, one layer down).
- **R-E.** Retention of the log itself. Long enough for convenient rebuild, short enough that it is clearly not the record. Interacts with T-G.

*Inherited:* **T-B** (topology — §4.2 proposes an answer with a stated ceiling), **T-C** (archive location; mechanism settled by T24), **T-G** (whether PS2 and PS7's event shape share a cluster), **T-O** (whether PS13's ledger is a PS2 projection or its own store).

*Closed since v0.1:* **T-L** — technical design §3.3 settles logical-between-tenants and physical-between-deployments; §4 is PS2's realisation of the logical level and needed no change to survive it.

---

## 15. Change log

| Version | Date | Change |
|---|---|---|
| 0.2 | 2026-08-03 | **T-L closed upstream** (technical design §3.3) and §4 survived it unchanged — the exclusive-partition model is the logical level, and the physical level is the same design with a cluster per tenant, which is what T28's binding rule buys. §2.2 rewritten from a blocking prerequisite to a settled one; §4.1 reframed as the logical level. **R13 added — every principal reference is a maestro principal id and a provider `sub` is rejected at append** (T30), because subjects are minted per identity deployment and the archive is sealed before anyone notices |
| 0.1 | 2026-08-03 | Initial design. Envelope with mandatory attribution and a schema-enforced payload boundary (R1–R3). Exclusive partition per tenant with an explicit map and a stated ceiling, proposed as the answer to T-B and T-L (R4–R5). Integrity chain moved to the sealer and the archive rather than the envelope (R6), with daily anchoring through PS8 as the answer to self-attestation (R7). Projection contract with archive-then-log rebuild (R8). Erasure as an event (R9). Schema evolution by new type and read-time upcast (R10). MCP read-only (R11) and first-wave export (R12). Build order in five gated steps; failure modes; R-A to R-E opened |
