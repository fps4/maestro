# UC1 — NL Construction — Use-Case Model, Agent Types, and Configuration Draft

**Status:** Draft v0.3 — for refinement
**Companions:** `conceptual-design.md` (v1.2) is authoritative for *what* and *why*; `technical-design.md` (v1.4) for the service set, build order, and substrate; the PS designs (`ps1-identity-service.md`, `ps2-record-spine.md`, `ps3-specs-service.md`, `ps7-data-service.md`, `ps14-work-service.md`, `ps15-agent-service.md`) for their own internals; `platform-standards.md` (v0.8) is this document's cross-domain twin. Precedence runs in that order and this document is wrong where it conflicts.
**Scope:** The first domain, modelled end to end — the standards, the agent types, the pack contents, and the configuration layer needed to run **one Dutch construction tenant** over the platform. **Not a pack.** This is the model that says what a pack must be able to hold and what it must not; the pack itself is authored in PS11, which does not exist yet (§7.5). **Not the platform's own standards** — the Tier 1 invariant catalogue, the build standards the composition plane emits against, and the frameworks the platform can claim are cross-domain and live in `platform-standards.md`; putting them here would be §16's leak inverted.
**Why this one:** §6 of the conceptual design says the platform's first domain is NL construction, and every document above it is deliberately domain-free. The result is that no document anywhere states what the domain actually requires — so the pack format, the seat set, and the configuration surface have all been designed against an abstraction rather than against a case. **T-F is open for exactly this reason** (*"what the demo use case actually is"*), and every finding below is the sort that only appears when a real domain is walked.
**Standing caveat, which is architectural and not a disclaimer:** every Tier 3 assertion in §3 is a **candidate** pending a named interpreting party (§5.3, D18). The platform gives no regulatory advice; it operationalises an interpretation attributed to someone else. Nothing here has an interpreting party yet, so nothing here is a standard yet — it is the shape of one.

---

## 1. What this document is

Three questions, walked from the domain rather than from the architecture:

1. **What does the domain actually require** — which instruments, which obligations, which parties, which calculations?
2. **What does that demand of the platform** — which seats, which agent types, which engines, which artifacts?
3. **What must be configurable, at which scope, by whom** — and what must never be?

The method is the one the technical design uses in §3.0 and PS14 uses in §2: **walk the source, do not enumerate from experience.** The difference is the source. Every document above this one derives from the conceptual design; this one derives from Dutch construction law, practice, and the shape of an aannemer's week — and then asks whether the platform can hold it.

**It found that it mostly cannot yet, in nine specific ways** (§8). That is the deliverable. A domain model that fits the architecture perfectly on the first walk has not been walked.

### 1.1 The test this whole document applies

§16 states the rule: **core carries zero domain knowledge; everything domain-specific lives in a pack.** Walking construction against that rule breaks it immediately — not because the rule is wrong, but because it names **two** homes and the domain needs **five**.

| Fact | Where §16 puts it | Where it can actually live |
|---|---|---|
| *Wkb requires a gereedmelding two weeks before use* | Pack | Pack ✅ |
| *This tenant's advisor accepted that reading on 3 March* | Pack | **Nowhere.** T29 forbids a shared service holding tenant runtime data (§3.6) |
| *This tenant chose O1 on release gates, below the O2 ceiling* | Pack | **Nowhere.** §12.5 makes it a client-facing dial and gives it no store (§7.2) |
| *This aannemer's meerwerk threshold is €2,500* | Pack | **Nowhere.** D17 calls it an extension point; PS3's S-E leaves its home open |
| *A run may spend 2M tokens* | Pack (PS15 §8.2) | Pack, wrongly — a token budget is not domain knowledge (§7.8) |

**One mechanism, five scopes.** That is the central structural finding, and §7 is the draft that resolves it.

---

## 2. The use case, bounded

### 2.1 The tenant

A **hoofdaannemer** (main contractor) in bouw & infra: 40–120 staff, 15–40 concurrent projects, a subcontractor and ZZP population two to five times the size of its payroll, working for a mix of consumer, commercial, and public opdrachtgevers. This is the shape §3.1's *twelve-person aannemer* scales up from and the one §14.11's adverse-selection risk applies to.

**Three properties of this tenant drive most of what follows:**

- **The obligated party is frequently not the tenant.** Under Wkb the bouwmelding and gereedmelding are the **initiatiefnemer's** (usually the opdrachtgever); the kwaliteitsborger is engaged by the opdrachtgever and is statutorily independent of the aannemer. The aannemer *supports* obligations that are formally someone else's, and its own obligations (waarschuwingsplicht, consumentendossier, opleverdossier) are different ones. §5.5's standard object has no `obligated_party` and the conformance record therefore cannot say **whose** conformance it asserts (§3.5, **C-B**).
- **Role collapse is the norm at the small end and absent at the large end.** §3.1 permits it with a recorded risk acceptance. A 40-person aannemer has a distinct directeur (Sponsor), werkvoorbereider or projectleider (Owner), and often no Steward at all — the Steward function is bought in. That is a fourth pattern §3.1 does not name: **not collapsed, but externally held.**
- **Everything is in Dutch.** Nothing in the design has a locale dimension anywhere (§8, finding 8).

### 2.2 Six applications, derived from §8's catalogue

Not invented — each is an archetype composition, and together they are the concrete test of §7.3's suspicion that *"construction demand is really six parameterised applications rather than per-tenant generation."*

| # | Application | Archetypes (§8) | Engines (§4.3) | Tier 3 in scope | Consequence |
|---|---|---|---|---|---|
| **U1** | **Meerwerk register** — change orders, stelposten, termijnstaten | Registry + Workflow and approval | AE1 | BW 7:755 (meerwerk), betalingstermijnen | Low–medium |
| **U2** | **Wkb dossier** — risicobeoordeling, borgingsplan, opleverdossier, consumentendossier | Document generation + Registry + Workflow | AE4, AE3, AE1 | **Wkb, Bbl, BW 7:757a** | **High — government filing** |
| **U3** | **Ketendossier** — subcontractor and ZZP compliance file | Registry + Document understanding + Rules | AE5, AE3 | **WKA, Wet DBA, Wav, Waadi, AVG** | **High — personal data at volume** |
| **U4** | **Urenregistratie en CAO-berekening** | Field capture + Rules and calculation | AE7, AE3 | **CAO Bouw & Infra, Arbeidstijdenwet** | **High — binding calculation** |
| **U5** | **Kwaliteits- en opleverpunten** — observations, punch list | Field capture + Registry + Workflow | AE7, AE1 | Arbowet (RI&E, V&G), Bbl evidence | Medium |
| **U6** | **Onderaannemersportaal** — subcontractor self-service | External portal + Integration | AE1, AE6, PS9 | AVG, WKA evidence intake | Medium–high |

