# PS3 — Specification Service — Service Design

**Status:** Draft v0.3 — for refinement
**Repo:** mstr-specs
**Companions:** `conceptual-design.md` (v0.9) is authoritative for *what* and *why*; `technical-design.md` (v0.7) for build order and substrate; `ps2-record-spine.md` (v0.2) for the substrate this service projects from. Precedence runs in that order and this document is wrong where it conflicts.
**Realised as:** `../specs-service` — adopted, assessed in §1.2 and §1.3. That repository owns its own internals and its ADRs; this document is authoritative for what maestro requires of it.
**Scope:** The artifact model — opportunity, business case, specification, intake assessment, tenant pack binding — with drafts, versioning, linking, diff, lineage, and the proposal semantics of P13. **Including the gate**: T-D closed in v0.2 and PS4 is a bounded context inside this service, not a separate one (§7.1, S15).
**The constraint that shapes everything below:** conceptual open question **A**, the specification's internal representation, is unresolved and gates real generation. §3 of the technical design says the demo path is deliberately arranged so A can stay open. **This design has to make that true rather than assume it** — see §4.

---

## 1. What PS3 is

D13 makes the specification service *"the centre of the product"* — a platform service with API and MCP interfaces rather than an internal store, because §4.2 wants the gate to be a property of the service rather than of any one client. That is what makes external agent access safe by construction.

Concretely, PS3 holds the chain of record:

```
Opportunity ──▶ Business case ──▶ Specification ──▶ (Application) ──▶ (Conformance record)
     │               │                  │                 │                    │
   PS3             PS3                PS3               PS13                 PS12
```

Every link traceable in both directions (§4.2): an auditor asks *why does this application exist* and reaches a business case; a sponsor asks *what happened to my idea* and reaches a running system or a recorded decline.

### 1.1 PS3 holds no system of record

**Every write is an append to PS2, and PS3's store is a projection** (S1). This is the single most important structural fact about the service and the easiest to erode: the moment PS3 has a table that is authoritative for something, the chain of record has two homes and §4.2's monotonic-immutable guarantee becomes a convention.

| Where a thing lives | What |
|---|---|
| **PS2** | Every version event, every link, every attribution, the ordering, the integrity chain |
| **PS7** | Personal-data-bearing and free-text fields of every artifact, under a retention and erasure rule (T25) |
| **PS3** | A rebuildable projection — the query surface, the diff engine, the lineage graph |

PS3 is therefore droppable and rebuildable from archive-then-log (PS2 §6.2), and that is a build gate, not an aspiration.

### 1.2 PS3 is realised as `specs-service`

*New in v0.2, following the PS1 precedent: assess the existing service, state what maestro builds on top, and record the gaps as fixed, accepted, or sent back.*

`../specs-service` is a designed-but-unbuilt governed specification service (design draft v0.2, seven ADRs, no implementation). It was **derived from two consumers — maestro v1 and this rebuild — and its generic core is their overlap**, which is a strong position for a service maestro is going to adopt: the overlap spans two materially different governance models (conceptual §1.5), so it is not a single-consumer extraction. **Two qualifications, both from T42 upstream.** The two consumers are two iterations of one product rather than two products, so this is weaker than an unrelated consumer validating the shape. And PS7 §1.3's split-out trigger (*a consumer that is not maestro*) is **not** satisfied by v1 — it remains open, and the first outside consumer is still the event that proves the core generic rather than argued so.

**Adopted.** Its model is PS3's model, arrived at independently, and where the two differ it is mostly better.

| maestro concept | `specs-service` | Note |
|---|---|---|
| Tenant | **Workspace** | Deliberately not called a tenant; maestro maps through an adapter and neither side adopts the other's identifiers |
| Business case, specification, intake assessment | **Type**, declared in configuration (ADR-0001) | The service ships no vocabulary. §2's four artifacts are a workspace definition, not code |
| Facets with provenance (S4, S5) | **Facets**, with `declared` / `extracted` / `reconstructed` | Identical, including the third value |
| The pin (§2.1) | **Pinned link** — one per type, frozen to a version at acceptance | Identical |
| PS2 append (S1) | **Record sink** port — *"point it at a durable spine and the spine becomes authoritative and this database becomes a projection"* | S1 satisfied by configuration |
| PS5 evaluation | **Evaluator** port; the service records a verdict and never computes one (ADR-0004) | Identical to PS5's pure-evaluator posture |
| P13, agents propose | ADR-0005 — agents author, never decide; MCP exposes reads, draft writes and propose, and **no decision surface at all** | Identical |
| P5 / D36 | `separation_of_duties: exclude_creator`, declared per gate | Configuration, and the *omission* is declared too |
| T28 isolation | ADR-0006, database per workspace, resolved once per request | *"Fails closed where a filter fails open"* — T28's argument verbatim |

**Two things it has that this design did not, and both are improvements.**

**Drafts (ADR-0003).** PS3 v0.1 had versions and nothing else, which meant a business case shaped over a week by a case-shaping agent and a confirming human would produce a proposed version per edit. `specs-service` separates a **mutable draft** — autosaved, contributor-accumulating, expiring on a declared interval — from the **immutable version** a gate decides on. *"Editing is continuous and messy; a record is neither."* Adopted as **S13**; §3 is revised for it.

**Artifact types as configuration (ADR-0001).** A fifth artifact class costs a workspace definition, not a release. That materially changes the pack-binding question in `uc1-nl-construction.md` §7.3 — see **S17**.

### 1.3 Gap assessment

Ranked by consequence. Where the fix lives matters as much as the fix.

| # | Gap | Fix | Where |
|---|---|---|---|
| **P1** | **ADR-0007 stores bodies inline with no classification.** T25 and §1.1 route personal-data-bearing fields to PS7 under a retention and erasure rule; `specs-service` embeds the body in the version document. A business case naming a foreman therefore lands with no lawful basis, no `subject_ref`, and no retention rule — which §2.4 of the technical design calls *unclassifiable*, not merely unclassified | **A classification envelope validated at `propose`**, vocabulary from PS11, erasure by redaction. See below | **`specs-service`** |
| **P2** | **`expired` has no transition path.** S9 requires PS12 to set it; declared transitions are `via: propose` or `via_gate:`, and a machine-set expiry is neither | A `via: system` transition kind, with the actor recorded. Their open **E** asks the same question; maestro answers *driven by a consumer* | **`specs-service`** |
| **P3** | **A breaking facet change creates a new *type*** (architecture §4), while S-A versions the facet schema in PS11 and sufficiency standards evolve. A breaking change to the business-case schema would mean `business_case_v2` — a new lineage, and every link and pin pointing at the old one | Decide whether facet schemas version *within* a type. Their open **C** is the same question | **`specs-service`**, and it blocks S-A |
| **P4** | **No cross-workspace queries** (ADR-0006), while §5.7 re-evaluates *every affected specification* when a pack publishes | Not a defect — fan-out per workspace, which is PS14 **W12**'s shape already. It must be **built** as fan-out rather than discovered as a missing index | **maestro** |
| **P5** | **A third identifier space.** `specs-service` mints its own workspace and principal ids with an optional `external_ref`. T30 forbids maestro storing a provider `sub`; the same argument now forbids storing a `specs-service` principal id | PS1's registry gains a second binding kind, or maestro maps in the `workspaceFor(tenant)` adapter | **maestro** (PS1) |
| **P6** | Attribution profile has `seat` and `oversight_level` as *optional* | maestro's profile declares them **required**. Configuration, not a change | **maestro** — accepted |

**P1 is the one that matters, and the resolution is not simply "route bodies to PS7".** T25 exists to keep personal data out of PS2's immutable log so GDPR erasure does not meet an append-only substrate — and `specs-service`'s **redaction** (ADR-0007, architecture §8.3) achieves exactly that by a different mechanism: content is replaced in place, a `BodyRedacted` event is emitted, and the digest deliberately no longer matches, so *"a mismatch with no event is corruption; with one it is a lawful erasure."* That is a genuinely good answer and arguably better than a second round trip on every read.

**So T25's goal survives and its mechanism becomes one of two valid designs.** What does not survive is the missing classification: PS7 rejects an unclassified write (H4) and `specs-service` has no classification concept at all. The recommendation is therefore **classification at `propose`, not relocation of the body** — the same five rules PS7 §4.1 enforces, reading its vocabulary from PS11. §12's **S14** records it and §15 sends it back.

---

## 2. The four artifacts

D15 keeps the business case and the specification separate, with a first-class typed link. §19.2 gives four reasons and all four still hold; §14.3 adds a fourth artifact that v0.4 of the technical design left unmodelled.