**Read this table as a load test on §9's generation boundary, not as a roadmap.** It exercises every one of §8's four classification axes: all four data shapes; both actor topologies (U6 is the external population, T-K); both determinism requirements (U4 and U2 are binding, U1 and U5 are advisory); and both connectivity assumptions (U4 and U5 are a foreman on a bouwplaats with no signal — the case T16 says decides PS7's design now).

**Two of the six are the product and four are the on-ramp.** U2 and U4 are what a construction client pays for, and both are blocked on **AE3** — which is exactly what §4.4 predicts: *you can ship applications without AE3, but you cannot ship a regulated one.* U1 is §5.2's first demo pair and is deliberately the least valuable one.

### 2.3 What Phase 0 actually delivers — and the contradiction it exposes

§17 puts Phase 0 at **Explore only, plus onboarding at N0–N1**, with applications built by hand. For this tenant that means:

| Phase 0 deliverable | Requires | Status in the technical design |
|---|---|---|
| The Explore gate over real opportunities | Sufficiency standards, construction-flavoured | ✅ First wave (PS5, T7) |
| The opportunity and portfolio register | PS3 | ✅ First wave |
| **The gap register — "here is where your project administration fails Wkb"** | **Tier 3 conformance standards + tier resolution** | ❌ **Deferred to Phase 2** (§6) |
| Ops-as-a-service on their existing project administration | PS13, PS14, PS8 | ✅ First wave |
| A conformance record | PS12 (record only) | ✅ First wave |

**That third row is a genuine contradiction and it is the first finding.** §14.5 calls the gap register *"a product in itself … saleable with no delivery capability behind it at all"*; §17 puts onboarding at N0–N1 in Phase 0 *"and possibly ahead of it"*; §14.5's whole brownfield reading depends on the platform **assessing** standards against what it can observe below N2. All three require conformance standards at Tier 3. The technical design §6 defers *"conformance standards, tier resolution, Tier 3"* to Phase 2.

**So the thing Phase 0 is supposed to sell is built in Phase 2.** Either the gap register is not a Phase 0 product, or a subset of Tier 3 conformance evaluation is first wave. §9 records this as **C1**: the resolution is that **assessment-only Tier 3 is first wave and assertion-grade Tier 3 is Phase 2**, which is a distinction §14.5 already draws for a different purpose and which costs nothing to reuse.

---

## 3. Standards

**This section covers the *client's* obligations only** — what a Dutch aannemer must satisfy, evaluated against their business case and their applications. The standards the **platform** builds to, and the frameworks it can claim to a buyer or a regulator, are cross-domain and are in `platform-standards.md`. Three of that document's findings bear directly on this one: Tier 1's twenty-eight invariants are the floor under every application below (§3.3 there); the build standards are proportional to the consequence class this domain assigns (§4.1 there); and **BIO, Forum Standaardisatie, Peppol/NLCIUS, eHerkenning, IFC, DICO and VISI are conditional on what this tenant's clients are**, which makes them a `frameworks` field on §7.3's pack binding rather than pack content.

### 3.1 The honest boundary, stated before any content

P2 says a standard that cannot be automatically evaluated is guidance and carries no assurance weight. Walk Wkb against that and the obligations split cleanly in two:

| | Evaluable by the platform | Example |
|---|---|---|
| **Process and documentary conformance** | **Yes** | Was the bouwmelding lodged ≥4 weeks before start? Is the kwaliteitsborger's instrument admitted by the TloKB and current at the melding date? Does the opleverdossier contain every artifact class the Bbl requires? Is the waarschuwing in writing? |
| **Substantive technical conformance** | **No, ever** | Does this construction meet the Bbl's fire-safety, structural-safety, or energy requirements? That is the kwaliteitsborger's professional judgement, delivered as a verklaring, and it is not a query |

**This must be stated on the conformance record itself, not merely understood.** A Wkb conformance record that reads as if the platform assessed the building is the §14.11 governance-laundering failure with the platform as the launderer rather than the tenant. The platform asserts that the **process** was conformant and that the **verklaring** exists, is dated, and was issued by an admitted party. It asserts nothing about the building.

This is a general pattern, not a Wkb quirk: **most Tier 3 obligations decompose into an evaluable documentary half and a non-evaluable judgement half**, and §5.5's standard object has no way to say which half a check is (§3.5).

### 3.2 Tier 3 — the NL construction instrument set

Grouped by instrument, because §5.3.1 makes the **interpreting party per standard, not per pack** — and these are different instruments with different competent bodies.

| Instrument | Obligations the platform can evaluate | Competent interpreting party | Effective-dating character |
|---|---|---|---|
| **Wkb** (Wet kwaliteitsborging voor het bouwen) + **Bbl** under the Omgevingswet | Bouwmelding lead time and completeness; risicobeoordeling and borgingsplan present; kwaliteitsborger admitted under an instrument current at the date; gereedmelding lead time; opleverdossier composition; verklaring present and attributable | Kwaliteitsborger's instrument owner, or a certification body / branch organisation | In force for **gevolgklasse 1** since 1 Jan 2024; extension to gevolgklasse 2–3 is scheduled and **its date is a live watch item** (§5.4) |
| **BW book 7 title 12** (aanneming van werk) | Waarschuwingsplicht in writing (7:754); consumentendossier at oplevering (7:757a); the 5% opschorting/depot notice (7:768); meerwerk price agreement (7:755) | Construction-law practice or branch organisation | Stable; amended by Wkb |
| **CAO Bouw & Infra** | Working-time limits; roostervrije dagen; reisuren and reiskosten; toeslagen; functiegroep wage scales; verlof and duurzame-inzetbaarheidsbudget | CAO parties / a payroll practice | **Two effective-date dimensions**: the CAO period, and the AVV (algemeenverbindendverklaring) window, which do not coincide |
| **WKA / ketenaansprakelijkheid** + fiscal retention | Verklaring betalingsgedrag present and current per subcontractor; G-rekening usage and percentage; identity verification on file; administration retained (7 years general, **10 years for immovable-property VAT revision**) | Accountancy practice | Stable; percentages and thresholds move |
| **Self-employment** (Wet DBA and its enforcement posture) | **Documentary completeness only** — engagement terms, substitution clause, ondernemersrisico evidence, absence of a payroll relationship on file | Accountancy or employment-law practice | **Volatile.** Enforcement posture has moved repeatedly and is the sharpest watch item in the pack |
| **Wav / Waadi** | Work-authorisation documents for non-EEA workers; Waadi registration for any party lending labour | Employment-law practice | Stable |
| **AVG / UAVG** | Lawful basis recorded; minimisation; retention rule per category; erasure honoured; **BSN processed only where a statutory basis exists (UAVG art. 46)** | Privacy counsel | Stable, interpretation moves |
| **Arbowet / Arbobesluit** | RI&E present and current; V&G-plan for design and execution phases; melding to the Arbeidsinspectie where thresholds are met | Arbodienst or safety certification body | Stable |
| **Aanbestedingswet / UAV / UAV-GC** *(public work only)* | Contract-condition set declared; SROI commitments evidenced; sector security requirements on public contracts (§5.2's own example) | Procurement practice | Per tender |

**BTW verleggingsregeling** sits across two of these and is called out separately because it is the cleanest possible example for §4.5: VAT reverse charge in a subcontracting chain for *werken van stoffelijke aard* is a **binding calculation with legal consequence**, and P3 forbids a model from inferring it at runtime. It is AE3's, permanently.

### 3.3 Tier 2 — practice standards

§5.2 already gives four construction examples. Walking the six applications produces the rest; **all are overridable with recorded justification** (§11.4), which is what distinguishes them from the table above.

- A meerwerk record carries scope, price, and client acknowledgement **before work proceeds** *(§5.2's own)*
- A stelpost is settled against actual cost with evidence, never silently absorbed
- A quality observation carries evidence, location, and responsible party *(§5.2's own)*
- Cost is attributable to a cost code *(§5.2's own)*
- A subcontractor engagement references a verified entity — KvK number resolved, not typed *(§5.2's own)*
- A termijnstaat reconciles to the contract sum plus accepted meerwerk, and the reconciliation is shown
- An opleverpunt has a responsible party and a date before oplevering is recorded as complete
- Hours are attributed to a project and a person on the day they are worked, not reconstructed at week end
- A subcontractor invoice references a purchase commitment that existed before the work

**Tier 2 is where the platform's product knowledge lives and it is the layer clients will argue with.** Every override is a recorded exception with a named accepting party and an expiry (§11.4) — which makes the override ledger a direct read on where the pack disagrees with how this tenant actually works, and therefore the best available input to the next pack version.

### 3.4 Sufficiency standards, construction-flavoured

§5.1's generic examples plus what this domain adds. These are **first wave** and they are the entire Phase 0 product, so they matter more than anything else in this section.

| Sufficiency standard | Fails a case that… |
|---|---|
| *(generic, §5.1)* Names a measurable outcome, a beneficiary, and an instrumented series (§10.5) | …says "save time" |
| **Names the obligated party** | …assumes the tenant is obligated when the opdrachtgever is (§2.1) |
| **States which projects and which gevolgklasse are in scope** | …says "our projects" |
| **States whether persoonsgegevens of non-employees are in scope** | …forgets that ZZP'ers and subcontractor staff are data subjects too |
| **States whether the application produces or supports a filing to a bevoegd gezag** | …acquires a government-filing capability at Build that the Sponsor never priced (§11.2) |
| **Identifies which CAO or scheme applies, and its period** | …assumes one wage regime across a mixed payroll |
| **Records whether an accepting advisor relationship exists for each Tier 3 instrument in scope** | …reaches Build and discovers D23's shield is unavailable (§3.6) |
| **Existing-solution check has run against the tenant's own estate** | …rebuilds what the ketendossier already does |

### 3.5 Four things §5.5's standard object could not express

*Three of these were closed upstream by **D43** in conceptual design v0.9. They are kept here because this is where they were found and the argument is the evidence for the change; the fourth remains a modelling convention rather than a field.*

**a. The obligated party.** `applies_when` is a predicate over the business case or specification, so a standard can say *when it engages* and not *whose obligation it is*. In construction that is the difference between a conformance record the aannemer can show an opdrachtgever and one that quietly claims the opdrachtgever's compliance. → **`obligated_party`, closed by D43** and carried onto §5.8's record.

**b. Evidences versus decides.** `severity: blocking | warning | advisory` describes what a failure does; nothing describes what a *pass* means. A check that confirms the kwaliteitsborger's verklaring exists is evidence of a judgement someone else made; a check that confirms the bouwmelding lead time is a determination the platform can stand behind. Reading both as "conformant" is §3.1's failure. → **`assurance_kind`, closed by D43.**

**c. Expiry with no successor.** `effective_to` with `supersedes: null` and nothing following is the normal case for a CAO between periods, and for any instrument in a legislative gap. The design had no answer for what an application is during that window: non-conformant, unregulated, or frozen at last-known reading. → **`lapse_behaviour`, closed by D43**, with the pack stating which.

**d. Two effective-date dimensions — still open, and deliberately not a field.** The CAO's period and its AVV window do not coincide, and which one binds depends on whether the employer is a member of a contracting party. A second date pair on the object would be used once in this domain and confuse every standard that does not need it. **The convention instead: model it as two standards distinguished by an `applies_when` on membership.** Uglier to author, and it keeps the object honest — which is the same trade D43 made in rejecting a `conditional_on` field for something `applies_when` already expresses.

### 3.6 Interpreting party and acceptance — where D23 breaks on the flagship instrument

D23 is the recommended liability shield: one canonical interpretation in the pack, **accepted per tenant by the tenant's own advisor**, per standard, dated and named. §3.2 of the conceptual design names *"the client's own accountant, kwaliteitsborger, or equivalent."*

**For the accountant that model works. For the kwaliteitsborger it does not, and this is the sharpest finding in §3.**

| | Accountant (WKA, CAO, tax) | Kwaliteitsborger (Wkb) |
|---|---|---|
| Engaged by | The tenant, standing | The **opdrachtgever**, per project |
| Relationship stability | Years | One project |
| Independence | Professional | **Statutory** — must be independent of the aannemer |
| Acceptance scope | Per tenant, per standard | Per **project**, and not the aannemer's to obtain |

So for the platform's flagship regulated application (U2), **the accepting party is per project, changes between projects, is engaged by someone who is not the tenant, and is legally barred from acting in the tenant's interest.** D23's per-tenant acceptance model has no purchase there. Three consequences:

- **Acceptance granularity is per (tenant, standard) for some instruments and per (tenant, project, standard) for others.** Whatever holds acceptances must carry both.
- **§15.3's re-solicitation cost is worse than modelled for Wkb.** PS14 §9 makes fleet fan-out one item per affected tenant per standard; for a per-project instrument it is one per *project*, which is one to two orders of magnitude larger and is the number §5.3.2 says to size early.
- **The fallback in open question D — "a platform-designated party available as a paid option" — is not available for Wkb**, because the platform designating a kwaliteitsborger for its own client's project is exactly the independence the scheme regulates.

**And acceptance has no home at all.** It is tenant runtime data about a shared pack object. **T29 forbids PS11 from holding it** (*a service may be shared across tenants only if it holds no tenant runtime data*), PS5 is a pure evaluator, PS12 produces the conformance record but does not hold the input, and PS14 chases the re-solicitation without owning the result. §7.3's **pack binding** is this document's proposal for where it lives.

---

## 4. Agent types

### 4.1 Three planes, three kinds of agent, and they are routinely confused

| | Runs where | Governed by | Versioned as | Hands over at exit? |
|---|---|---|---|---|
| **Platform seat agent** | PS15, platform plane | O0–O4 seat occupancy (§12), ceiling from the pack | A **construct** at a version (PS15 §7) | **No** (E11) |
| **Application agent** | AE5, inside a generated application | A0–A4 autonomy on the application (§11.1) | Part of the generated application | **Yes**, with the application |
| **Not an agent** | AE3 | P3, Tier 1 | A versioned effective-dated rule | Yes |

**E-H is the open question that decides whether the first two share a deployable**, and construction sharpens it: U3's document understanding (reading a verklaring betalingsgedrag) and the platform's own case-shaping extraction are the same technical act on opposite sides of the exit boundary. If they share a runtime, a client's ketendossier depends on IP that does not transfer, which contradicts §13.5 in the one application most likely to be handed over in a dispute.

### 4.2 Platform seats — four exist, three are missing

§3.3 names four platform functions. Walking the construction case end to end — Explore, onboarding intake, pack maintenance, delivery, operations — turns up work that has no seat.

| Seat | §3.3 | Ceiling | Construction work it does |
|---|---|---|---|
| **Case shaping** | ✅ | O4 | Elicits the opportunity in Dutch from a werkvoorbereider; extracts facets; runs the existing-solution check against the estate; proposes the archetype match |
| **Platform architect** | ✅ | O2 / O3 | Archetype decomposition for U1–U6; partial-fit boundary on an onboarded project-administration package; the target architecture proposal |
| **Pack publication** | ✅ | O2 | Regulatory watch over the sources in §5.4; candidate impact set on a CAO period change; materiality classification |
| **Operations** | ✅ | O4 / O2 | Triage of S1–S5 on an onboarded application; restore-class remediation; escalation drafting |
| **Intake and condition assessment** | ❌ **missing** | — | §14.3's condition assessment, the instrumentation-contract check, the gap register, the reconstructed purpose and outcome. §14.9 governs *"who assesses condition"* as a seat and §3.3 never creates it |
| **Composition** | ❌ **missing** | — | PS15 §2 gives the composition plane a service; no document gives it a **seat**, so a composition run has nothing to resolve `seat` from and no ceiling |
| **Assurance narration** | ❌ **arguably missing** | — | PS5 evaluates and PS12 classifies, both deterministically. Turning a gap register into something a directeur can read is agent work with no seat, and §14.5 says the gap register is the product |

**And the meta-control cannot run.** §12.2 states the governance review agent *"does not occupy a seat"*. PS15 §4.1 makes `seat` a resolved envelope field on every run and §6's check 4 refuses an action the seat may not take at the current oversight level. **A meta-control that occupies no seat cannot be executed by the service designed to execute agents** — and if it is given one, §12.2's claim that it is not another seat is false. This is a direct contradiction between §12.2 and PS15, and it is not cosmetic: the meta-control is the thing that makes O3 and O4 falsifiable.

### 4.3 Constructs per seat

Constructs are pack content at a version (PS15 E5), and the test is §16's: **a construct carrying a domain term is pack content; a domain-free one is platform content.** Walking construction shows how thin that line is.

| Construct | Seat | Domain-bearing? | Home |
|---|---|---|---|
| Opportunity elicitation dialogue | Case shaping | **Yes** — it asks about projecten, bestek, oplevering, in Dutch | `nl-construction` pack |
| Facet extraction to PS3's schema (S4) | Case shaping | Borderline — the schema is platform, the vocabulary is not | **Split.** Extraction logic platform; term list pack |
| Existing-solution check | Case shaping | No | Platform |
| Archetype match candidate | Architect | No | Platform |
| Regulatory watch source monitor | Pack publication | **Yes** — the sources are Dutch | Pack |
| Candidate impact set on a source change | Pack publication | **Yes** | Pack |
| Condition assessment against the instrumentation contract | *(missing seat)* | No | Platform |
| Gap-register narration | *(missing seat)* | **Yes** — it explains Wkb to a directeur | Pack |
| Incident cause analysis | Operations | No | Platform |
| Composition of a specification into artifacts | *(missing seat)* | No | Platform |

**Two consequences.** First, **a platform pack exists** — PS15 §7 refers to *"the platform's own pack"* and §5.6 defines a pack as the unit of **domain** extension, so the platform pack is either an undocumented second kind or §5.6 needs widening. Second, **the split constructs are the dangerous ones**: an extraction prompt that starts platform-side and gains three Dutch examples has silently become domain knowledge in core, which is PS15's own §13 failure mode (*"prompts become code"*) arriving from the opposite direction.

### 4.4 Application-plane agents (AE5), per application

| Application | Agent work | Bounded by |
|---|---|---|
| **U3 ketendossier** | Read a KvK uittreksel, a verklaring betalingsgedrag, an ID document, a Waadi registration; extract issuer, date, validity | Extraction only. **Validity is a date comparison, not a judgement** — AE3 |
| **U2 Wkb dossier** | Classify uploaded artifacts against the required dossier composition; draft the covering narrative | Completeness is AE3's; drafting is advisory and never filed unreviewed |
| **U6 portaal** | Conversational intake for a subcontractor uploading documents | A0–A1 only; it proposes records, it accepts nothing |
| **U5 opleverpunten** | Photo-to-observation extraction on a bouwplaats, offline | AE7 for sync; extraction is advisory and confirmed by the uitvoerder |
| **U1 meerwerk** | Draft the meerwerk description from a bouwvergadering note | Advisory. Price is never model-produced (§4.5) |
| **U4 uren** | None. Deliberately | §4.5 |

### 4.5 What must never be an agent, in this domain

The list AE3 owns, permanently, under P3 and Tier 1. Naming it concretely is more useful than the principle, because every one of these is something a model can produce plausibly and wrongly.

CAO wage, toeslag, reisuren and verlof computation · BTW verleggingsregeling determination · G-rekening percentage and split · retention-period derivation from a classification rule · the 5% opschorting amount · meerwerk price arithmetic and termijnstaat reconciliation · bouwmelding and gereedmelding lead-time computation · every deadline derived from an `effective_from` (§5.7) · working-time limit evaluation under the Arbeidstijdenwet · SLA response and resolution targets **if service credits ever attach to them** (T-S, W-B).

**U4 is the whole argument for T14 in one application.** An hour-registration app that lets a model compute an allowance is a payroll error with a CAO behind it, arriving monthly, at scale, in a record an accountant will read.

---

## 5. What else the pack must carry

§5.6 lists eight kinds of pack content. Walking construction fills them in and adds two.

### 5.1 Ontology and vocabulary

§5.6 names it and no document says what it is, who reads it, or what form it takes. For construction it is unavoidable: **werkvoorbereider · uitvoerder · projectleider · calculator · hoofdaannemer · onderaannemer · ZZP'er · opdrachtgever · bevoegd gezag · kwaliteitsborger · werk · project · bestek · stelpost · meerwerk · minderwerk · termijnstaat · oplevering · opleverpunt · restpunt · bouwvergadering · weekrapport · mandagenregister · bouwmelding · gereedmelding · consumentendossier · opleverdossier · borgingsplan · risicobeoordeling.**

**Four consumers, none of which are named anywhere:** facet extraction (PS3 S4), duplicate and overlap detection (S11, which compares facets and therefore compares *terms*), document understanding (AE5), and every `applies_when` predicate that reasons about a construction concept. **The ontology has no owning consumer and no stated form** (**C-D**).

### 5.2 Reference data

Effective-dated, versioned, and part of the pack — with a hard split between what the pack ships and what a tenant sets (§7).

| Pack-supplied | Tenant-supplied |
|---|---|
| CAO functiegroep wage tables, per period | The tenant's own cost-code structure |
| Reiskosten and toeslag tables | Its meerwerk approval thresholds |
| BTW rates and the verleggings predicate | Its project numbering |
| G-rekening percentages | Its subcontractor whitelist |
| Bbl dossier composition requirements per gevolgklasse | Its document templates and huisstijl |
| NL-SfB / NLCS / STABU / RAW code sets | Its standard contract conditions selection |

### 5.3 Classification vocabulary and retention rules

PS7 §4.3 puts categories, retention rules, and lawful bases in the pack and carries a placeholder until PS11 exists. Construction's set:

```yaml
categories:  [ contact, employment, identification, health, financial,
               location, imagery ]        # imagery: a bouwplaats photo carries faces
lawful_bases: [ contract, legal_obligation, legitimate_interest, consent ]
retention_rules:
  nl-fiscal-7y:                  { years: 7,  basis: "AWR art. 52",           erasable: false }
  nl-vat-immovable-10y:          { years: 10, basis: "VAT revision period",   erasable: false }
  nl-wkb-dossier:                { years: 10, basis: "Wkb / BW 7:757a",       erasable: false }
  nl-employment-personnel-file:  { years: 2,  basis: "AVG minimisation",      erasable: true  }
  nl-identification-wka:         { years: 5,  basis: "WKA identification",    erasable: false }
  nl-site-imagery:               { months: 6, basis: "legitimate interest",   erasable: true  }
special:
  bsn:  { permitted_only_where: "statutory basis (UAVG art. 46)", categories: [identification] }
```

**Two things this makes concrete.** First, PS7 §4.1's rule 4 — *`erasable: false` requires a named overriding obligation* — has five real instances here, and they are the ordinary case rather than the exception. **A ZZP'er's erasure request against a chain-liability file must be refused with a named basis, not honoured**, and that refusal is itself an audit artifact. Second, **retention outlives the application by years** (§13.4): a Wkb dossier retained ten years against an application whose business case lasted eighteen months is exactly the case §13.4 warns no component may assume its own storage covers.

### 5.4 Regulatory watch sources

§5.4 says monitoring is automatable and detection is a solved problem. The Dutch source list, per instrument:

officielebekendmakingen.nl and the Staatsblad/Staatscourant feeds · wetten.overheid.nl for consolidated texts · the Toelatingsorganisatie Kwaliteitsborging Bouw register of admitted instruments and kwaliteitsborgers · the CAO parties and the AVV publications in the Staatscourant · Belastingdienst policy publications for WKA, G-rekening, BTW verlegging, and enforcement posture on self-employment · Nederlandse Arbeidsinspectie · Autoriteit Persoonsgegevens · the Omgevingsloket / DSO release notes for filing-interface changes.

**The last one is a source class §5.4 does not contemplate: an interface change is not a legal change, and it breaks a connector rather than a standard.** It needs the same watch and a different artifact.

### 5.5 Connectors, and the capability grants they need

Connector *definitions* are pack content (§4.2); the engine is AE6; enforcement is PS9. Every outbound one is a P8 grant with a volume ceiling, value ceiling, approval threshold, and reversal path (§11.2).

| Connector | Direction | Grant shape | Reversal path |
|---|---|---|---|
| **Omgevingsloket / DSO** — bouwmelding, gereedmelding | Outbound | **§11.2's own government-filing example.** Approval threshold at O2, per filing | Intrekken/corrigeren — **exists but is not symmetric with submission** |
| **Belastingdienst** — verklaring betalingsgedrag | Inbound | Read-only, rate-limited | n/a |
| **KvK** — entity verification | Inbound | Read-only, volume ceiling | n/a |
| **Payroll** (AFAS / Nmbrs / Exact) | Outbound | Value ceiling per run; **binding, so AE3 computes and AE6 only transports** | Correction run |
| **Accounting** | Bidirectional | Value ceiling | Journal reversal |
| **Kwaliteitsborger instrument tooling** | Bidirectional | Per project | Varies by instrument — **not the platform's to guarantee** |

**The DSO row is the one to design against.** A filing to a bevoegd gezag is high-consequence, has an asymmetric reversal path, and §11.2 already says the capability request originates in Explore so the Sponsor knows before committing. It is also the clearest case where the **Prove** phase is dangerous: §10.1 relaxes conformance bars at Prove, and a relaxed bar plus a live filing capability means submitting non-conformant work to a regulator. §9 records this as **C7**: **Prove is bounded by autonomy, not only by standards weight** — no capability grant that reaches an external system is available before Build.

### 5.6 Golden fixtures

§15.4 warns derived coverage will be thinnest exactly where it is needed. Construction's edge cases, offered as the first fixture set:

A meerwerk settled against a stelpost with a partial credit · an hour week crossing a CAO wage-table change mid-period · a gereedmelding lodged 13 days before use *(one day short)* · a kwaliteitsborger whose instrument admission lapsed between bouwmelding and gereedmelding · a subcontractor whose verklaring betalingsgedrag expired mid-project with invoices on both sides of the date · an erasure request from a ZZP'er whose chain-liability file is `erasable: false` · a CAO period ending with no successor published *(§3.5c)* · a project where the tenant is the onderaannemer and the obligated party is two links up · a bouwplaats photo containing a face, uploaded offline and synced four days later.

**Every one of these is a fixture that could only come from the domain**, which is §15.4's point: the criteria-derived suite will contain none of them.

---

## 6. Sequencing: what this use case actually needs, when

Not a new build order — a read of the existing one (§5 of the technical design, §17 of the conceptual) against this domain.

| Wave | Platform | What the construction tenant gets |
|---|---|---|
| **Phase 0** | PS1–PS4, PS5 *(sufficiency)*, PS8, PS11 *(one pack)*, PS12 *(record)*, PS13, PS14 | Explore over real opportunities; the register; ops on their existing estate; **the gap register, if C1 is accepted** |
| **Phase 1** | + composition, AE1, PS7 record | **U1 meerwerk register.** Proves generation, sells little |
| **Phase 2** | + **AE3**, Tier 3 assertion-grade, interpreting party engaged | **U4 uren en CAO.** The first application worth paying for |
| **Phase 3** | + AE4, PS9, PS10, delivery plane, N2 onboarding | **U2 Wkb dossier.** The flagship, and the first government filing |
| **Phase 4** | + AE5, AE6, AE7, PS12 scheduled, regulatory watch | **U3, U5, U6.** The estate |

**The order is forced by AE3 and by nothing else.** U2 and U4 are the product; both are blocked on the calculation engine; §5.2 already puts AE3 second. What this walk adds is that **the interpreting party must be engaged before Phase 2, not before Phase 3** — §17 puts the partnership at Phase 2 and the flagship application at Phase 3, which is right, but §3.6 shows the Wkb relationship is per-project and cannot be signed once. That negotiation should start at Phase 0.

---

## 7. The configuration layer — draft

### 7.1 Five scopes, not one

The proposal that resolves §1.1. Each scope has a distinct owner, a distinct change mechanism, a distinct lifetime, and a distinct exit treatment — which is the test for whether it is genuinely a separate scope rather than a section of the pack.

| Scope | Bound to | Changed by | Versioned how | At exit |
|---|---|---|---|---|
| **1. Platform policy** | The platform release | Platform architect | With the release | n/a — it is the platform |
| **2. Domain pack** | `nl-construction@x.y.z` | Pack publication seat, through a PS4 gate | Effective-dated, materiality-classified (D24) | Dated snapshot (D21) |
| **3. Tenant binding** | `(tenant, pack)` | Owner and Steward, with the accepting advisor | Versioned, gated | **With the tenant — it is theirs** |
| **4. Application configuration** | `(specification, tenant)` | Owner, through the specification gate | A specification version (D17's extension points) | With the application |
| **5. Instance configuration** | `(instance)` | Operations | Deployment state, not a governance artifact | With the deployment |

**The dividing rule, and it is mechanical:** *scope 2 is shared across tenants and therefore may hold nothing tenant-specific (T29); scope 3 exists because of that constraint and for no other reason.*

### 7.2 Scope 3 is missing from the design and half the design depends on it

Every one of these is a decision the design assigns to "the pack" or to "the client" and gives no store:

| Decision | Assigned in | Actually is |
|---|---|---|
| Advisor acceptance per standard | D23, §5.3.2 | `(tenant, standard)`, and `(tenant, project, standard)` for Wkb (§3.6) |
| Which pack version is in force | §5.7 | `(tenant, pack)` — a fleet cannot be upgraded atomically |
| Oversight level chosen within the ceiling | §12.5 — *"a client-facing dial"* | `(tenant, seat)` |
| Isolation level L1 or L2 | §3.3 of the technical design — *"a deployment choice"* | `(tenant)` |
| Tier 2 overrides with justification and expiry | §11.4 | `(tenant, standard)` |
| Role collapse risk acceptance | §3.1 | `(tenant)` |
| Retention beyond the pack minimum | PS7 §4 | `(tenant, category)` |
| Escalation contacts and channels | T-J, W10 | `(tenant, seat)` |
| Consequence-class policy | §10.2 | `(tenant)`, within a platform floor |

**Nine tenant-scoped configuration decisions, no artifact, no service.** The pack binding proposed below is one object that holds all nine, is versioned like everything else, and passes through a gate like everything else.

### 7.3 Draft — the pack binding

```yaml
pack_binding:
  tenant:            tnt-aannemer-x
  version:           4                         # versioned and gated like any artifact
  packs:
    - pack:          nl-construction
      pinned:        3.2.0
      upgrade:       notify                    # notify | auto-minor — never auto on material (D24)
  isolation_level:   L1                        # §3.3 of the technical design
  consequence_policy:
    default:         c2
    escalate_when:                             # raises the class, never lowers it
      - { predicate: "filing_to_bevoegd_gezag", class: c4 }
      - { predicate: "binding_calculation_on_pay", class: c4 }
      - { predicate: "persoonsgegevens_of_non_employees", class: c3 }
  oversight_choices:                           # within pack ceilings; never above (§12.5)
    release_gate:    O1                        # ceiling O2 — this tenant chose more human, not less
    case_shaping:    O3                        # ceiling O4
  elected_standards:                           # raises only, never lowers (§4.5, V39)
    - { standard: OWASP-ASVS, level: L3, above: L2, priced: true }
    - { standard: WCAG-2.2,   level: AAA, above: AA, priced: true }
    - { standard: RUNTIME-ISOLATION, level: per_application,
        above: per_tenant,                     # PLAT-RUN-001's dial (T45) — V-O's answer
        priced: true, requires_level: n2 }     # gate 2: authority to enforce (D30)
  data_residency:    eu-nl                     # V21 — refusable per action, not advisory
  ai_terms:                                    # V20 — absent or lapsed is a refusal at egress
    no_training:     required
    retention:       { max_days: 0 }
    sub_processors:  declared
  conditional_frameworks:                      # binds by who the TENANT's clients are (V6, C5)
    - { framework: BIO,  because: "opdrachtgever is a public body", detected_at: intake }
    - { framework: FORUM-STANDAARDISATIE, profile: [api-design-rules, digikoppeling,
                                                    nl-gov-oauth, nlcius] }
    - { framework: ARCHIEFWET, metadata: mdto, criteria: duto,
        because: "records become public records on transfer" }
  acceptances:
    - standard:      NL-WKA-VERKLARING-001
      scope:         tenant
      accepted_by:   { party: "Boekhoudkantoor Y", person: "…", role: accountant }
      at:            2026-03-03
      pack_version:  3.1.0                     # lapses on a material change (§5.7)
      status:        active
    - standard:      NL-WKB-GEREEDMELDING-001
      scope:         project                   # §3.6 — Wkb acceptance is per project
      project:       prj-2026-114
      accepted_by:   { party: "Borger Z B.V.", instrument: "INST-004", role: kwaliteitsborger }
      at:            2026-06-11
      pack_version:  3.2.0
      status:        active
  overrides:                                   # Tier 2 only (§11.4)
    - standard:      NL-BOUW-COSTCODE-002
      justification: "cost codes migrate in Q4"
      accepted_by:   usr-j-dekker
      expires:       2026-12-31
  retention_overrides:
    - { category: imagery, rule: nl-site-imagery, extend_to_months: 12, basis: "dispute window" }
  role_collapse:
    - { principal: usr-j-dekker, roles: [sponsor, owner], accepted_at: 2026-02-01 }
  escalation:
    - { seat: operations, channel: sms, contact_ref: ps7://contact/… }
```

**Four properties, each of which is the reason it is a separate object rather than a section of the pack.** It is tenant runtime data, so T29 keeps it out of PS11. It changes on the tenant's clock, not the pack's. It is a governed artifact — an acceptance and an override are both decisions with an accountable human — so it belongs on the chain of record and passes a PS4 gate. And **it hands over at exit as the tenant's own record of what it accepted and why**, which is a materially better artifact than the dated pack snapshot D21 already promises.

**Where it lives is settled** (**C-A**, closed by **S17** in `ps3-specs-service.md` v0.2): **a fifth artifact type in PS3**. It is versioned, gated, diffable, lineage-bearing and hands over at exit, which is that service's shape exactly — and because artifact types are *workspace configuration* rather than code (S16), adding it costs a definition rather than a release. PS11 was ruled out by T29, not by preference: a service shared across tenants may hold no tenant runtime data, and every field above is precisely that.

**One consequence worth stating.** The acceptances are per standard *and* per project (§3.6), so they are a repeating structure — and a gate reads facets, never the body, so they must be facets. That makes this type's facet schema much larger than a business case's. If that turns out to be a problem it is a problem with facets, not with the binding (**S-I** there). **v0.3's two new blocks make it larger again**, which is now the third artifact pushing the same question and is PS3's **S-K**.

**`elected_standards` and `conditional_frameworks`, new in v0.3, and the pair is deliberately two fields rather than one** (**C12**; `platform-standards.md` **V39**, **V40**, and **V6** at last — recorded as an upstream change in **13.12** since v0.2 and made here).

**The asymmetry was already in this file twice before it had a name.** `consequence_policy.escalate_when` says *raises the class, never lowers it*; `oversight_choices` says *within pack ceilings; never above*. §4.5 of the standards document generalises that into the rule for all build standards — ***a tenant may tighten and may never loosen*** — and `elected_standards` is its third instance here. **Every entry is a raise with the thing it raises named on the same line**, which is what makes it checkable rather than a list of preferences: `above:` is not documentation, it is the assertion PS5 evaluates the election against.

**`requires_level` is the gate that stops a sale becoming a defect.** §13.2 commits availability and response at N1 and **correctness only from N2** (D30), so an elective the platform lacks the authority to enforce is a promise it cannot keep — §14.11's *selling correctness at N1* with a standard's name attached. Runtime isolation carries it because isolation is enforceable only where the platform controls deployment.

**The two blocks are separate because declining is available in exactly one of them.** An **election** is a commercial conversation: the tenant chose it, it is priced, and it raises what that tenant's applications claim. A **conditional** is a fact about the tenant's obligations — BIO binds because the opdrachtgever is a public body, the Archiefwet binds because records become public records on transfer, and neither is anybody's preference. **This is scope 3 from the platform side** and it is the shape §7.2 has been calling structurally missing: an obligation that arrives through the tenant's clients rather than through the tenant. **Selling a conditional as an upgrade is mis-selling**, and it is an easy mistake to make with one field.

**`detected_at: intake` is the honest part and it is also the exposure.** The platform learns who the tenant's clients are from the tenant. A tenant that under-declares gets an application that looks compliant against the wrong obligation set — **S4's facet-quality problem arriving on the binding rather than on a business case**, where it is less visible and considerably more consequential. Carried as **V-U** upstream and as **C-H** here.

### 7.4 Draft — a standard object, with §3.5's four additions

```yaml
standard:
  id:                  NL-WKB-GEREEDMELDING-001
  kind:                conformance
  tier:                regulatory
  domain_pack:         nl-construction
  version:             3.2.0
  effective_from:      2024-01-01
  effective_to:        null
  supersedes:          null
  interpreting_party:  { party: "…", arrangement: A, attested: false }   # §5.3.1 — A is what we have
  obligated_party:     initiatiefnemer                 # D43 — §3.5a. Not the tenant
  assurance_kind:      determines                      # D43 — §3.5b: determines | evidences | records
  lapse_behaviour:     freeze_at_last                  # D43 — §3.5c: fail | unregulated | freeze_at_last
  applies_when:        "gevolgklasse == 1 && bouwwerk_type in [...]"
  consequence_class:   c3
  assertion:           "gereedmelding.lodged_at <= use_start - P14D
                        && dossier.complete_for(gevolgklasse)
                        && verklaring.present && verklaring.issuer.admitted_at(gereedmelding.lodged_at)"
  severity:            blocking
  evidence_required:   [ gereedmelding_receipt, dossier_manifest, verklaring_document ]
  remediation:         "block gereedmelding submission; raise obligation item with deadline"
  source:              "Wkb / Bbl — citation"
  review_due:          2026-12-31
```

**Locale is on the pack, not on the standard.** `nl-construction` is nl-NL by definition, so a per-standard field would be identical on every row. It is reserved as an override for the one case that needs it — a genuinely bilingual pack such as a Belgian one carrying nl-BE and fr-BE — and not shipped until that pack exists.

Note `interpreting_party.arrangement: A` and `attested: false`. §5.3.1 says **B is the target and A is what you will actually have at the start**, and the gap between them is where the exposure sits. **Recording the arrangement on every standard turns that paragraph into a queryable count**, which is the same move E12 makes for model-provider exposure and W6 makes for escalation rates.

### 7.5 Draft — policy blocks, and the finding they carry

PS4's ceilings, PS14's targets and chase ladder, PS7's retention rules, PS15's run ceilings, and PS3's facet schema have all been assigned to PS11 by their own service designs. Collected, they look like this:

```yaml
# nl-construction pack — policy
oversight_ceilings:                       # §12.5 — a pack may lower, never lift
  release_gate:      { tier3_in_scope: O2, otherwise: O3 }
  steward_signoff:   O2
  case_shaping:      O4
work_policy:                              # PS14 §6.1, W10
  targets:
    - { severity: s1, criticality: high, onboarding: n2, respond: PT1H, resolve: PT8H }
  chase_ladder:
    id: pol-nl-bouw-esc@2
    steps: [ reminder, chase, escalate_accountable, escalate_steward, breach ]
run_ceilings:                             # PS15 §8.2  ← see below
  - { construct_class: extraction, autonomy: a1, steps: 20, tokens: 500_000, cost_eur: 3.00 }
```

**`run_ceilings` does not belong here and neither do most of `work_policy`'s numbers.** A token budget is not Dutch construction knowledge. Response targets partly are — *how hard you chase a Wkb deadline* is domain (W10 is right) — but *how many steps an extraction run may take* is a platform operating parameter that would have to be duplicated, identically, into every future pack. **This is scope 1 wearing scope 2's clothes**, and it is what happens when a design has one configuration mechanism: everything that is not code becomes pack content by elimination. §9 records it as **C8**.

### 7.6 Draft — application configuration (D17 extension points)

The surface that stops every tenant forking on day one (§7.3) — shown for U1, the simplest.

```yaml
extension_points:                          # declared on the generative specification
  meerwerk_threshold:      { type: money, default: 1000_00, tenant_settable: true }
  approval_chain:          { type: enum, options: [owner, owner_then_directeur], default: owner }
  cost_code_scheme:        { type: reference_data, source: tenant }
  client_ack_required:     { type: bool, default: true, tenant_settable: false }   # Tier 2 standard
  document_template:       { type: template_ref, source: tenant }
  labels:                  { type: locale_bundle, locale: nl-NL }
```

**`tenant_settable: false` on `client_ack_required` is the load-bearing entry.** §5.2's Tier 2 standard requires client acknowledgement before work proceeds; exposing it as configuration would let a tenant turn off a standard by editing a form. **An extension point that can disable a standard is not an extension point, it is an undeclared override** — and §11.4 already has a mechanism for overrides that carries a justification, a named accepting party, and an expiry. The two must not be confusable. This is the sharpest thing S-E has to decide.

### 7.7 What is deliberately not configuration

Recorded because an unstated exclusion will not hold, and because each of these is something a client will eventually ask for.

Tier 1 standards · absolute oversight ceilings · the archetype catalogue · the generation boundary · the six PS14 work classes · the five PS15 run outcomes · PS7's classification envelope · tenant isolation topology · whether a write proposes · whether the accountable party is human.

---

## 8. Gaps and inconsistencies, ranked

Ranked by whether they change a decision.

| # | Finding | Where it lands |
|---|---|---|
| **1** | **Tier 3 conformance evaluation is deferred to Phase 2, and the Phase 0 gap register requires it.** §14.5 and §17 make the gap register the first sellable thing; the technical design §6 defers what produces it | §2.3 · **C1** |
| **2** | **Advisor acceptance has no home.** It is tenant runtime data about a shared pack object, so T29 forbids PS11 from holding it, and no other service owns it | §3.6 · **C2**, **C-A** |
| **3** | **D23's per-tenant acceptance model does not fit Wkb.** The kwaliteitsborger is per project, engaged by the opdrachtgever, and statutorily independent of the tenant — and the platform-designated fallback is unavailable for the same reason | §3.6 · **C3** |
| **4** | ~~**§5.5's standard object cannot express four things the domain requires**~~ — **closed as D43 (conceptual v0.9)** for three of them; the fourth, the CAO's second date dimension, is a modelling convention rather than a field | §3.5 · **C4** |
| **5** | **Configuration has five scopes and one mechanism.** Nine tenant-scoped decisions are assigned to "the pack" or "the client" with no artifact and no service | §7.1–§7.3 · **C5** |
| **6** | **Three platform seats are missing** (intake, composition, assurance narration), and **§12.2's meta-control cannot execute** under PS15's seat-mandatory run model | §4.2 · **C6** |
| **7** | **Prove relaxes conformance bars while a filing capability may exist.** For U2 that means submitting non-conformant work to a bevoegd gezag | §5.5 · **C7** |
| **8** | **`consequence_class` collides with Wkb's gevolgklasse.** Same words, different meanings, both present on a construction business case. The design has renamed ladders for exactly this reason before (v0.3, A0–A4 and S1–S5) | **C9** |
| **9** | **No locale dimension anywhere.** The tenant works in Dutch; the specification body (open question **A**) has no language; the marketplace trades specifications across tenants; the pack is intrinsically Dutch | §7.4 · **C10** |
| **10** | **The ontology has no consumer and no form**, while facet extraction, duplicate detection, document understanding, and `applies_when` all depend on it | §5.1 · **C-D** |
| **11** | **A platform pack exists but is not defined.** PS15 §7 refers to it; §5.6 defines a pack as the unit of *domain* extension | §4.3 · **C-C** |
| **12** | **An interface change is a watch-source class §5.4 does not contemplate.** A DSO release breaks a connector, not a standard, and needs a different artifact | §5.4 |

---

## 9. Decisions

*Proposed by this document, which is subordinate to all three above it. Where a decision below implies a change upstream, §10 records it rather than making it.*

| # | Decision | Rationale |
|---|---|---|
| **C1** | **Tier 3 evaluation splits by §14.5's existing distinction: assessment-grade is first wave, assertion-grade is Phase 2** | §14.5 already separates *assessed* from *asserted* conformance for the brownfield case. Reusing it costs nothing and closes the contradiction between §17's Phase 0 gap register and the technical design's Phase 2 deferral. Assessment needs no interpreting party because it asserts nothing |
| **C2** | **Advisor acceptance is held in a tenant-scoped, versioned, gated **pack binding**, never in PS11** | T29 is not negotiable: a shared service holding tenant runtime data has become a pooled data plane with a control-plane label. Acceptance is the clearest instance and there are eight more (§7.2) |
| **C3** | **Acceptance granularity is per `(tenant, standard)` or per `(tenant, project, standard)`, declared on the standard** | Wkb's accepting party is per project and statutorily independent; the accountant's is per tenant and standing. One granularity cannot hold both, and guessing wrong makes §15.3's re-solicitation cost wrong by an order of magnitude |
| **C4** | **`obligated_party`, `assurance_kind`, and `lapse_behaviour` are added to the standard object; locale stays on the pack and the CAO's second date dimension stays a modelling convention** | Each of the three was found by writing a real standard and failing. Without `assurance_kind` a Wkb conformance record reads as if the platform assessed the building, which is §14.11's governance laundering with the platform as launderer. The two that were trimmed would each have been used once in this domain and been noise on every other standard. **Closed upstream as D43, conceptual design v0.9** |
| **C5** | **Configuration has five scopes with distinct owners, lifetimes, and exit treatments; scope 3 (tenant binding) exists because T29 forbids scope 2 from holding tenant data** | One mechanism means everything that is not code becomes pack content by elimination, which is how a token budget ends up in a Dutch construction pack (C8) |
| **C6** | **Intake, composition, and assurance narration are named seats; the meta-control's execution identity is resolved explicitly rather than left as a contradiction** | §14.9 governs seats §3.3 never created, and PS15 cannot start a run without a seat. A meta-control that cannot execute makes O3 and O4 unfalsifiable, which is the thing §12.2 exists to prevent |
| **C7** | **Prove is bounded by autonomy, not only by standards weight: no capability grant reaching an external system is available before Build** | §10.1 relaxes conformance at Prove and says nothing about capability. For U2 the combination is a non-conformant filing to a regulator |
| **C8** | **Platform operating parameters — run ceilings, engine budgets — are scope 1, not pack content, even though PS15 §8.2 currently places them in PS11** | They are not domain knowledge and would be duplicated identically into every future pack. §16's rule protects core from domain leakage; nothing currently protects the pack from platform leakage |
| **C9** | **The platform's consequence class is renamed to avoid collision with Wkb's gevolgklasse** | Both appear on the same business case. v0.3 renamed A0–A4 and S1–S5 for exactly this reason, and doing it after records exist is expensive |
| **C10** | **Locale is a dimension on the pack, on specification bodies, and on generated surfaces — not on individual standards** | The user is a werkvoorbereider and everything they touch is Dutch; the marketplace trades specifications across tenants; open question **A** has no language and cannot stay that way. Pack level covers every case until a bilingual pack exists, and a per-standard field before then is identical on every row |
| **C11** | **This document's Tier 3 content is candidate, not standard, until a named interpreting party is attached per instrument** | §5.3's whole position is that the platform operationalises someone else's interpretation. Content authored here with no party attached and then published would be arrangement A presented as arrangement B |
| **C12** | **The pack binding carries `elected_standards` and `conditional_frameworks` as two fields, not one: an election is a priced raise the tenant chose and may decline, a conditional is a fact about the tenant's obligations that the platform must detect and apply** | `platform-standards.md` **V39** and **V40**, with **V6** made here at last. The asymmetry was already in §7.3 twice unnamed — `escalate_when` raises and never lowers, `oversight_choices` sit within ceilings — so this is its third instance rather than a new idea. **Two fields because declining is available in exactly one of them**: BIO binds because the opdrachtgever is a public body and nobody chose that, while ASVS L3 is a purchase. Collapsing them would make **mis-selling the default failure** — a conditional presented as an upgrade — and `above:` and `requires_level:` on an election are assertions PS5 evaluates rather than documentation, the second because §13.2 commits correctness only from N2 (D30) |

---

## 10. Changes required elsewhere

*Recorded here, made upstream. This document does not edit its companions.*

**10.1 ✅ Made — `conceptual-design.md` v0.9, D43.** The standard object gained `obligated_party`, `assurance_kind`, and `lapse_behaviour`; §5.8's conformance record carries the first two; §5.2 was clarified that "never overridable" is not "unconditional", since D28 has made Tier 1 conditional since v0.4. Locale went to the pack and `conditional_on` was rejected as a second way to say `applies_when` (C4, C10).

**10.2 `conceptual-design.md` §5.3.2 and §3.2 — acceptance granularity and the independence problem** (C2, C3). §3.2 lists the kwaliteitsborger as an accepting advisor alongside the accountant; §3.6 shows they are structurally different parties. §5.3.2's fallback — *a platform-designated party available as a paid option* — must be marked unavailable where the accepting party's independence is statutory.

**10.3 `conceptual-design.md` §16 and §5.6 — the pack is not the only configuration scope** (C5). §16's rule is correct and incomplete: it names core and pack and the design needs five. §5.6 should also define the **platform pack** PS15 §7 already refers to (C-C).

**10.4 `conceptual-design.md` §3.3 and §12.2 — three seats and a contradiction** (C6). §3.3 gains intake, composition, and assurance narration; §12.2's *"does not occupy a seat"* must be reconciled with PS15 §4.1's mandatory `seat`.

**10.5 `conceptual-design.md` §10.1 — Prove's relaxation is bounded by autonomy** (C7). One sentence: *no capability grant reaching an external system is available before Build.*

**10.6 `conceptual-design.md` §10.2 and §12.3 — rename the consequence class** (C9), and §5.5's `consequence_class` with it.

**10.7 `technical-design.md` §6 — split the Tier 3 deferral** (C1). *Conformance standards, tier resolution, Tier 3* becomes two rows: assessment-grade first wave, assertion-grade Phase 2. §5.1's PS5 gate needs a matching row, and §17's Phase 0 claim about the gap register then holds.

**10.8 `ps15-agent-service.md` §8.2 — run ceilings move out of the domain pack** (C8), into whatever scope 1 turns out to be. §7.5's argument applies to PS14's non-domain targets identically.

**10.9 `ps3-specs-service.md` — the pack binding as a fifth artifact class** (C2, and S-E). It is versioned, gated, diffable, and lineage-bearing, which is PS3's shape; and S-E's question about where extension points live is the same question one scope down.

**10.10 `ps7-data-service.md` §4.3 — the placeholder vocabulary has a candidate** (§5.3). Categories, lawful bases, and eight retention rules, five of which are `erasable: false` with a named overriding obligation — which makes PS7's rule 4 the ordinary case in this domain rather than the exception.

**10.11 `conceptual-design.md` §5.4 — interface change is a watch-source class.** A DSO release note breaks a connector rather than a standard, and produces a different artifact.

---

## 11. Open

- ~~**C-A.**~~ **Closed** by **S17** — a fifth artifact type in PS3, which is a workspace-definition change rather than a release (S16). *The T-D/T-M/T-R shape did not recur here: a thing that is versioned, gated and lineage-bearing in a service that already does all three is a type, not a service.*
- **C-B.** **Whether the conformance record can assert conformance for a party that is not the tenant.** Under Wkb the aannemer supports an obligation the opdrachtgever holds. A record that says *we conformed* is wrong; one that says *we supported the initiatiefnemer's conformance* is right and has no schema.
- **C-C.** **Whether the platform pack is a pack.** If it is, §5.6's *unit of domain extension* is wrong. If it is not, PS15's platform-side constructs need a home that is neither core nor pack.
- **C-D.** **The ontology's form and its consumer.** A term list, a typed graph, or a facet vocabulary. It is read by four things and owned by nothing.
- **C-E.** **Whether the tenant may author its own constructs.** A tenant will want its own meerwerk wording and its own site vocabulary. Core forbids it (§16), the shared pack cannot hold it (T29), and scope 3 is not currently a construct home. This is C5 arriving from the agent side.
- **C-F.** **Whether U2's Wkb dossier is one application or two.** The opleverdossier for the bevoegd gezag and the consumentendossier for a private client have different obligated parties, different recipients, and different retention — and modelling them as one application with a flag is the same error S10 rejects for the intake assessment.
- **C-H.** **How a conditional framework is detected when the platform learns the predicate from the party it binds.** §7.3's `conditional_frameworks` carries `detected_at: intake`, and intake is a conversation with the tenant. BIO binds because the *opdrachtgever* is a public body — a fact the aannemer knows and has a mild interest in not volunteering, since it raises their obligations. **A tenant that under-declares receives an application that looks compliant against the wrong set**, and every downstream artifact reports success. Candidate detectors exist and none is conclusive: the KVK register says what a counterparty *is*, a VISI or DICO exchange says who is on the project, and an eHerkenning chain authorisation says who is delegating. This is **S4's facet-quality problem** on the least visible artifact in the estate, and it is **V-U** upstream.
- **C-G.** **How the six applications are priced against open question N.** Six applications per tenant at first sale is exactly the unbounded-estate problem N names, arriving immediately rather than eventually.

*Inherited:* **T-F** (what the demo use case is — §2.2 is the first concrete answer), **A** (specification representation — C10 adds a locale constraint to it), **B** (business case format — §3.4 is the construction half of it), **D** (advisor fallback — C3 narrows it and shows the fallback is unavailable for Wkb), **G** (materiality classification and its signatory — §3.2's CAO and self-employment rows are where it will first hurt), **J** (condition assessment into pricing — §2.1's tenant is the shape it must price), **O** (the user interface — everything in §2.2 is Dutch and nothing in the design has a locale), **T-J** and **W10** (pack-supplied versus platform-provided — §7.5 splits it), **E-H** (PS15 versus AE5 — §4.1 gives it a concrete case), **S-E** (extension points — §7.6 gives it a hard constraint).

---

## 12. Change log

| Version | Date | Change |
|---|---|---|
| 0.3 | 2026-08-08 | **§7.3 gains `elected_standards` and `conditional_frameworks`, and the second has been owed since that document's v0.2** — `platform-standards.md` **13.12** asked for it against **V6** and it was never made. **13.15's `data_residency` and `ai_terms` land in the same block** (**V21**), because §4.7 upstream now lists *a narrower processing jurisdiction* as an elective and an elective with no field to raise is a table entry. **C12** keeps them as two fields rather than one, which is the whole substance of the change: an **election** is a priced raise the tenant chose and may decline, a **conditional** is a fact about the tenant's obligations that the platform must detect and apply. **Collapsing them makes mis-selling the default failure** — BIO presented as an upgrade — and there is no version of that mistake that is cheap. **The asymmetry this file had already invented twice now has a name.** `escalate_when` says *raises the class, never lowers it*; `oversight_choices` says *within pack ceilings; never above*; §4.5 upstream generalises both into ***a tenant may tighten and may never loosen***, and `elected_standards` is its third instance here. Every election names what it raises on the same line, because `above:` is an assertion PS5 evaluates rather than documentation — and `requires_level:` is the gate that stops a sale becoming a defect, since §13.2 commits correctness only from **N2** (D30) and an elective the platform cannot enforce is §14.11's *selling correctness at N1* with a standard's name attached. **The conditional set is enumerated rather than exemplified**: BIO, Forum Standaardisatie's *pas toe of leg uit* profile, and the Archiefwet with MDTO metadata against the DUTO criteria — the last of which nothing in the estate had named, and which binds whenever a tenant's records become public records on transfer. **C-H opened, and it is the sharpest thing v0.3 surfaces**: the platform learns the predicate from the party it binds, and an aannemer has a mild interest in not volunteering that its opdrachtgever is a public body. Under-declaration produces an application that looks compliant against the wrong obligation set while every downstream artifact reports success — **S4's facet-quality problem on the least visible artifact in the estate**. Companion versions refreshed; all four were stale, `platform-standards.md` by seven versions |
| 0.2 | 2026-08-05 | **§3.5's four findings resolved and trimmed on review.** Three became **D43** in conceptual design v0.9 — `obligated_party`, `assurance_kind`, `lapse_behaviour` — and the argument in §3.5 is retained as the evidence for the change. Two proposals were withdrawn rather than carried: **locale moves to the pack**, where it covers every case until a bilingual pack exists and where a per-standard field would be identical on every row; and the **CAO's second date dimension stays a modelling convention** (two standards split by an `applies_when` on membership) rather than a field used once in this domain and noise on every other. §7.4's draft object, C4, C10, §8's finding 4, and §10.1 updated accordingly. The trim is the same trade D43 itself makes in rejecting `conditional_on`: a field that restates `applies_when` is a second way to say one thing |
| 0.1 | 2026-08-05 | Initial model. The first domain walked end to end against the architecture, from the domain rather than from the design. §2 bounds the tenant and derives **six applications** from §8's catalogue as the first concrete answer to **T-F**, and finds that the Phase 0 gap register requires Tier 3 evaluation the technical design defers to Phase 2 (**C1**). §3 sets the honest boundary — the platform evaluates **process** conformance and never **substantive** conformance, and a Wkb record that blurs the two is §14.11's governance laundering with the platform as launderer. Nine Tier 3 instruments modelled with their interpreting-party candidates and their effective-dating character; nine Tier 2 practice standards and eight construction sufficiency standards drafted. **Four defects in §5.5's standard object** found by writing real standards into it (**C4**), and **D23's acceptance model shown not to fit Wkb** — the kwaliteitsborger is per project, engaged by the opdrachtgever, and statutorily independent of the tenant (**C3**) — with acceptance itself having no home, since T29 forbids the shared pack registry from holding tenant runtime data (**C2**). §4 splits agents three ways (platform seat, application AE5, and what must never be an agent), finds **three missing seats** and a direct contradiction between §12.2's seatless meta-control and PS15's seat-mandatory run (**C6**), and lists the binding calculations AE3 owns permanently in this domain. §5 fills in the pack's other content — ontology, reference data, a classification vocabulary in which `erasable: false` is the ordinary case, watch sources, connectors, and a golden-fixture set none of which could be derived from acceptance criteria (§15.4's point, made concrete). §7 is the configuration draft: **five scopes, not one**, with the **tenant pack binding** proposed as the missing third scope that nine assigned-but-homeless decisions need (**C5**), plus draft objects for the pack binding, the standard, the policy blocks, and D17's extension points — where an extension point that can disable a standard is identified as an undeclared override (S-E). **C1–C11** proposed, **C-A to C-G** opened, and eleven upstream changes recorded in §10 without editing anything above this document |