| Artifact | Answers | Owned by | Evaluated by | Cardinality |
|---|---|---|---|---|
| **Opportunity** | Is there a problem here? | Attribution only (D36) | — | 1 tenant : n |
| **Business case** | Is it worth solving, and do we know enough? | **Sponsor** | **Sufficiency** standards (§5.1) | n : n with specification |
| **Specification** | What exactly is built, and is it compliant? | **Owner** | **Conformance** standards | n : n with business case |
| **Intake assessment** | Is this existing application ours to hold, and at what level? | **Sponsor** (Assess gate) | Its own sufficiency standards (§14.3) | 1 : 1 with an onboarded application |

**Four of the five Explore outcomes produce a business case and no specification** (§10.2), which is why merging them was never available: *already solved*, *not a software problem*, *not worth it*, and *insufficient* all need somewhere to live, and §6's register is where they live.

**The intake assessment is the business case's brownfield twin, not a variant of it.** Same envelope, same versioning, same gate mechanics — different sufficiency standards and a different question. Modelling it as a business case with a flag would put "is this worth building?" and "is this ours to hold?" through one set of standards, and they are not the same question (§14.3).

### 2.1 The pin

D15's load-bearing clause: **the specification pins the business case version that justified it, at approval time, and the pin is immutable thereafter.**

```
Specification bc-4417-spec@3
  justified_by: business-case bc-4417@7      # pinned at acceptance, never repointed
  supersedes:   bc-4417-spec@2
```

Links are many-to-many and mutable; **the pin is singular and frozen**. That distinction is what makes the audit chain hold: an auditor reading a five-year-old specification sees the case as it read when someone accepted it, not as it was subsequently rewritten.

---

## 3. Drafts and versioning

**Two entities, not one** *(revised in v0.2, adopting `specs-service` ADR-0003 — S13)*. A **draft** is mutable, autosaved, and accumulates contributors; a **version** is an immutable snapshot of one. Nothing may cite a draft, and a draft is not a record.

```
Draft  ── mutable ──▶  agent extracts, human edits and confirms, autosaved, expires on an interval
  │  propose (snapshot)
Version ── immutable ──▶  no update operation exists
  │  gate decision
Accepted ──▶ pinned links freeze to it
```

**Why this is not a convenience.** Facets are extracted by an agent and confirmed by a human (S4), and confirmation is a human act on a diff. Without a draft, every extraction pass and every correction is a proposed version, so the chain of record fills with authoring noise and the *"what changed and who accepted it"* question (§4.2) is answered by a hundred rows nobody decided on. **A draft is what keeps versioning meaningful, and its absence in v0.1 was a defect.**

**Contributors accumulate on the draft and carry onto the version.** The case-shaping agent and the confirming human are both on the record, which is what S4's provenance needs at the artifact level rather than only per facet.

**Abandoned drafts expire and the expiry is recorded**, on the same argument as S12 for opportunities: silence is not an outcome (P11).

**Versions are monotonic, immutable, supersede-only.** Accepted versions are never edited (§4.2). There is no update operation anywhere in the API.

| State | Means | Set by |
|---|---|---|
| `proposed` | Created by any write, from any interface (P13) | PS3 |
| `accepted` | A gate decided (§4.2) | **PS4 only** |
| `superseded` | A later version of the same lineage was accepted | PS3, on acceptance |
| `rejected` | A gate declined | **PS4 only** |
| `withdrawn` | The proposer retracted before a decision | PS3 |
| `expired` | A descriptive specification failed re-verification (§14.4, §6.3) | **PS12 only** |

**PS3 exposes no state-mutation API** (S2). Version identity is `lineage@ordinal` plus a digest over the envelope, facets, and body — content-addressed so that a fork, an export, and an adoption in another tenant all refer to the same bytes.

---

## 4. Representation: how open question A stays open

**The problem.** A gates real generation, and it is the largest undecided item in the design. But PS5 must mechanically judge a business case insufficient in the first wave, and mechanical judgement needs something structured to read. Waiting for A blocks everything; guessing at A bakes the guess into every artifact written before it is settled.

**The resolution: envelope, facets, body — and only the body is A** (S3).

```yaml
business_case:
  # envelope — settled, representation-independent
  id:            bc-4417
  version:       7
  class:         business_case
  state:         proposed
  tenant:        tnt-aannemer-x
  originated_by: usr-p-visser            # an attribution, not a role (D36)
  links:         [ { type: addresses, target: opp-2201 } ]

  # facets — typed, schema'd, and the only thing PS5 evaluates
  facets:
    declared_outcome:      { statement: "…", baseline: 14.2, target: 8.0, unit: days }
    beneficiary:           { role: werkvoorbereider, count_estimate: 6 }
    personal_data_in_scope: true
    regulatory_regime:     [ nl-wkb, gdpr ]
    consequence_class:     c3
    affected_roles:        [ foreman, project_controller ]
    existing_solution_checked: { at: 2026-08-01, result: none_found }
    decider:               usr-j-dekker
  facet_provenance:
    declared_outcome:      { source: extracted, by: agt-case-shaper-3, confirmed_by: usr-j-dekker }
    personal_data_in_scope: { source: declared, by: usr-p-visser }

  # body — whatever A turns out to be. Opaque to PS3 except for digest and diff.
  body_format:   cnl/v0            # controlled natural language, structured model, or hybrid
  body_ref:      ps7://business-case/bc-4417@7
  body_digest:   sha256:9f2c…
```

**Facets are proposed by extraction and confirmed by a human.** A non-technical originator writes prose; the case-shaping seat extracts candidate facets at its O4 ceiling (§3.3); a human confirms before the gate. This maps onto the oversight model exactly as it stands: extraction is not binding, so an agent may do it; the sufficiency evaluation runs on **confirmed** facets, so nothing binding is model-inferred (P3).

**`facet_provenance` is not decoration.** *Extracted-and-confirmed* and *declared* carry different assurance weight, and §14.3's reconstructed artifacts need a third value — `reconstructed`, with the confirming party named — because §10.5 requires an onboarded application's outcome to be *marked as reconstructed and attributed*, never presented as original.

**What this buys.** The facet schema is small, stable, and derived from §5.1's sufficiency examples, so PS5 can be built and demonstrated against it. The body can change format entirely — twice — without invalidating a single record, because nothing except the diff renderer reads it.

**What it costs, and this is the real trade.** Facets can drift from the body: a case whose prose says one thing and whose `declared_outcome` says another will pass sufficiency and mislead everyone downstream. The mitigation is that confirmation is a human act on a diff of both, and that a facet change is a new version like any other. **It is not eliminated, and it is the honest cost of keeping A open** — worth carrying, because the alternative is settling the platform's largest open question under demo pressure.

### 4.1 Two constraints A must satisfy, which can be stated now

- **Mechanically scrubbable.** §7.2 makes publication an export with a hard scrubbing gate, and §5.2 puts *published specifications contain no tenant-identifying content* in Tier 1. A representation whose tenant-identifying content cannot be found mechanically cannot be published, which removes the marketplace.
- **Diffable to a non-technical owner.** §19.1 says the property worth preserving is requirement-to-artifact traceability, so a non-technical owner can confirm *was my intent built?* A body diff that only a developer can read is a failure of the representation, not of PS3.

---

## 5. Diff and lineage

Both are first-class operations, because *what changed and who accepted it* is the primary audit question (§4.2).

| Operation | Over | Availability |
|---|---|---|
| **Facet diff** | Typed, structural | Now, representation-independent |
| **Body diff** | Pluggable per `body_format`; text differ is the default | Now, improving with A |
| **Link diff** | Added, removed, repointed | Now |
| **Lineage — backward** | Specification → pinned case → opportunity | Now |
| **Lineage — forward** | Opportunity → cases → specifications → deployments (PS13) → conformance (PS12) | Forward edges arrive with those services |

Lineage is a projection over PS2's `causation_id` and `correlation_id` plus the typed links, not a separate graph anyone maintains by hand.

---

## 6. Specification classes

### 6.1 Two classes, at the type level (D27)

*"Distinct artifact classes … must never be silently interchangeable"* — so not a boolean.

| | **Descriptive** | **Generative** |
|---|---|---|
| Relationship to code | Derived from it; a claim about it | Authoritative; code derived from it |
| Extra envelope fields | `derived_from_deployment`, `verified_at`, `verification_interval`, `expires_at` | `composes_archetypes`, `golden_case_suite`, `extension_points` |
| Can be wrong | Yes, silently | No — if it is wrong, the application is wrong |
| Conformance built on it | **Assessed** (§14.5) | **Asserted** |

The two are separate types with different operations and different fields. A conformance record built on each asserts a different thing, and an auditor is entitled to know which they are reading — so the class is on the artifact, on every projection, and on every export (D26).

### 6.2 The flip is a new artifact, never a type change

Promotion to N4 (§14.4) creates a **new generative specification** with `flipped_from: <descriptive lineage@version>`, gated by PS4 with the architect's co-signature at an O2 ceiling and a golden-case suite that passes against the *existing* system first. The descriptive lineage is superseded, not mutated.

Modelling the flip as a mutation would make a one-way governed transition look like an edit, which is precisely the visibility D27 exists to preserve.

### 6.3 Expiry, not staleness

§14.4: below N2 the incumbent team keeps deploying, so a descriptive specification starts rotting the moment it is written. **`expired` is a real state and PS12 sets it** — on a failed re-derivation, or on `verified_at + verification_interval` elapsing with no re-verification.

Downstream, expiry is not cosmetic: a conformance assessment resting on an expired descriptive specification is downgraded and says so. *Stale* invites reading on; *expired* does not, which is the whole point of the word.

---

## 7. Proposal semantics — where P13 lives and where it does not

**Every write from every interface creates a proposed version** (P13). UI, API, an agent over MCP, and eventually the composition plane all land in the same place, with the same attribution requirements PS2 enforces (§3.1 of that document).

**Acceptance is the gate's and nothing in the artifact model may set it** (S2).

### 7.1 T-D closes: PS4 is a bounded context inside PS3, not a service (S15)

*New in v0.2.* T26 recorded the split as **a departure from §4.2 that v0.3 of the technical design did not flag as one**, and provisionally resolved T-D *against* it. Three independent supports now agree and none argues the other way:

- **§4.2 is authoritative and places the gate inside the specification service** — *"the gate becomes a property of the service rather than of any one client"* — which is the property that makes external agent access over MCP safe. Under the precedence rule the conceptual design wins.
- **T26 already reached that conclusion** and left the split needing to argue its way out. It has not.
- **`specs-service` holds gates and decisions in the service**, as declared configuration with owners, required evaluations, outcomes and separation-of-duties per gate. The service maestro is adopting made the same call from its own two consumers — maestro v1 and this rebuild (T42).

**So PS4 folds in.** Gate, decision, lifecycle phase state, and ceiling resolution are a bounded context inside PS3 with a hard module boundary — no path from the artifact model to an accepted state, enforced at the interface rather than by convention.

```
        ┌──────────────────── specs-service ─────────────────────┐
  write │  drafts ──propose──▶ versions, facets, links, diff,    │
  ─────▶│                      lineage, projections              │
        │                            │  requests a decision      │
        │                            ▼                           │
        │  gates: owner, required evaluations, outcomes,         │──▶ PS2 append
        │         separation of duties, phase transition         │    (record sink)
        └────────────────────────────────────────────────────────┘
                                     │ calls out
                                     ▼
                        PS5 evaluator · PS11 ceilings · PS8 notifier
```

**What does not fold in is the resolution of ceilings and oversight levels.** Those are read from PS11 and PS1 at decision time (§12.5, I6) and are inputs to the gate, not part of it. W8's rule holds — one resolver, and it is not two.

**The one thing the fold costs, stated rather than discovered:** §4.2's guarantee is now a guarantee about a service maestro does not own the roadmap of. That is the ordinary price of adoption and it is the same price PS1 pays for `identity-service`; the defence is the same too — the record sink means PS2 stays authoritative, so a divergence is detectable rather than silent.

---

## 8. The register, the portfolio, and expiry

§6 requires the platform to know every application the tenant runs and every opportunity in flight, and calls a stale register a defect.

- **Opportunities expire by default.** Every opportunity carries a `review_by`; PS12 fires the expiry and PS8 delivers the warning. Expiry is a recorded outcome (`OpportunityExpired`), not a silent disappearance — P11 applies to neglect as much as to refusal.
- **Duplicate and overlap detection runs at raise time**, against opportunities in flight and specifications already accepted. *"You already have this"* is among the most valuable answers the platform produces (§6), and it is a facet-level comparison, not a body-level one, which makes it available in the first wave.
- **The portfolio view is a projection**, not a store, and cannot show an application as *not earning its keep* unless PS12 supplies the outcome series (§10.5).

---

## 9. Interfaces

Per T17: UI, API, MCP — with P13's constraint that every write proposes.

| Operation | Surface | Notes |
|---|---|---|
| `raise(opportunity)` | UI, API, MCP | Open to anyone authorised in the tenant (D36) |
| `propose(artifact, version)` | UI, API, MCP | The only write. Always attributed, always `proposed` |
| `get`, `list`, `search` | UI, API, MCP | Broad reads |
| `diff(a, b)` · `lineage(id)` | UI, API, MCP | First-class, not derived by a client |
| `export(lineage)` | API | P9. Includes body, facets, and provenance |
| `publish(lineage)` | — | **Deferred to Phase 5**, but the scrubbing gate is a Tier 1 standard and its shape constrains A (§4.1) |
| *any state change* | — | **Not exposed.** PS4 only |

**The PS3 UI is the platform's primary human surface** and the first concrete answer to conceptual open question **O** (§4.5). Four screens carry the first wave: *raise* (originator), *shape and confirm facets* (case shaping plus a confirming human), *decide* (sponsor, at the Explore gate), and *register* (the portfolio and opportunity list). Everything else the user touches before an application exists is still unspecified, and O stays open.

**MCP writes propose, exactly like every other surface.** This is D13's actual payoff: a client's own tooling, a partner's agent, or an auditor's analysis tool reads the chain of record without bespoke integration, and cannot accept anything.

---

## 10. Build order and gates

| # | Step | Gate |
|---|---|---|
| 1 | Envelope, lineage, monotonic versioning over PS2 | A version is proposed, superseded, and read back after PS3's store is dropped and rebuilt from archive-then-log |
| 2 | Facet schema and provenance | A business case is created with facets confirmed by a named human, and `extracted` is distinguishable from `declared` and `reconstructed` in a query |
| 3 | Business case ↔ specification link and the pin | A specification accepted today still reports the case *as it read at acceptance* after the case is superseded twice |
| 4 | Diff and lineage | An owner is shown what changed between two versions without reading the body format, and reaches the opportunity from the specification in one call |
| 5 | Descriptive class, expiry, intake assessment | A descriptive specification expires on schedule, and every conformance output built on it is visibly downgraded |
| 6 | Opportunity register, duplicate detection, portfolio projection | A duplicate is surfaced at raise time; an opportunity expires and the expiry is recorded and delivered |

Steps 1–4 are the first wave. Step 5 arrives with PS12 and with the platform onboarding itself (D39) — **the platform's own services are the first descriptive specifications in the system**, so the class is exercised immediately rather than first meeting reality on a client's estate.

---

## 11. Failure modes

| Failure | Detection | Response |
|---|---|---|
| **Facet–body drift** | Confirmation shows both diffs side by side; periodic sampled review above O2 | A facet change is a new version. Unconfirmed extraction never reaches a gate |
| Pin repointed | Immutability enforced at append; PS2's chain makes a rewrite detectable | Hard failure — the audit chain is the product |
| A body format that cannot be scrubbed | Publication gate | Blocks publication, not authoring. §4.1 says decide it in A rather than discover it in Phase 5 |
| Descriptive specification silently rots | `verified_at` age vs interval | `expired`, and every dependent claim downgraded (§6.3) |
| Register goes stale | Opportunities past `review_by` | Expiry is automatic; a growing expired count is a discovery-quality signal (§15.1) |
| Explore routed around as "small changes" | Ratio of new opportunities to change requests (§15.1) | Not a PS3 defect, but PS3 holds the only data that detects it |

---

## 12. Decisions

| # | Decision | Rationale |
|---|---|---|
| S1 | **PS3 holds no system of record; every write appends to PS2 and PS3's store is a rebuildable projection** | Two homes for the chain of record makes §4.2's monotonic-immutable guarantee a convention. Rebuild is a build gate, not an aspiration |
| S2 | **PS3 exposes no state-mutation API; only PS4 accepts, rejects, or expires a version** | P13 is a property only if acceptance exists in one place. With PS3 and PS4 in one deployable (T26) the boundary must be enforced at the module interface |
| S3 | **Envelope, facets, and body are three layers; only the body is open question A** | Lets PS5 be built and demonstrated against a stable typed schema while the representation stays undecided, and lets the body format change without invalidating a record |
| S4 | **Facets are extracted by an agent, confirmed by a human, and carry provenance; only confirmed facets are evaluated** | Extraction is not binding so an agent may do it (§3.3's O4 ceiling); sufficiency evaluation is, so nothing binding is model-inferred (P3) |
| S5 | **`reconstructed` is a first-class facet provenance value** | §10.5 and §14.3 both require reconstructed purpose and outcome to be marked and attributed, never presented as original |
| S6 | **The business-case pin is singular and frozen at acceptance; all other links are many-to-many and mutable** | D15's audit chain holds only if the justification reads as it read when someone accepted it |
| S7 | **Descriptive and generative are distinct types with distinct fields and operations, not a flag** | D27 — an auditor is entitled to know which they are reading, and a flag is settable |
| S8 | **The N4 flip creates a new generative artifact with `flipped_from` provenance; it is never a type change in place** | A one-way governed transition must not be expressible as an edit |
| S9 | **`expired` is a real state set by PS12, and dependent conformance output is visibly downgraded** | §14.4 — *stale* invites reading on, which is the failure the word exists to prevent |
| S10 | **The intake assessment is a fourth artifact class, not a business case with a flag** | *Is this worth building?* and *is this ours to hold?* are different questions with different sufficiency standards (§14.3) |
| S11 | **Duplicate and overlap detection runs on facets at raise time** | §6 calls *you already have this* one of the most valuable answers; facet-level comparison makes it available before A is settled |
| S12 | **Opportunities expire by default, and expiry is a recorded outcome** | §6 calls a stale register a defect, and P11 applies to neglect as much as to refusal |
| S13 | **A mutable draft is a distinct entity from an immutable version; nothing may cite a draft** | *(v0.2, adopting `specs-service` ADR-0003.)* Facets are extracted by an agent and confirmed by a human on a diff (S4). Without a draft each pass is a proposed version, and §4.2's *what changed and who accepted it* is answered by rows nobody decided on. Contributors accumulate on the draft and carry onto the version |
| S14 | **A version carries a classification validated at `propose`, with the vocabulary from PS11; erasure is redaction in place, not relocation of the body** | *(v0.2.)* T25's *goal* is that GDPR erasure never meets PS2's append-only substrate, and `specs-service`'s redaction achieves it — the digest deliberately mismatches and the event explains why. What T25 also needs and redaction does not supply is the classification: §2.4 calls an unclassified write *unclassifiable*, and a business case names people by construction (§5.1) |
| S15 | **PS4 is a bounded context inside PS3, not a separate service. T-D closes against the split** | §4.2 places the gate inside the specification service and is authoritative; T26 already resolved provisionally the same way; and `specs-service` holds gates in the service, declared as configuration. Three supports, none against |
| S16 | **Artifact types, links, gates, lifecycles and attribution profiles are workspace configuration, not code** | *(v0.2, adopting ADR-0001.)* §16's rule — core carries zero domain knowledge — is satisfied structurally rather than by discipline, and a fifth artifact class costs a definition rather than a release |
| S17 | **The tenant pack binding is a fifth artifact type, declared in configuration** | It is versioned, gated, diffable, lineage-bearing, and hands over at exit, which is this service's shape exactly — and S16 makes it a definition change. **Closes C-A** in `uc1-nl-construction.md`, where T29 had already ruled PS11 out for holding tenant runtime data |

---

## 13. Open

- **S-A.** The facet schema itself — this is conceptual open question **B** in concrete form. §5.1's sufficiency examples give the first seven; the schema must stay light enough for a foreman to satisfy and structured enough to evaluate. It is versioned in **PS11**, not in code, since sufficiency standards are pack content (§5.6).
- **S-B.** Whether facets are stored inline in PS2's event body or as a PS7 payload. `declared_outcome.statement` is free text and could name a person; the rest is structural. A split within the facet set is likely and is unattractive.
- **S-C.** How the body diff is rendered for a non-technical owner before A is settled. The default text differ satisfies nobody; §19.1's *was my intent built?* is the bar.
- **S-D.** Whether an opportunity is versioned at all, or is a single immutable record with a state. It has no gate of its own, which argues for the simpler model.
- **S-E.** Where extension points (D17) live — on the generative specification, or as a separate configuration artifact with its own lineage. Deferred with the marketplace, but it decides whether a tenant's configuration survives an upstream version bump, which is the entire point of D17. **S17 makes the separate-artifact answer cheap**, which is a point in its favour it did not have in v0.1.

*Opened in v0.2 by the `specs-service` assessment (§1.3):*

- **S-F.** **Whether a facet schema versions within a type or forces a new type** (gap **P3**). `specs-service` architecture §4 makes breaking facet changes create a new *type*; S-A versions the schema in PS11 and sufficiency standards demonstrably evolve. A new type is a new lineage, so every link and every pin to the old one breaks. **This blocks S-A** and it is that service's own open **C**.
- **S-G.** **Whether a `via: system` lifecycle transition exists** (gap **P2**). S9 needs PS12 to set `expired`, and declared transitions are `propose` or a gate decision. Their open **E** asks it from the other side.
- **S-H.** **Where the maestro↔`specs-service` identifier mapping lives** (gap **P5**) — PS1's principal registry as a second binding kind, or the `workspaceFor(tenant)` adapter. T30's argument applies unchanged and the answer should be the same shape.
- **S-I.** **Whether the pack binding's acceptances are facets or a body** (S17). Per-standard and per-project acceptances are a repeating structure, and facets are what a gate reads (ADR-0004) — so they must be facets, which makes the facet schema unusually large. If that is a problem, it is a problem with facets rather than with the binding.

*Inherited and blocking:* conceptual **A** (representation — §4 makes it deferrable, not answered), conceptual **B** (business case format — S-A), conceptual **O** (the user interface — §9 answers the first wave only). ***Closed in v0.2:*** **T-D** — PS4 is a bounded context, not a service (S15).

---

## 14. Change log

| Version | Date | Change |
|---|---|---|
| 0.2 | 2026-08-05 | **`../specs-service` assessed and adopted as PS3's realisation** (§1.2), on the PS1 precedent. Its model was derived from maestro v1 *and* this rebuild, so the generic core is their overlap rather than a single-consumer extraction *(qualified at v0.3 by T42 upstream: two iterations of one product, and PS7 §1.3's split-out trigger stays open)*, and eight of its concepts match this design point for point — facets with the same three provenance values, the pin, the record sink as S1's projection rule, the evaluator port as PS5's pure-evaluator posture, `exclude_creator` as D36, and database-per-workspace as T28's fail-closed argument. **Two additions taken from it.** A **mutable draft distinct from an immutable version** (S13, ADR-0003) — v0.1 had versions only, which would have made every extraction pass a proposed version and filled the chain of record with authoring noise; §3 rewritten. And **types, links, gates, lifecycles and attribution profiles as workspace configuration** (S16, ADR-0001), which satisfies §16 structurally rather than by discipline. **T-D closed against the split** (S15, §7.1): §4.2 places the gate inside the specification service and is authoritative, T26 already resolved provisionally the same way, and `specs-service` holds gates in the service — three supports, none against, so PS4 becomes a bounded context and the cost of adopting someone else's roadmap is stated. **The pack binding lands here as a fifth artifact type** (S17), closing **C-A** in the construction model, where T29 had already excluded PS11 for holding tenant runtime data. §1.3 records six gaps, of which **P1 is the sharpest**: ADR-0007 stores bodies inline with **no classification concept at all**, while T25 routes them to PS7 — resolved not by relocating the body, since redaction already satisfies T25's actual goal, but by **classification at `propose`** with PS11's vocabulary (S14). S-F to S-I opened, two of which are that service's own open questions reached from maestro's side |
| 0.1 | 2026-08-03 | Initial design. PS3 established as a projection over PS2 with no system of record (S1) and no state-mutation surface (S2). **Three-layer artifact — envelope, facets, body — as the mechanism that lets open question A stay open** (S3), with facets extracted by agent and confirmed by human (S4) and `reconstructed` as a first-class provenance value (S5). Business-case pin frozen at acceptance (S6). Descriptive and generative modelled as distinct types with the N4 flip as a new artifact (S7–S8); `expired` as a real state (S9). Intake assessment added as a fourth artifact class (S10), unmodelled through technical design v0.4. Facet-level duplicate detection (S11) and default opportunity expiry (S12). Two constraints on A stated: mechanically scrubbable, and diffable to a non-technical owner. First-wave UI scoped as a partial answer to conceptual open question O. S-A to S-E opened |
| 0.3 | 2026-08-05 | **Renamed to `maestro` throughout** (conceptual D44) — filenames, cross-references, and identifiers, with the `adel-` prefix dropped. **T42 recorded from upstream** (§1.2, §5.4, and the v0.2 row above): the rename makes this service's "two consumers" two iterations of one product rather than two products, so the adoption argument keeps its force — the overlap still spans two materially different governance models, per conceptual §1.5 — but loses the stronger claim that an unrelated consumer validated the shape. Consequently **PS7 §1.3's split-out trigger is not satisfied by maestro v1** and stays open. Recorded rather than glossed, and made upstream in the technical design rather than here. No gap, ADR assessment, or open item changed |
