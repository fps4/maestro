# maestro — Governed Application Platform — Conceptual Design

**Status:** Draft v1.0 — for refinement
**Companion:** `technical-design.md` carries vendor, infrastructure, and build-order decisions, which this document's scope excludes. `platform-standards.md` consolidates the Tier 1 catalogue and the frameworks the platform can claim; `uc1-nl-construction.md` models the first domain. Both are subordinate to this document.
**Scope:** Conceptual architecture only. No vendor, language, or infrastructure choices. Covers both applications the platform originates and existing applications onboarded onto it (§14).
**First domain:** Netherlands construction (bouw & infra). Designed for multi-domain extension.
**Naming:** the platform is **maestro**, and its category is a **governed application platform** (D44). The placeholder "the Platform" and the working codename `adel` are both retired; where either survives in an older document, this one is authoritative.
**Prior art — this is maestro's second iteration.** The first, also called maestro, was a **product-directed, architect-governed agentic delivery platform**: its subject was a *change* travelling from intent to a merged pull request, its gates were functional and technical, and its accountable human was an architect. It never went live, and **its code is being deleted rather than migrated** — so it is prior art in the strict sense, not a dependency, a baseline, or a system to be onboarded under §14. What carries forward is validated *patterns*, not artifacts: the specification-as-source-of-truth spine, requirement→artifact traceability, the human-owned gate, and the five-phase lifecycle. This document is self-contained and is authoritative for the rebuild.
**Note on numbering:** v0.3 inserted §7 and §12; v0.4 inserted §14; later sections renumbered each time. v0.5 restructured §3 into §3.1–§3.3 without renumbering anything else; v0.6 appended §10.5; v1.0 appended §1.5.

---

## 1. Purpose

### 1.1 What this is

Two things, sharing one governance model.

**Originated applications.** A platform that lets a **non-technical domain expert** bring a problem (or a business opportunity) in their own language and — if the problem proves worth solving — receive a **real, running, supported application**, built, deployed, operated, and maintained under governance strong enough for a regulated industry.

The user is a werkvoorbereider, a compliance officer, an office manager. They never see code, a repository, a pipeline, or a cloud console. They see their problem, examined in their vocabulary, and either a working system or a well-reasoned answer for why there shouldn't be one.

**Onboarded applications.** The same platform takes custody of applications it did not build, along a graded ladder from observe-and-assess through operate, govern, structurally remediate, and — where it fits — regenerate (§14). This is where a tenant's existing pain and existing budget already are, and it is how the platform reaches an estate rather than a single new idea.

### 1.2 What this is not

- Not a low-code builder. The user does not assemble components; they describe outcomes.
- Not prompt-to-app. Nothing reaches production without a decision from someone accountable for it.
- Not a code generator that hands over a repository and walks away. Delivery includes operation, support, and eventual decommission.
- Not a general-purpose app factory. It builds a bounded set of application archetypes (§8) and refuses work outside them.
- Not a system of record for regulatory truth. It builds applications that comply with standards; it does not decide what the law says.

### 1.3 The central bet

> Generated code is cheap and unreliable. Governance is expensive and is what makes generated code usable in a regulated business. Therefore governance is the product, and code generation is a commodity input.

### 1.4 The second bet

> The cheapest application is the one you don't build. The most valuable gate is the earliest one.

The governed lifecycle starts at *is this worth solving?* and ends at *should this still be running?* (§10).

### 1.5 What changed between the iterations

*New in v1.0 (D44).* Recorded because the difference is load-bearing in three places: it is why the rebuild is a rebuild rather than a refactor, it is why `specs-service` can claim a generic core (T39), and it is what the name has to describe.

| | **maestro v1** | **This iteration** |
|---|---|---|
| Subject of governance | A **change** — intent to merged pull request | An **application**, across its whole life (§10) |
| Accountable human | An **architect**, per product | **Sponsor, Owner, Steward** — client-side business roles (§3.1) |
| Gates | Functional, then technical (design and merge) | Explore / Assess, specification, release, Run, Retire |
| Terminal artifact | A reviewed pull request | A **conformance record** (§5.8) |
| Standards | Technical quality, machine-enforced | Three tiers including **regulatory**, on a named interpreting party's authority (§5.3) |
| Reach | Applications it builds | Applications it builds **and applications it did not** (§14) |
| Buyer | A product organisation | A regulated business, and its advisor (§5.3.2) |

**The rename is the honest consequence of that table, not a marketing act.** v1's category — *agentic delivery* — named the thing v1 actually did. Under §1.3 delivery is the commodity input rather than the product; under §14 the first two rungs of the ladder deliver nothing at all; and under P11 the most valuable outcome is frequently not to deliver. A platform whose best answer is "no" should not have *delivery* as its head noun. **Governed application platform** is the smallest description that covers originated and onboarded applications, all five phases, and the gate that never leaves a named human.

**What did not change is the part worth keeping.** The specification is the source of truth and code is its expression; requirement→artifact traceability lets a non-technical owner confirm their intent was built without reading code; and there is an irreducible human decision at the point something ships. v1's thesis was that as the technical foundation commoditises, the platform's value moves *up the chain* from guarding technology to guarding business intent, and *across* a product's life. This iteration is that thesis built directly, rather than approached from the delivery end — which is why the gate's content here is regulatory and business consequence rather than code correctness, and why the accountable human is a Sponsor rather than an architect.

---

## 2. Design principles

| # | Principle | Consequence |
|---|---|---|
| P1 | **The specification is the product; code is a build output.** | Code can be regenerated at will. The durable, reviewable artifact is a specification in domain language. |
| P2 | **Standards are executable, not documentary.** | A standard that cannot be automatically evaluated is guidance, and carries no assurance weight. |
| P3 | **Determinism where it is binding.** | Anything with legal or financial consequence is computed by a versioned deterministic rule, never inferred by a model at runtime. |
| P4 | **The platform is accountable, not the user.** | A non-technical user cannot be responsible for an architecture they cannot inspect. |
| P5 | **Separation of duties by default.** | Whoever raises a need is never the sole approver of its release into a regulated context. |
| P6 | **Autonomy is earned, not granted.** | Applications start advisory and reach autonomous action only against evidence. |
| P7 | **Every application produces its own evidence.** | Audit trail, decision lineage, and conformance records are generated by construction. |
| P8 | **Blast radius is always bounded.** | No generated application takes an unbounded action without an explicit capability grant and limit. |
| P9 | **There is always an exit.** | Specifications and artifacts are exportable. The platform must be leaveable. |
| P10 | **Governance is proportional to consequence.** | Uniform heaviness means the light case never gets used and the heavy case never gets built. |
| P11 | **"No" is a first-class outcome.** | Declining to build is a successful result, recorded and reasoned. |
| P12 | **Oversight level describes who acts, never who is accountable.** | A named human is accountable for every governed decision, whether a human or an agent occupied the seat. Agents cannot hold accountability. *(New in v0.3 — see §12.)* |
| P13 | **Writes propose; only gates accept.** | Any interface that can write a specification — UI, API, MCP — creates a proposed version. Acceptance is always a gate decision. *(New in v0.3 — see §4.2.)* |
| P14 | **Authority is declared, never assumed.** | For every application the platform states what it built, what it operates, what it may change, and what it merely observes — and warrants only what it holds. *(New in v0.4 — see §14.)* |

---

## 3. Actors and roles

*Restructured in v0.5.*

Three kinds of party, deliberately separated into three tables. Fusing them is what allowed a delivery function to sit in an authority table through v0.4, and it is the reason "who reviews the architecture?" had no answer.

| Kind | Defining property | Holds gates? |
|---|---|---|
| **Client-side accountability roles** (§3.1) | A named human, always (P12). Accountable to the client's own organisation | **Yes.** These are the only parties that do |
| **External parties** (§3.2) | Carry their own professional liability. Neither client nor platform can direct them | No |
| **Platform functions** (§3.3) | Capabilities, not accountability. Each is a *seat* under the oversight model (§12), occupied by an agent or a human at a recorded level with a hard ceiling | **Never** |

**No platform function holds a gate.** That is the structural expression of P4 and P12 together: the platform is accountable for the machinery, a named client-side human is accountable for every governed decision. Where a platform function must be involved in a decision it cannot own — archetype fit, a target architecture proposal — it *shapes and co-signs*; a client-side role decides.

### 3.1 Client-side accountability roles

| Role | Who | Holds | Cannot |
|---|---|---|---|
| **Sponsor** | Business decision-maker | The **Explore** gate and the **Assess** gate (§14.3): commits the organisation to an opportunity or an onboarding level, and accepts the assigned consequence class | Approve a release; declare a business case sufficient |
| **Owner** | Named owner per application | The **specification** and **release** gates: approves specification changes, accepts residual risk, requests decommission | Bypass a blocking standard |
| **Steward** | Domain or compliance function inside the client | Co-approval where Tier 3 is in scope; signs the conformance record | Alter a standard's definition; accept an interpretation on the client's behalf (§3.2) |

**Origination is an attribution, not a role.** *(Changed in v0.5.)* Anyone authorised in the tenant may raise an opportunity, so "Originator" grants nothing — it is a recorded field on the artifact. It is recorded because P5 needs it: whoever raised a need must be excludable from being its sole approver. Origination is deliberately open; approval is deliberately not.

**Sponsor and Owner are frequently different people, and the business case may outlive whoever raised it.** A foreman raises the problem; an operations director sponsors it; a project controller ends up owning the application. Model the handover.

**Role collapse.** In a twelve-person aannemer, Sponsor, Owner, and Steward will be one person. Permit it, but record it as an explicit risk acceptance.

**Steward is not the accepting advisor.** An internal compliance officer approves releases under the client's own authority; the accepting advisor (§3.2) accepts a regulatory *interpretation* under professional indemnity. Different party, different act, different liability. They coincide only where the client's kwaliteitsborger also holds the internal sign-off, which is uncommon and should be recorded as a collapse like any other.

### 3.2 External parties

| Party | Who | Holds | Cannot |
|---|---|---|---|
| **Interpreting party** | Named professional body or firm, **per standard**, not per pack (§5.3.1) | Asserts that an executable check correctly implements a legal instrument | Attest implementation fidelity, currency, or applicability completeness — none of the three ever transfers (§5.3.1) |
| **Accepting advisor** | The client's own accountant, kwaliteitsborger, or equivalent (D23) | Accepts the canonical interpretation *for this client*, per standard, dated and named. Acceptance lapses on material pack change (§5.7) | Author an interpretation; approve a release |
| **Auditor** | Internal or external, independent of both delivery and approval | Reads every opportunity, business case, specification, decision, and conformance record | Modify anything |
| **Incumbent operator** | Whoever runs or built an application before onboarding — internal team or outside vendor | Supplies access, baseline, credentials, and knowledge at intake; continues deploying below N2 | Approve the onboarding level; assert the application's conformance |

**The accepting advisor was missing from v0.4**, despite D23 making it load-bearing for every Tier 3 standard. Added here.

**The incumbent operator is frequently the party onboarding displaces**, and holds the knowledge intake depends on. Cooperation cannot be assumed, and the party is deliberately drawn as a supplier of inputs rather than a holder of gates (§14.11).

### 3.3 Platform functions

Each is a seat under §12, not a person. The "Ceiling" column is the oversight level it may never rise above, and it belongs in the domain pack rather than in code (§12.5).

| Function | Does | Ceiling | Never |
|---|---|---|---|
| **Case shaping** | Discovery plane (§4.1): elicits, structures, and challenges a business case; runs the archetype match; produces the intake assessment at Assess | O4 | Assert sufficiency; approve or advance an opportunity |
| **Platform architect** | Owns the archetype catalogue (§8), the generation boundary (§9), the platform-service substitution catalogue (§14.7), extension-point design (D17), and the specification representation. Co-signs archetype fit and no-fit refusal, the target architecture proposal, and the N4 flip | O2 on the N4 flip and the target architecture proposal; O3 on routine archetype matching | Decide whether a substitution is *worth* doing (D31); relax a Tier 1 standard |
| **Pack publication** | Authors, versions, and effective-dates standards packs; classifies materiality on every change (D24); runs regulatory watch (§5.4) | O2 on materiality classification (open question **G**) | Approve an individual release; author the Tier 3 interpretation itself (§5.3) |
| **Operations** | Operates, patches, responds to incidents, rolls back — always bounded by the onboarding level (D29) | O4 for restore-class remediation; O2 for structural substitution | Change client business logic without Owner approval |

**Case shaping replaces the Facilitator role deleted in v0.5.** The work is unchanged and still lives in §4.1; what is removed is its appearance as an actor. It held no authority, and its occupant was defined by a cross-reference to §12 — both signs it was a seat, not a party. The independence constraint it carried survives in two stronger places: sufficiency standards evaluate mechanically (§5.1), and D31 governs the re-engineering recommendation.

**A platform-side function is legitimate only if its cost scales with the platform's own surface, or if it is what the subscription sells.** Architecture scales with the catalogue; pack publication with the standards estate; operations *is* the product. Facilitation scaled with tenants — one engagement per opportunity per client, funded by nothing the subscription covers — which is the commercial reason it could not survive as a platform role, independent of the governance reason.

**Where the platform architect came from.** v0.4 had no owner for the archetype catalogue, the generation boundary, or the substitution sequencing, and no competent signatory for four decisions that were nominally assigned to a Sponsor or an Owner who cannot evaluate them: archetype fit and §8's refusal, the target architecture proposal (§14.7), partial-fit boundaries spanning rungs, and the one-way N4 flip (§14.4). The split with the Sponsor is what keeps D31 intact: **the architect signs *fit*, the Sponsor decides *worth*.** This is a standing authority plus an enumerated co-signature list — deliberately *not* an architecture review gate on every delivery (§10.3).

**Client-side architecture review is the Owner's prerogative, not a platform role.** A large tenant will want its own architects over an N3–N4 substitution plan. That is an Owner-imposed condition on the gate they already hold; modelling it as a platform-defined role would require absorbing every client's internal governance.

---

## 4. Conceptual architecture

Eight planes. Two are cross-cutting.

### 4.1 Discovery plane
Turns a raw problem statement into a **business case**: what is going wrong, who it affects, what it costs, what would count as success, what obligations apply. Matches the emerging case against the archetype catalogue (§8) and against applications the tenant already runs. Produces a recommendation, including a recommendation not to build.

### 4.2 Specification plane

Holds the canonical, versioned chain of record:

```
Opportunity → Business case → Specification → Application → Conformance record
```

Every link is traceable in both directions. An auditor can ask "why does this application exist?" and reach a business case; a sponsor can ask "what happened to my idea?" and reach a running system or a recorded decline.

**This is a first-class platform service with API and MCP interfaces, not an internal store.** *(Resolved, v0.3.)* Consequences:

- **The API is a governance boundary, not a convenience.** Under P13, every write — from the UI, an external tool, an agent over MCP, or the composition plane itself — creates a *proposed* version. Nothing becomes accepted without passing the applicable gate. This makes the gate a property of the service rather than of any one client, which is what makes external agent access safe.
- **Reads are broad; writes are narrow and always attributed.** Every proposal carries its author, whether human or agent, and the oversight level in force at the time (§12).
- **Versioning is monotonic and immutable.** Accepted versions are never edited, only superseded. Diff and lineage are core operations, because "what changed and who accepted it" is the primary audit question.
- **MCP makes the spec service the platform's integration seam.** A client's own tooling, a partner's agent, or an auditor's analysis tool can all read the chain of record without bespoke integration.

### 4.3 Standards plane
Evaluates business cases, specifications, and running systems against tiered standards. §5.

### 4.4 Composition plane
Consumes a specification plus applicable standards and produces deployable artifacts. Constrained: emits schema definitions, rule sets, process definitions, and interface bindings — not free-form application code (§9).

### 4.5 Runtime plane
Where applications execute. Provides the archetype engines they compose against.

### 4.6 Platform services plane
Never generated, identical for every tenant: identity and tenancy, data and history, secrets and policy, telemetry and audit, specification management. Carries P4's guarantees.

**Platform services are themselves applications built on the platform.** Self-consistent and a strong dogfooding signal, with one bootstrapping wrinkle: the specification service holds its own specification.

**Resolved in v0.6 (D39).** The platform services are built conventionally first, then **onboarded onto themselves** using §14's machinery: their specifications begin as **descriptive** (§14.4) — claims about code that already exists — at approximately N2, and flip to generative only when the composition plane is mature enough to regenerate them. The platform is its own first onboarded application. This closes the paradox without special-casing it, and the upgrade path is the ordinary one: a service is governed by its own accepted specification version while the successor version is proposed, gated, and released against it.

### 4.7 Delivery and operations plane (cross-cutting)
Environments, promotion, release gating, observability, incident response, rollback, patching, decommission. §13.

### 4.8 Assurance plane (cross-cutting)
Continuously evaluates conformance, collects evidence, produces attestations, surfaces drift. §5.7.

---

## 5. The standards layer

### 5.1 Two kinds of standard

**Conformance standards** — *does this comply?* Evaluated against a specification, artifacts, or runtime behaviour. Failure blocks a **build or release**.

**Sufficiency standards** — *do we know enough to decide?* Evaluated against a business case. Failure blocks a **decision**, not a build.

*Sufficiency examples:* the case names a measurable outcome and a beneficiary (**and that outcome is instrumented, §10.5**); states whether personal data is in scope; identifies the applicable regulatory regime; records who is affected and who decides; an existing-solution check has run; the consequence class has been assessed.

### 5.2 Three tiers of authority

**Tier 1 — Platform standards.** How things must be built, regardless of domain. Never overridable.
*Examples:* tenant isolation enforced below the generated layer; every mutation attributed and timestamped; no secret in a specification; every outbound capability bounded; every binding calculation deterministic and traceable; personal data classified with a retention rule; **published specifications contain no tenant-identifying content** (§7.4).

**These are examples, not the tier.** *(Clarified in v0.9.)* The full catalogue is larger — roughly thirty invariants of identical force are stated across this document, the technical design's decisions, and the service designs — and a standard that is not in the catalogue is not evaluable, which P2 says makes it guidance. Consolidating them is `platform-standards.md` §3.

**Never overridable is not the same as unconditional, and v0.8 read as though it were.** D28 already makes Tier 1 conditional: it binds what the platform *builds and operates*, not what it merely *observes*, so below N3 a violation is a recorded finding rather than a block. That condition needs no new machinery — it is an `applies_when` predicate like any other (§5.5). What cannot happen is an *override*: the condition decides whether the standard engages, and once engaged it cannot be waived under §11.4.

**Tier 2 — Practice standards.** How a competent practitioner in the domain would do it. Overridable with recorded justification.
*Examples (construction):* a change order captures scope, price, and client acknowledgement before work proceeds; a quality observation carries evidence, location, and responsible party; cost is attributable to a cost code; a subcontractor engagement references a verified entity.

**Tier 3 — Regulatory standards.** What law or a binding scheme requires. Never overridable, always effective-dated.
*Examples (NL construction):* Wkb dossier composition and handover; documentation evidencing genuine self-employment; chain-liability record retention; CAO Bouw & Infra working-time and allowance handling; GDPR lawful basis, minimisation, erasure; sector security requirements on public contracts.

### 5.3 Who the Tier 3 authority actually is

*Resolved with a correction, v0.3.*

**Government is the source, not the authority.** Legislators publish *instruments* — laws, regulations, scheme rules — in prose, written to be interpreted by professionals. They do not publish machine-evaluable assertions. Someone must assert *"this executable check correctly implements that legal instrument,"* and that assertion is a professional opinion carrying liability (§15.2).

Three ways to hold that position:

| Model | Liability | Viability |
|---|---|---|
| Platform interprets in-house | Maximum; you are giving regulated advice at scale | Untenable for a small company on Wkb, CAO, or tax |
| Named professional partner interprets | Carried by a party with professional indemnity and standing — accountancy firm, kwaliteitsborger, certification body, branch organisation | **Recommended.** Also supplies the credibility §15.6 says you can't manufacture |
| Tenant's own advisor interprets | Lowest platform liability | Breaks the pack model — every tenant gets a different interpretation |

### 5.3.2 Recommended model: canonical interpretation, tenant acceptance

*Revised v0.3.2 — arrangement D as the primary shield, with a critical narrowing.*

**Split interpretation from applicability. They are different questions and they belong to different parties.**

| Question | Example | Who answers | Scope |
|---|---|---|---|
| **Interpretation** | What does Wkb require of a dossier? | Platform, via the pack (arrangement A moving to B) | Canonical, shared across all tenants |
| **Applicability and acceptance** | Does this apply to *this* company, *this* project, *this* consequence class — and do we accept this reading for our client? | The tenant's own advisor | Per tenant, per standard, dated and named |

**D works as an acceptance layer on top of a canonical interpretation. It does not work as a substitute for one.** If each advisor authors their own interpretation, there is no pack: the marketplace breaks (a specification conformant in one tenant may not be in another), fleet-wide re-attestation becomes impossible, and the conformance record stops being portable. Keep one canonical reading; have the advisor *accept* it for their client rather than replace it.

**What this buys:**

- **The shield.** A named professional with indemnity, already engaged by and trusted by the client, has accepted the reading. The platform asserts machinery, not law.
- **No partnership dependency to unblock launch.** Arrangements B and C require finding a firm willing to attest software output — slow, uncertain, and a single point of failure. D uses relationships that already exist in every construction client.
- **A lower trust barrier for a first sale.** The client does not have to trust an unproven platform's interpretation; they trust their own advisor, who is checking it. This is a more direct answer to §15.7 than borrowed credibility.
- **A channel.** Advisors who confirm become stakeholders, which is the seed of the intermediary model in §19.7 and connects directly to delegated administration (§7.5).
- **A stronger conformance record**, not a weaker one: *interpretation from pack vX, accepted by [named advisor, firm, date] for this tenant* reads better to an auditor than platform self-attestation.

**What it costs, and this is the real trade:**

- **Acceptance does not scale.** Every tenant needs its advisor engaged before the first regulated application ships — a sales-cycle dependency you do not control. Worse, material pack changes should lapse existing acceptances (§5.7), so re-attestation acquires a *human dependency per tenant per material change*. That cost grows linearly with tenants while B's cost is fixed. Size it early.
- **Rubber-stamping is the failure mode.** An advisor who confirms without review gives you the fragmentation cost and none of the assurance. Acceptance must be specific, per-standard, and evidenced — not a single onboarding checkbox.
- **Some tenants have no advisor.** Smaller firms may lack a kwaliteitsborger relationship entirely. Needs a fallback: a platform-designated party available as a paid option.
- **D covers Tier 3 only.** Tier 1 and Tier 2 remain the platform's, as they should.

**Sequencing.** D is the right answer now because it unblocks launch without a partnership negotiation. B remains the right answer eventually for the highest-frequency standards, where per-tenant acceptance cost overtakes the cost of a standing attestation partnership. Treat this as a migration path, standard by standard, driven by volume — not as a permanent choice between the two.

### 5.3.1 What an external authority actually transfers

*Added v0.3.1, because "rely on an external party" spans four very different arrangements with very different effect.*

| Arrangement | What they do | Liability transferred |
|---|---|---|
| **A. Consume published guidance** | You subscribe to their prose interpretation and translate it into assertions yourself | **Little.** The translation is itself an interpretation and it is yours |
| **B. Attest your assertions** | They review and sign that your executable check correctly implements the instrument | **Substantial.** Their name is on the standard |
| **C. Author the assertions** | They write the standard objects | Most, but few professional firms have the capability or appetite |
| **D. Per-tenant advisor confirms** | The client's own accountant or kwaliteitsborger confirms applicability for that tenant | Highest shield, but fragments the pack model |

**B is the target. A is what you will actually have at the start.** The gap between them is where the real exposure sits, and it should be closed standard by standard, beginning with the highest-consequence ones.

**Three things never transfer, under any arrangement:**

1. **Implementation fidelity.** The interpreting party attests the *standard*; they do not attest your *engine*. Whether the code does what the standard says is permanently yours.
2. **Currency.** Whether an update was applied in time is a failure of the watch function (§5.4), not of the interpretation.
3. **Applicability completeness.** A correct standard with a wrong `applies_when` predicate silently fails to fire. Nobody outside the platform can catch this.

**Interpreting party is per standard, not per pack.** Wkb, CAO Bouw & Infra, chain liability, and GDPR are different instruments with different competent bodies. A single construction pack will carry several. The same is true of tenant acceptance: an advisor may accept the CAO reading and decline the Wkb one.

**So: necessary, and not sufficient.** The right posture is that the platform gives no regulatory advice — it *operationalises an interpretation attributed to a named party* — while owning implementation, timeliness, and applicability outright. Combine with D for the highest consequence classes: require the tenant's own advisor to confirm applicability at Explore, which distributes the remaining exposure and is honest about where judgement sits.

### 5.4 Regulatory watch

*New in v0.3.* A standing platform function that monitors authoritative sources, detects change, and assesses impact.

```
Source monitoring → Change detection → Impact assessment → Pack version → Re-attestation (§5.7)
```

- **Monitoring is automatable.** Dutch sources expose machine-readable feeds (official publication channels, scheme owners, CAO parties, EU instruments). Detecting that something changed is a solved engineering problem.
- **Impact assessment is not.** Deciding *which standards a change affects and how* is interpretation, and sits with the interpreting party from §5.3. Automation produces the alert and a candidate impact set; a human confirms.
- **The output is a pack version, not a notification.** A change that doesn't result in a versioned, effective-dated pack update has not been handled — it has only been noticed.
- **Notification to affected tenants is a product feature in its own right.** "This is changing, here is what it means for your four affected applications, here is the deadline" is valuable even before any remediation happens, and is sellable independently of the delivery capability.

### 5.5 Standard as an object

```
standard:
  id: NL-BOUW-WKB-DOSSIER-001
  kind: conformance | sufficiency
  tier: platform | practice | regulatory
  domain_pack: nl-construction
  version: 3.2.0
  effective_from: 2024-01-01
  effective_to: null
  supersedes: NL-BOUW-WKB-DOSSIER-001@2.x
  interpreting_party: <who asserts this implements the source>   # §5.3
  applies_when: <predicate over business case or specification>
  obligated_party: <whose obligation this is>                    # new in v0.9
  assurance_kind: determines | evidences | records                # new in v0.9
  lapse_behaviour: fail | unregulated | freeze_at_last            # new in v0.9
  consequence_class: <minimum weight at which this standard engages>
  assertion: <machine-evaluable check>
  severity: blocking | warning | advisory
  evidence_required: <what must be retained to demonstrate conformance>
  remediation: <what the composition plane should do to satisfy it>
  source: <citation to the authoritative instrument>
  review_due: 2026-12-31
```

**Three fields added in v0.9 (D43).** Each was found by writing a real standard from the first domain into the v0.8 object and failing; each is cheap now and invalidating later, which is T7's rule.

- **`obligated_party`.** `applies_when` says *when a standard engages*; nothing said *whose obligation it is*, and the two are not the same. In construction the obligated party is frequently not the tenant — an aannemer supports a bouwmelding the initiatiefnemer owes — so without this field §5.8's conformance record cannot say whose conformance it asserts, and silently reads as the tenant's.
- **`assurance_kind`.** `severity` describes what a *failure* does; nothing described what a *pass* means. A check confirming that a kwaliteitsborger's verklaring exists is **evidence** of a judgement another party made; a check confirming a filing deadline **determines** conformance the platform can stand behind. Recording both as "conformant" makes the conformance record claim professional judgement the platform did not perform, which is §14.11's governance laundering with the platform as the launderer.
- **`lapse_behaviour`.** `effective_to` passing with no successor is the ordinary case for a collective agreement between periods and for any instrument in a legislative gap. Whether an application is then non-conformant, unregulated, or governed by the last reading is a real choice, and the pack must state it rather than have it invented during the gap.

**Conditionality is `applies_when` and needs no field of its own.** D28's onboarding-level rule, a consequence-class floor, and a tenant's applicable-framework set are all predicates. A separate `conditional_on` was considered and rejected as a second way to say one thing.

**`assurance_kind` and `obligated_party` are carried onto the conformance record** (§5.8), because they are exactly what an auditor needs to read and neither is recoverable afterwards.

### 5.6 Standards packs

The **domain pack** is the unit of extension (§16). Bundles vocabulary and ontology; sufficiency standards; Tier 2 and Tier 3 conformance standards; archetype templates and reference specifications; connector definitions; reference data; golden test fixtures.

The core platform contains no domain knowledge.

### 5.7 Drift and re-attestation

When a pack version publishes, the assurance plane re-evaluates every affected specification:

- **Conformant** — no action
- **Conformant with drift** — passes, newer practice exists; advisory
- **Non-conformant, auto-remediable** — composition plane proposes a change for owner approval
- **Non-conformant, manual** — escalate to owner and steward with a deadline derived from `effective_from`

Permanent operational load, and the moat. Nobody buys a compliance application because it was correct on the day it was built.

**Acceptance lapse.** Under §5.3.2, a material change to a Tier 3 standard lapses the tenant's advisor acceptance for that standard. Re-attestation therefore has two halves: the machine half (re-evaluate specifications, produce remediation) and the human half (re-solicit acceptance from each affected tenant's advisor). Only the first is automatable. Immaterial changes — clarifications, formatting, source recitation — must be distinguishable from material ones in the pack, or every release triggers a fleet-wide advisor round and the model collapses under its own weight. **Materiality classification is therefore a required field on every pack change, and getting it wrong is expensive in both directions.**

### 5.8 Conformance as a deliverable

Every application continuously produces a **conformance record**: which standards applied, at which versions, on whose interpreting authority, **whose obligation each one is**, **what a pass asserts** (§5.5's `assurance_kind`), over which period, with what evidence, and any accepted exceptions. It begins at the business case, not at release.

**The two fields added in v0.9 are what stop the record over-claiming.** Without `obligated_party` it reads as the tenant's conformance even where the obligation is a counterparty's; without `assurance_kind` it reads as the platform's determination even where the platform only confirmed that someone else's judgement exists. Neither is recoverable after the fact, which is why both are on the standard rather than reconstructed at read time.

For construction this is directly saleable. The Wkb dossier, the self-employment file, and the chain-liability record are all things the client must produce anyway, painfully, by hand.

---

## 6. Portfolio and the opportunity register

**Duplicate and overlap detection.** The platform knows every application the tenant runs and every opportunity in flight. No individual user does. "You already have this" is among the most valuable answers it produces.

**Portfolio view.** What is proposed, in flight, running, and not earning its keep. *"Not earning its keep" is a reading of the outcome series (§10.5), not an opinion — an application whose declared outcome was never instrumented cannot appear in this column, which is why §10.5 makes the declaration a sufficiency requirement.*

**Backlog hygiene.** Opportunities expire by default; decline is a recorded outcome rather than silence; a stale register is a defect.

**Portfolio-level standards.** Total personal-data footprint, aggregate outbound capability, concentration on a single connector — obligations that are properties of the estate rather than any one application.

---

## 7. Tenancy, instances, and the marketplace

*New in v0.3.*

### 7.1 The three levels

| Level | Is | Boundary for |
|---|---|---|
| **Tenant** | A client organisation | Identity, billing, data isolation, portfolio, audit scope |
| **Instance** | A running realisation of a specification within a tenant | Deployment, environment, configuration, runtime data |
| **Specification** | A versioned declarative artifact | Reuse, sharing, conformance evaluation |

Multiple instances per specification is the normal case, not the exception: dev and production; one per operating entity in a holding structure; one per major project. **Specifications live above tenancy; instances live inside it.** That distinction is what makes §7.2 possible.

### 7.2 Can the marketplace be a cross-tenant service?

**Yes — and more safely than it first appears, because of P1.**

The marketplace trades **specifications**, not running applications. Since code is a build output, sharing a specification *is* sharing the application. No runtime, no data, and no infrastructure crosses a tenant boundary — only a declarative artifact plus its standards claims, archetype composition, test fixtures, and conformance history.

That makes a separate cross-tenant service architecturally sound, with these properties:

- **Publish is an export operation with a scrubbing gate**, not a visibility flag. A Tier 1 standard (§5.2) blocks publication of any specification containing tenant-identifying content, embedded reference data, or configuration that leaks operational detail. This is the single largest technical risk in the marketplace and needs to be a hard gate, not a warning.
- **Adopt is fork-on-write with provenance.** The consuming tenant gets a new specification lineage pointing back to the source version. The original is immutable to them — as you described.
- **Upstream changes notify, never auto-apply.** A fork is told when its origin publishes a new version, with a diff and an impact assessment. Pulling the change is a governed decision in the consuming tenant.
- **The marketplace service never sees runtime data.** Its isolation boundary is that it holds only published specification versions and their metadata.

### 7.3 Two things the fork model needs that it doesn't have yet

**Fork-only is a maintenance trap.** If the only way to adapt a platform-owned application is to fork it, every client forks on day one and immediately stops receiving updates — including regulatory ones, which is the whole value proposition. Platform-owned specifications need a **configuration surface**: declared extension points (reference data, thresholds, branding, optional steps, org-specific fields) that a tenant can set without forking. Fork becomes the escape hatch for structural change, not the default path.

This connects directly to a question you raised earlier: whether construction demand is really six parameterised applications rather than per-tenant generation. The configuration surface is what makes the parameterised path viable, and the marketplace is where it pays off.

**A marketplace listing is not a conformance guarantee, and clients will assume it is.** A specification authored against `nl-construction@3.2` may not be conformant under `@4.0`, in another jurisdiction, or at a different consequence class. So: listings declare the pack and version they were authored against; **adoption re-runs conformance in the consuming tenant before anything deploys**; and the distinction between platform-published (warranted) and tenant-published (as-is) must be visible in the interface and explicit in contract. Getting this wrong transfers other people's compliance failures onto you.

### 7.4 Trust signals

A marketplace with no quality signal fills with junk. The honest signals are ones you already generate: conformance status against the current pack, number of tenants running it, time in production, blocking-drift history, and incident count. *"Running in twelve tenants for eight months with no blocking drift"* is a stronger and more defensible signal than a star rating, and it is unusually hard for a competitor to fake.

### 7.5 Delegated administration

If an intermediary — an accountancy practice, a branch organisation — administers many client tenants (§19.7), that is an architectural requirement, not a commercial one: cross-tenant administrative identity, scoped delegation, and audit that distinguishes "the client did this" from "their advisor did this on their behalf." Retrofitting this is painful. Decide it during the rebuild even if the partner model is commercially deferred.

---

## 8. Application archetypes

**Data-centric** — **Registry**; **Insight**
**Process-centric** — **Workflow and approval**; **Scheduling and allocation**; **Monitoring and alerting**
**Artifact-centric** — **Document generation**; **Document understanding**
**Boundary-centric** — **Integration and exchange**; **External portal**; **Field capture**; **Conversational surface**
**Logic-centric, cross-cutting** — **Rules and calculation** (deterministic, versioned, effective-dated, traceable)

**Classification axes.** Data shape (record / document / event / series), actor topology (internal / external / machine), determinism requirement (advisory / binding), connectivity assumption (connected / offline-tolerant).

**The axes are not descriptive labels; each one carries a platform requirement.** *(New in v0.7.)* Data shape determines which stores the data plane must offer. Determinism separates what an agent may produce from what the calculation engine must compute (P3). Two are easy to miss and expensive to retrofit:

- **Actor topology.** An External portal serves subcontractors, ZZP'ers, and clients — an identity population with a different lifecycle, assurance level, and offboarding path from tenant staff. Identity covers both populations or a second identity system appears by accident.
- **Connectivity.** Field capture means a foreman on a bouwplaats with no signal. Offline tolerance is a property of the data plane and the sync engine, and cannot be added later to a design that assumed connectivity.

**The catalogue does double duty:** refusal mechanism, and — primarily — the matching surface during discovery, giving a sponsor a shape, effort, and cost preview before commitment.

**Every application carries an outcome dashboard, and it is an archetype composition** — Insight plus Monitoring and alerting over provided telemetry (§10.5, §9). The platform builds no bespoke reporting surface; it uses two of its own archetypes, which is the §4.6 dogfooding claim made concrete.

**The catalogue is owned by the platform architect (§3.3), and so is the refusal.** *(New in v0.5.)* Archetype fit is the one architecture judgement that occurs on every opportunity, and a Sponsor cannot make it. The architect co-signs fit or no-fit; the Sponsor still decides whether to proceed. Adding an archetype is a change to the core platform, never to a pack (§16).

---

## 9. Generation boundary

| Layer | Contents | Produced by |
|---|---|---|
| **Generated per application** | Domain model, business rules, process definitions, screens and forms, interface bindings, **outcome metric definitions and the application's dashboard (§10.5)** | Composition plane, from specification |
| **Composed from primitives** | Process engine, **allocation and scheduling engine**, document engine, exchange and connectors, agent runtime, calculation engine, **offline sync engine** | Platform, wired by specification |
| **Provided, never generated** | Identity and tenancy (**internal and external populations**), data plane and history (**all four data shapes, streaming and batch**), secrets and policy, **edge and capability gateway**, **notification and escalation**, telemetry and audit, specification management, **metric ingestion, storage, query, and dashboard runtime** | Platform, identical everywhere |

*Both sets were incomplete through v0.6. They were re-derived in v0.7 by walking §8's catalogue archetype by archetype and asking what each one needs to run (D40). **The method is the durable part, not the list** — a new archetype implies a re-derivation, and an entry no archetype needs is a candidate for deletion.*

The bottom layer is fixed because these are where generated code fails catastrophically rather than visibly: **authorisation and tenant isolation**; **schema evolution**; **audit and lineage**; the **determinism boundary** (the agent may propose a rule, never *be* the rule at runtime); **capability enforcement** — P8's grants are real only if ceilings, limits, and revocation are imposed below the generated layer, which is what places the edge and capability gateway in this row rather than among the primitives; and **regression evidence** — without a golden-case suite, regeneration is unsafe and P1 collapses.

---

## 10. Product lifecycle

Two nested levels: an outer **lifecycle** of five phases carried as application state, and an inner **delivery loop** running within phases.

### 10.1 The five phases

| Phase | The question | Gate owner | Quality bar |
|---|---|---|---|
| **Explore** | Is this worth solving, and is it ours to solve? | Sponsor | Sufficiency of the business case |
| **Prove** | Does it actually work in the real process? | Owner | Relaxed — speed of proof outranks polish |
| **Build** | Is it right, compliant, and operable? | Owner + Steward if regulatory | Full conformance |
| **Run** | Is it still earning its keep? | Owner | SLOs met, business outcome tracked against its declared target (§10.5) |
| **Retire** | Should it stop, and can it stop cleanly? | Owner + Steward | Evidence and data retention satisfied |

The gate never leaves a named accountable human (P12); **what the gate is about changes with the phase.** Phase transitions are themselves governed decisions.

**Standards weight scales with phase.** Prove relaxes conformance bars — never the gate, never the audit trail, never Tier 1.

**Onboarded applications join the same five phases through a different door.** An existing application enters at an **Assess** gate (§14.3) rather than Explore — the question is not "is this worth building?" but "is this ours to hold, and at what level?" — and then lands in **Run** at N0–N2, or passes through **Build** for the substitution and regeneration work at N3–N4. Retire is identical, and is often the actual objective: an N4 regeneration ends with the legacy application decommissioned under §13.4.

### 10.2 Explore in detail

```
Problem raised → Case shaped → Existing-solution check → Archetype match (architect co-signs fit)
              → Sufficiency evaluation → Sponsor decision
```

**Five legitimate outcomes, all recorded (P11):** proceed; already solved; not a software problem; not worth it; insufficient.

Outcomes 2–5 are successes. A platform that only measures applications shipped will optimise against its own users.

**Proportionality (P10) is set here.** The consequence class assigned during Explore determines how heavy the rest of the lifecycle is, and it also sets the oversight ceiling (§12.3).

### 10.3 The delivery loop

| Stage | Output | Gate |
|---|---|---|
| Specification | Versioned domain specification | Owner approves; ambiguity resolved |
| Conformance check | Applicable standards resolved and evaluated | No blocking failures |
| Composition | Deployable artifacts + generated tests | Build succeeds; artifacts signed |
| Verification | Conformance suite, golden cases, isolation tests, capability audit | All blocking checks pass |
| Release gate | Release decision + conformance record | Owner; Steward co-approves if regulatory (P5) |

Every stage produces an immutable record. The lifecycle trail *is* the audit trail.

**There is deliberately no architecture review gate here, and its absence is a design commitment rather than an omission.** *(Stated explicitly in v0.5.)* Architecture is pre-decided and enforced mechanically, not reviewed per delivery: code is a build output (P1), so there is no per-application code architecture to review; the layers where architecture failures are catastrophic are never generated (§9); composition is constrained to a bounded archetype set (§8); and the architectural constraints themselves are executable Tier 1 standards (P2), never overridable. If every application needed an architect to sign it off, P1 has failed and the platform is a consulting practice with generation tooling attached.

The architect's authority is therefore *upstream* of the loop — over the catalogue, the generation boundary, and the substitution set — plus an enumerated co-signature list (§3.3) covering the four decisions the loop cannot decide mechanically. Adding a general architecture gate to this table would be a regression.

### 10.4 Triggers beyond intent

- **Intent** — someone wants a change. Artifact: a specification change.
- **Objective** — a technical goal with no functional change. Artifact: a change with no new specification.
- **Policy** — a pack version published, or a scheduled audit due. Artifact: a re-attestation result (§5.7).
- **Signal** — an incident, alert, or breached SLO. Artifact: a cause analysis and proposed fix.

What varies is the trigger, gate owner, and artifact type. Never the governance.

### 10.5 Outcome instrumentation

*New in v0.6.*

One thread running through four phases. The lifecycle demands the same number in three separate places — §5.1 requires the business case to name a measurable outcome, §10.1 gates **Run** on the outcome being tracked, §6 identifies applications not earning their keep — and until v0.6 nothing produced it.

| Phase | What happens | Artifact |
|---|---|---|
| **Explore** | The measurable outcome and its beneficiary are declared, with a baseline where one exists and a target. A sufficiency standard fails a case that cannot state one | Business case |
| **Build** | The declared outcome is compiled into an instrumented metric — definition, source, computation, target. Coverage of every declared outcome is a conformance check | Specification, and generated instrumentation |
| **Run** | The metric is tracked as a series against target and read by the Run gate | Outcome record on the conformance chain |
| **Retire** | Sustained failure to reach target is a legitimate, recorded trigger for Retire | Decommission decision (§13.4) |

**Two kinds of metric share one dashboard, and they must be distinguishable.**

- **Operational health** — platform-supplied and uniform across every application: availability, latency, error rate, SLO attainment. Tells you the application *works*.
- **Business outcome** — per application, derived from the business case. Tells you it *matters*.

The Run gate needs both, and they answer different questions. An application that is perfectly healthy and achieving nothing is precisely the case §6 exists to surface, and it is invisible if only health is measured.

**Proportionality applies (P10).** A low-consequence internal tracker may declare a qualitative outcome with a review cadence rather than a computed series. What it may not do is decline to declare one.

**Where an outcome genuinely cannot be instrumented, that is recorded as a declared limitation on the business case, never silently skipped.** Otherwise the Run gate has nothing to read and quietly degrades into "is it up?", which is the failure mode this section exists to prevent.

**P11 has a symmetry here.** Declining to build is a successful outcome at Explore; retiring something that never delivered is the same success one phase later. §10.2 warns that a platform measuring only applications shipped will optimise against its users — a platform that never retires anything does the same thing, further down the lifecycle.

**Onboarded applications inherit a reconstructed outcome.** §14.3 already retro-fits a reconstructed statement of purpose; it must also produce a reconstructed measurable outcome, marked as reconstructed and attributed to whoever confirmed it. Without one, an onboarded application can never be evaluated at Run or legitimately retired — which is how estates accumulate.

---

## 11. Governance model

### 11.1 Progressive autonomy (applications at runtime)

| Level | Capability | Promotion criterion |
|---|---|---|
| A0 | Read and present only | Default on first release |
| A1 | Write to own data store | Golden cases pass; owner approval |
| A2 | Generate outbound artifacts | Sustained accuracy over a defined period |
| A3 | Act on external systems within limits | Steward approval; limits and reversal path defined |
| A4 | Act autonomously on a schedule | Explicit risk acceptance; clean incident history |

*Renamed from L0–L4 in v0.3 to avoid collision with oversight levels (§12) and support tiers (§13.1).*

### 11.2 Capability grants

Every ability to affect the world outside the application is explicit, scoped, limited, revocable: what system, what operation, what volume ceiling, what value ceiling, what approval threshold, what reversal path. Ungranted capability is unavailable.

**Capability requests originate in Explore.** A business case implying government filing carries a higher consequence class from the outset, and the sponsor should know before committing.

### 11.3 Change control

- **Cosmetic** — labels, layout. Owner approval.
- **Behavioural** — rules, process, calculation. Owner approval + regression pass.
- **Regulatory-affecting** — touches Tier 3. Owner + Steward, full conformance re-run, new conformance record.
- **Assumption-breaking** — invalidates the business case. Returns to **Explore**.

### 11.4 Exception handling

Tier 2 may be overridden with stated justification, named accepting party, expiry date, and appearance on the conformance record. Tier 1 and Tier 3 cannot be overridden — only the standard itself can change.

---

## 12. Oversight model

*New in v0.3. This is the framework for "who or what occupies a seat" — the thing you were reaching for.*

### 12.1 What it is

Progressive autonomy (§11.1) governs what an **application** may do at runtime. The oversight model governs who or what occupies a **seat in the delivery process** — the platform functions of §3.3, plus reviewer and approver seats. Same mechanism, different subject. Both are ladders with earned promotion and automatic demotion.

The levels use established human-automation terminology (*in the loop* / *on the loop* / *out of the loop*), which is worth adopting because auditors and regulators already recognise it:

| Level | Name | Who acts | Who decides | Human posture |
|---|---|---|---|---|
| **O0** | Human only | Human | Human | Full involvement |
| **O1** | Agent-assisted | Agent proposes, human acts | Human | In the loop |
| **O2** | Agent-acts, human-approves | Agent | Human, before effect | In the loop |
| **O3** | Agent-acts, human-supervises | Agent | Agent, human may intervene before effect | On the loop |
| **O4** | Agent-acts, human-notified | Agent | Agent, human reviews after | Out of the loop, alerted |

Your stated path — human-in-the-loop first, then agent-in-the-loop with alerts via a governance review agent — is O1/O2 moving to O3/O4 seat by seat, not platform-wide.

### 12.2 The governance review agent is a meta-control, not another seat

It does not occupy a seat. It watches whether oversight levels are being honoured, whether outcomes justify the current level, and it drives promotion and demotion. Two behaviours matter most:

- **Automatic demotion on adverse outcome.** An O4 seat that produces a bad result drops to O2 immediately, without discussion. Demotion must be faster and cheaper than promotion.
- **Sampling above O2.** Once a human is out of the loop, the only evidence the seat still works is deliberate sampled review. Without sampling, O3 and O4 are unfalsifiable.

### 12.3 Ceilings are the whole point

**Some seats can never rise above a ceiling, regardless of performance.** This is what keeps the governance claim defensible; without ceilings, "optionally switch human reviewers to agents" eventually means nobody is governing anything.

| Seat | Ceiling | Why |
|---|---|---|
| Release gate, Tier 3 regulatory in scope | **O2** | The irreducible human decision. If an agent can ship regulated change unsupervised, there is no governed platform to sell |
| Steward sign-off on conformance | **O2** | Someone with professional standing asserts it, or the assertion is worth nothing |
| Sponsor decision at Explore | **O2** | Commits budget and organisational intent; not the platform's to make |
| Owner approval, behavioural change | O3 | Supervisable once golden coverage is proven |
| Platform architect: N4 flip, target architecture proposal | **O2** | One-way and irreversible; errors are invisible until cutover, which by §12.5 puts it near the bottom of the promotion order |
| Pack publication: materiality classification | **O2** | Lapses tenant acceptance fleet-wide (D24); wrong in either direction is expensive |
| Platform architect: routine archetype matching | O3 | A wrong match surfaces quickly in composition |
| Case shaping | O4 | Cannot assert sufficiency anyway (§3.3), so the blast radius is bounded by design |
| Cosmetic change approval | O4 | Low consequence |

**Consequence class sets the ceiling.** The same seat carries different ceilings on a low-consequence internal tracker and a system filing to a government endpoint. This is P10 applied to oversight.

### 12.4 Recording

The oversight level in force at the time of a decision is recorded **on the decision**. An auditor's question stops being "who approved this?" and becomes "what approved this, at what oversight level, under whose accountability?" — and all three must be answerable years later.

P12 is the floor: the accountable human is named regardless of level. Raising oversight moves *work* away from a human; it never moves *accountability*.

### 12.5 Recommended rollout

*Added v0.3.1.*

**Build recording first, then demotion, then promotion — in that order.** Recording which level was in force at each decision (§12.4) is the thing that cannot be retrofitted; every conformance record without it is permanently weaker. Demotion before promotion, because a platform that can raise seats it cannot safely lower has built a ratchet.

**Ship the first client entirely at O0–O1.** No promotion machinery, no governance review agent. The framework's value at that stage is that the ceilings and the recording exist, not that anything is automated. Automation without an evidence base is indistinguishable from an ungoverned platform with better vocabulary.

**Promote in order of error visibility, not error frequency.** Seats where mistakes are cheap and immediately obvious go first — case shaping, cosmetic approvals, objective-triggered technical changes. Seats where mistakes are expensive and *invisible until an audit* go last or never; conformance sign-off is the canonical example, and its ceiling is why.

**Put ceilings in the domain pack, not in code.** They vary by jurisdiction and consequence class. Tier 1 sets absolute ceilings that nothing can raise; a pack may lower them further, never lift them.

**Sampling above O2 starts at 100% and decays to a floor that is never zero.** Suggested shape: full review for an initial run of decisions, then decay against sustained agreement, with a permanent floor. The floor is the entire point — a seat with zero sampling is not supervised, it is merely believed.

**The meta-control needs an independent check.** A governance review agent that is the only thing evaluating the governance review agent is a closed loop asserting its own health. Periodic human audit of the meta-control itself, at a fixed cadence, regardless of reported outcomes.

**Treat oversight level as a client-facing dial, not an internal optimisation.** This inverts the usual assumption and is commercially significant: in a governance product, *the human is part of what is being sold*. A client doing high-consequence regulated work may specifically want lower oversight levels — more human involvement — and will pay more for it. Automating a seat reduces your cost and may reduce the client's willingness to pay. Expose the level, let consequence class set the ceiling, and let the client choose within it.

---

## 13. Support and operations model

### 13.1 Support tiers

| Tier | Scope | Owner |
|---|---|---|
| S1 | Usage questions, data queries | Platform conversational support |
| S2 | Application misbehaviour, data correction, configuration | Platform operations |
| S3 | Platform defect, primitive failure, security event | Platform engineering |
| S4 | Specification is wrong — the application does what was asked, incorrectly | Change request with owner |
| S5 | The business case no longer holds — the application is correct and pointless | Returns to Explore |

**S4 and S5 are the categories most likely to be mishandled.** When a non-technical user says "it's broken," the platform must distinguish a defect from a specification error from an obsolete purpose. Only the first is the platform's fault; misrouting destroys either margin or trust.

**On an onboarded application the tiers hold but S4 has no target**, because there is no specification saying what correct is. It becomes *intent is unrecorded*, and resolution is an intent-recovery task rather than a change request (§14.6).

### 13.2 Service commitments

Per criticality tier: availability target; response and resolution times by severity; data durability and recovery objectives; maximum patch latency for security defects; notice period for breaking platform changes.

**Commitments are bounded by authority, not negotiated freely.** The platform can only commit to what it can change: on an onboarded application at N1 that means availability and response, never correctness (D30, §14.6).

### 13.3 Incident and rollback

Every release is reversible to the previous specification version with data intact. Automated rollback on defined failure signatures. Post-incident, the failure becomes a golden test case in the relevant domain pack — the fleet gets more reliable with every incident.

### 13.4 Decommission

Evidence and record retention beyond the application's life (regulatory retention outlives the software); data export in usable form; revocation of capability grants and credentials; notification of dependent applications and external parties; a final conformance record closing the chain that started with the business case.

### 13.5 Exit and continuity

*Resolved with a gap identified, v0.3.*

The committed position: every application has its own repository, handed to the client. Platform services — identity, specification management, and the rest — are open-code and also handed over. Platform IP remains in the **agentic constructs**: prompts, workflows, orchestration, and the composition logic. Those stay closed and do not transfer.

That is coherent and honest. Two consequences must be stated in contract rather than discovered:

- **The promise is continuity of operation, not continuity of generation.** Post-handover, the client holds running applications, their specifications, and the platform services — but not the means to turn a changed specification into new code. They can maintain the code conventionally, hire developers, and carry on. That is a real and sufficient exit, and it is *not* the same thing as taking the platform with them. Say so plainly.
- **Standards packs are the bigger gap, not the code generator.** For a compliance product, the thing clients most depend on is the pack staying current. If packs stay with the platform, handed-over applications silently stop tracking regulation — worse than losing code generation. **Resolved (v0.3.1): packs transfer as a dated snapshot.** The client receives every pack version in force at exit, with an unambiguous statement that drift detection and re-attestation end on that date. The final conformance record closes the chain explicitly — *conformance asserted as at [date] against pack version X; no assurance thereafter* — which is both an honest disclosure and a genuinely useful audit artifact for the client. Subscription-after-exit was considered and rejected: it is more valuable but cannot be credibly guaranteed by an organisation that has ceased to operate, which is the scenario it exists to cover.

---

## 14. Onboarding existing applications

*New in v0.4. Deliberately wide — this is a first pass over the whole surface, to be narrowed.*

### 14.1 Why this exists, and what it breaks

Everything above assumes greenfield: a problem is raised, a specification is written, code is generated. Every real tenant already runs applications, and those applications are where their operational pain, their compliance exposure, and their budget already are. A platform that can only serve work it originated meets the client at the least convenient moment — when they have a *new* idea — and is invisible for the estate they are already struggling to keep running.

Onboarding inverts P1. In greenfield, the specification is the source and code is derived. In an existing application, **code is the source and any specification is derived** — a claim about the system, not its origin. Most of the difficulty in this section follows from that single inversion, and the design's job is to keep the inversion *visible* rather than pretend it away.

**Two things this buys beyond revenue.** It is the fastest route to the incident-derived fixture corpus that §15.4 says the greenfield path will be thin on — a production application under observation generates real edge cases from day one. And it produces the portfolio (§6) at the first client rather than the third, which is the sequencing problem §15.8 names.

### 14.2 The onboarding ladder

A ladder rather than a switch, for the same reason as A0–A4 and O0–O4: the client should be able to start where the trust is, and each rung should be independently worth paying for.

| Level | Name | The platform holds | The client keeps | Sold as |
|---|---|---|---|---|
| **N0** | **Observed** | Telemetry, inventory, conformance assessment. Read-only, no production authority | Everything | A gap register and a portfolio entry |
| **N1** | **Operated** | + triage, incident response, runbooks, reversible remediation within the app's existing shape | Change control, source, architecture | Ops-as-a-service with availability commitments |
| **N2** | **Governed** | + change control: every change gated, conformance evaluated, evidence produced | Source and architecture; code still hand-written | A conformance record for an application the platform did not build |
| **N3** | **Integrated** | + selected platform services substituted in (identity, audit, secrets, telemetry, calculation) | The application's own domain logic and shape | Structural remediation — the Tier 1 gaps actually closed |
| **N4** | **Regenerated** | + the application re-expressed as a generative specification and rebuilt against archetypes | The business, not the implementation | Regulatory currency: the app tracks pack changes like a native one |

**N0–N1 is the "just ops" option** in the request: observability, triage, remediation where possible, no architectural opinion. **N3–N4 is the re-engineering option.** N2 is the hinge, and is easy to leave out and shouldn't be — it is the only rung where the platform gains the authority to *change* an application without yet changing its shape, and almost every useful remediation lives there.

**Levels are per application, not per tenant.** A tenant will normally have applications at several rungs at once, and the portfolio view (§6) must show which.

**The ladder is not a conveyor.** N1 forever is a legitimate, supported end state. Designing on the assumption that everything eventually reaches N4 produces a product that under-serves the majority case (§14.11).

### 14.3 Intake: the Assess gate

```
Existing application → Condition assessment → Archetype fit (architect co-signs)
                     → Conformance baseline (gap register)
                     → Level recommendation → Sponsor decision
```

Intake is a governed gate with its own artifact — an **intake assessment**, which is to an existing application what the business case is to a new one. It is evaluated by sufficiency standards of its own kind: is the application inspectable, is its purpose recorded anywhere, is its owner named, is its data classified, is its capability surface known, is there a rollback target.

**Five legitimate outcomes, all recorded (P11):**

1. **Operate** — onboard at N0–N2.
2. **Re-engineer** — onboard at N3–N4 with a target architecture proposal (§14.7).
3. **Replace** — do not onboard; raise it as a new opportunity in Explore, and retire this one (§13.4).
4. **Leave alone** — it works, it is low-consequence, holding it costs more than it returns.
5. **Cannot onboard** — not instrumentable, not inspectable, or carrying risk the platform will not take on.

Outcome 5 needs to be genuinely available. An application the platform cannot observe, cannot roll back, and cannot reason about is one it must not commit to operating, and "we took it on and hoped" is how an ops business dies.

**The intake assessment retro-fits the missing business case.** Under §6, an onboarded application without a recorded purpose cannot be evaluated for whether it still earns its keep — and Run and Retire both depend on that. So intake produces at minimum a *reconstructed* statement of purpose, marked as reconstructed and attributed to whoever confirmed it, never presented as an original business case.

### 14.4 Two kinds of specification

*This is the central conceptual addition, and the thing most likely to be got wrong.*

| | **Descriptive specification** | **Generative specification** |
|---|---|---|
| Relationship to code | Derived from it; a claim about it | Authoritative; code derived from it |
| Can be wrong | Yes — and silently | No; if it is wrong, the application is wrong |
| Verified by | Continuous comparison against the running system | Regeneration and golden cases |
| Drift means | Spec no longer matches code | Spec no longer matches the pack |
| Used for | Conformance assessment, change reasoning, portfolio | Everything, including composition |

Both live in the specification service (§4.2) and both are versioned, but **they are distinct artifact classes and must never be silently interchangeable.** A conformance record built on a descriptive specification asserts less than one built on a generative specification, and an auditor is entitled to know which they are reading.

**Drift acquires a second meaning.** Greenfield drift is specification against pack (§5.7). Brownfield drift is specification against *code* — and it is continuous, because the incumbent team keeps deploying. Below N2 the platform does not control change, so a descriptive specification starts rotting the moment it is written. The mitigations are re-derivation on every observed deployment, and treating an unverifiable descriptive specification as expired rather than merely stale.

**The flip.** Promotion to N4 is the point where a descriptive specification becomes generative — where the platform stops describing the application and starts producing it. That is a one-way, explicitly gated transition requiring: an archetype decomposition that actually fits (§14.7), **co-signed by the platform architect** at an O2 ceiling since neither Owner nor Steward can evaluate a decomposition; a golden-case suite that passes against the *existing* system before regeneration; a cutover and rollback plan; and Owner plus Steward approval where Tier 3 is in scope. The architect signs that the decomposition holds; the Owner and Steward decide whether to make the transition. The golden cases are the mechanical backstop that keeps the signature evidenced rather than trusted (P2). **The golden cases must be derived from observed production behaviour, not only from reconstructed intent** — which is the one place brownfield is materially stronger than greenfield (§15.4).

### 14.5 Conformance for something you did not build

An application built without the standards will fail them. That is the finding, not a defect in the assessment — but it means the conformance machinery needs a brownfield reading.

**Assessed versus asserted conformance.** Below N2 the platform *assesses* — it evaluates standards against what it can observe and produces a gap register with severities and evidence. At N2 and above it *asserts* — it takes responsibility for the result, because it holds change control. The two produce different artifacts and are labelled differently on the conformance record and in any external attestation. Collapsing them is the governance-laundering failure in §14.11.

**Tier 1 needs an explicit rule, because it is never overridable (§11.4) and an existing application will violate it.** The resolution: **Tier 1 binds what the platform builds and operates, not what it merely observes.** Concretely — below N3, Tier 1 violations are recorded findings with owner acknowledgement and, where consequence warrants, a remediation deadline; they do not block, because there is nothing to block. From N3 they become blocking for every part of the application the platform has substituted or generated. An application can therefore sit at N1 in permanent Tier 1 non-conformance, provided that fact is on its record and visible to its owner. This is uncomfortable and correct; the alternative is that no real application can ever be onboarded.

**The gap register is a product in itself.** For construction, "here is where your existing project administration fails Wkb, with evidence and a deadline" is saleable with no delivery capability behind it at all, and is the same shape as the §5.4 notification feature.

**Exceptions get expiry dates and an owner.** Onboarding produces a standing exception ledger — Tier 2 overrides under §11.4, plus Tier 1/Tier 3 findings that cannot be overridden and therefore carry remediation deadlines instead. A ledger with no expiries is a way of never fixing anything.

### 14.6 Operate-as-is (N1) in detail

**The instrumentation contract.** The minimum an application must provide to be onboarded above N0. Below this, N0 is the ceiling.

- Identity and version of every deployed artifact, and an event when it changes
- A health signal and a defined failure signature
- Structured logs with a correlation identifier, and error/latency/throughput metrics
- A known-good rollback target under platform custody, and a tested path to it
- A declared capability surface — what the application can reach, write to, spend, or send (§14.8)
- A named human on the tenant side, and an escalation path
- Read access sufficient to reason about a failure, at an agreed scope

**Triage maps onto S1–S5 (§13.1) with one gap.** S4 — "the specification is wrong" — has no target when there is no specification. In brownfield it becomes *intent is unrecorded*: the application does something, someone thinks it is wrong, and nothing on record says which is correct. Resolution is an intent-recovery task, which is discovery work, is billable, and is one of the more reliable pulls from N1 toward N2.

**Remediation classes, and the ceiling that governs them.**

| Class | Examples | Reversible | Minimum level | Notes |
|---|---|---|---|---|
| **Restore** | restart, failover, re-run, scale, roll back | Yes | N1 | The bulk of real remediation |
| **Configure** | flag, threshold, credential rotation | Usually | N1 | Owner approval where behaviour changes |
| **Data correction** | fix or replay records | Sometimes | N2 | Never autonomous where the value is binding (P3) |
| **Patch** | dependency and security updates, no behaviour change | Via rollback | N2 | Needs build and release custody |
| **Code change** | behavioural fix | No | N2 | Needs source custody and a regression bar |
| **Structural** | substitute a platform service | No | N3 | Never autonomous; a governed change (§11.3) |

Two rules make this safe:

- **Remediation authority never exceeds the onboarding level.** The platform cannot patch at N1 no matter how obvious the fix, because it does not hold change control. The correct N1 output for an unreachable fix is an escalation to the owner with a recommendation — and a recorded one, since a pattern of them is the argument for N2.
- **The platform takes no remediation it cannot reverse or evidence.** Both, not either.

**Service commitments are shaped by the level, not negotiated freely.** §13.2 needs a brownfield qualifier: **at N1 the platform commits availability and response, never correctness.** Correctness commitments require the authority to change the thing, which starts at N2. Selling correctness at N1 is the trap in §14.11.

**Custody obligations start before N1 does.** A deployment baseline, credentials scoped to what was agreed, and a rollback rehearsal are intake deliverables, not first-incident discoveries.

### 14.7 Re-engineering (N3–N4)

**The unit is a platform-service substitution, not a rewrite.** Each substitution is an *objective*-triggered change under §10.4 — a technical goal with no functional change — which is exactly the trigger class that already exists and already has a gate.

| Substitution | Seam | Reversibility | Typical order | Why here |
|---|---|---|---|---|
| Telemetry and audit | Sidecar, log shipping, event capture | High | 1 | Prerequisite for everything else; already present from N0 |
| Identity and tenancy | Auth edge, token issuance, session | Medium | 2 | Highest value: the dominant catastrophic failure mode (§9) |
| Secrets and policy | Configuration injection | Medium | 2 | Cheap, self-contained, immediately improves the record |
| Specification management | Process, not runtime | High | 3 | This *is* the N2 step; listed here for completeness |
| Rules and calculation | Extract binding calculations to the deterministic engine | Medium | 4 | Where P3 and Tier 3 conformance actually get satisfied |
| Document and process engines | Replace embedded workflow and templating | Low | 5 | Deep; often where a partial answer is the right answer |
| Data plane and history | Schema, storage, lineage | Very low | Last, often never | Highest risk, lowest reversibility |

Strangler sequencing, edge inward: seams that are reversible and observable first, the data plane last or not at all. **Reversibility is the ordering criterion, not value** — an irreversible early step converts a graded engagement into a bet.

**This table is also a constraint on how the platform's own services are decomposed** *(D42, v0.8)*. A substitution is only available if the thing being substituted is a separable service. Fuse telemetry into the data plane and the first, cheapest, most reversible step of every N3 engagement disappears — which does not merely reorder the work, it removes the graded entry point that makes N3 sellable at all. **Any platform-service consolidation must preserve the seams in this table.**

**Archetype fit decides whether N4 is even available.** The composition plane emits archetypes (§8); if the application does not decompose into them, it cannot be regenerated and N3 is its ceiling. Three honest outcomes: full fit (N4 available), **partial fit** (some capabilities regenerated, the rest remain conventional under N2/N3 — likely the most common real answer, and the design must support a single application spanning rungs), and no fit (refuse, per P11 and §8's refusal role). **The platform architect draws the partial-fit boundary and co-signs the outcome** (§3.3); it is an architecture decomposition made per application, and v0.4 left it unassigned.

**The target architecture proposal** is the artifact the platform produces for the re-engineering decision. It contains: the archetype decomposition or a statement that there isn't one; a sequenced substitution plan with reversibility per step; the **conformance delta** — which standards move from fail to pass, and which do not; what stays conventional and forever will; effort and consequence-class implications; and the cutover and rollback approach for anything reaching N4.

**Independence extends here, and this is not a small point.** The platform recommending that a client adopt more platform services is a structural conflict of interest. Treatment, or the proposal is a sales instrument wearing an architecture document's clothes: the **platform architect** (§3.3) shapes the proposal and co-signs its *fit* — whether the decomposition holds, whether the sequence is genuinely reversible in the order claimed; sufficiency standards *evaluate* it mechanically; the **Sponsor decides** whether it is *worth* doing; and the conformance delta must state plainly which gaps a substitution does **not** close.

**Sufficiency standards can check that the proposal contains a reversibility statement. They cannot check that it is true.** That gap is exactly what the architect's co-signature exists to cover, and it is why the seat's ceiling is O2 (§12.3).

### 14.8 Capability: inventoried, not granted

P8 assumes capability is granted by the platform and therefore bounded and revocable. An onboarded application already has capability the platform did not issue and cannot revoke. So capability has two kinds, and they must be distinguishable on sight:

- **Attested capability** — declared at intake by the owner, verified by observation where possible, not enforceable. Everything an application already has.
- **Granted capability** — issued by the platform when a boundary has been substituted (N3+). Bounded, limited, revocable, exactly as P8 requires.

The portfolio-level standards in §6 — aggregate outbound capability, personal-data footprint, connector concentration — must count both and report them separately, because an estate that is mostly attested is one the platform can describe but not contain.

### 14.9 Oversight and autonomy on an onboarded application

Both existing ladders apply, with the subject shifted:

- **A0–A4 (§11.1)** governs what the platform's own remediation agents may do *to* the application. Onboarding starts every application at A0 regardless of what it does internally, and promotion follows the same evidence rules.
- **O0–O4 (§12)** governs the seats in the onboarding process itself: who assesses condition, who triages, who approves a remediation, who approves a substitution.
- **Ceilings (§12.3) extend by analogy.** Intake level decision: **O2** — it commits the platform's operational liability and the client's money, so it belongs with the sponsor. Structural substitution approval: **O2**. Triage classification and restore-class remediation: **O4**, since errors there are cheap and immediately visible, which makes it a good early promotion candidate under §12.5.

### 14.10 Commercial shape and the exit

Each rung sells something on its own, which is what makes the ladder honest rather than a funnel: N0 a gap register, N1 an operations commitment, N2 a conformance record, N3 closed structural gaps, N4 regulatory currency.

**Exit gets harder as the level rises, and P9 must survive it.** §13.5 already commits that platform services are open-code and hand over — which is what makes N3 exitable at all, and is a stronger argument for that commitment than the greenfield case was. State the consequence plainly, as with D20: after exit, an N3 application keeps running against handed-over services, and an N4 application is maintainable but not regenerable. An N3 client who leaves takes working software and loses the operations, the drift detection, and the ability to substitute further.

**The platform becomes a supply-chain dependency of the tenant at N1.** Standing access to production, credentials, and remediation authority. That is a security posture the tenant is entitled to interrogate, and it is a genuine expansion of the platform's own blast radius — worth naming in Tier 1 as a constraint on the platform, not only on generated applications.

### 14.11 Risks specific to onboarding

- **Adverse selection.** Clients onboard their worst applications first — the ones that page people at night. The condition assessment at intake exists to price and shape commitments accordingly, and outcome 5 exists so that "no" remains available.
- **Operational liability without repair authority.** The N1 trap: the platform is accountable for uptime on something it may not change. D30 (availability and response only, never correctness) is the defence, and it must be contractual rather than understood.
- **Descriptive specification rot.** Below N2 the incumbent team keeps deploying. A stale descriptive specification silently degrades every conformance claim built on it; expiry, not staleness, is the right model.
- **Governance laundering.** A tenant onboards at N0 and tells an auditor the application is "on a governed platform." Onboarding level and assessed-versus-asserted conformance belong on every record and every external attestation, for the same reason §7.3 requires the warranted/as-is distinction.
- **The recommendation conflict.** Covered in §14.7; the failure mode is a target architecture that maximises platform surface rather than closed gaps.
- **Parking at N2 forever.** The platform carries permanent operational and change-control cost with none of the generation leverage that makes the economics work. Either N2 is priced to stand alone or the model quietly subsidises it — and "they'll upgrade eventually" is not a plan.
- **The incumbent team.** The people who hold the knowledge intake depends on are frequently the people onboarding displaces. Cooperation cannot be assumed; intake needs to work with partial cooperation, and the role in §3 needs to be explicit about what they are asked for and what they are not asked to approve.

### 14.12 Open questions carried out of this section

Recorded as H–M in §19.

---

## 15. Key risks

### 15.1 Discovery quality
The Explore phase addresses the original intent-capture risk structurally. Residual: **translation loss** between business case and specification (mitigated by archetype matching during Explore); and **Explore becoming theatre** — if the case is heavy, users route around it by raising work as "small changes" to existing applications. P10 is the defence; monitoring the ratio of new opportunities to change requests is the detection.

### 15.2 Liability
Who is liable when a generated compliance application is wrong? §5.3's interpreting-party model shifts but does not remove this. **Blocking for commercial launch.** Now compounded by the marketplace (§7.3): tenant-published specifications can transfer third-party compliance failures onto the platform unless the warranted/as-is distinction is contractually watertight.

### 15.3 Standards maintenance load
Permanent, growing, unglamorous. Every deployed application increases the cost of every regulatory change. Now also includes the regulatory watch function (§5.4). Model this explicitly; it determines viable pricing and minimum tenants per pack.

**Acceptance re-solicitation is the sharpest version of this.** Under D23, material Tier 3 changes require a human round with every affected tenant's advisor. That cost is linear in tenants and outside your control — advisors respond on their own timetable, and a deadline derived from `effective_from` does not move. This is the single most likely operational failure mode of the recommended model, and the two defences are ruthless materiality classification (D24) and migrating high-frequency standards to arrangement B before volume makes it unmanageable.

### 15.4 Derived test coverage
*New in v0.3, to monitor.* Golden cases are derived from acceptance criteria in the business case. Acceptance criteria describe the happy path; regressions live in edge cases — so derived coverage will be thinnest exactly where it is most needed. Partial mitigation is already in the design: §13.3 turns every incident into a fixture, so coverage grows from reality rather than from specification. Watch the ratio of incident-derived to criteria-derived fixtures; if incident-derived dominates early, the derivation approach is not working.

### 15.5 The ceiling problem
Clients outgrow the platform. P9 and §13.5 address the exit; design the graduation path deliberately rather than losing the relationship.

### 15.6 Model dependency
Composition quality tracks an external provider's roadmap and pricing. The generation boundary limits exposure. Keep the composition plane behind a stable internal interface.

### 15.7 Trust before proof
Nobody buys a compliance system from an unproven vendor on architecture alone. The interpreting-party partnership (§5.3) is the most direct answer — it supplies borrowed credibility and distributes liability at the same time.

### 15.8 Portfolio and marketplace before scale
§6 pays off at the second or third application; §7 pays off across many tenants. The first client has one application and no peers. Sequence accordingly. **Onboarding (§14) is the most direct mitigation available**: it populates the portfolio with applications the tenant already runs, from the first engagement.

### 15.9 Onboarding
Enumerated in §14.11. The two that could sink a business rather than a feature: **operational liability without repair authority** at N1 (D30), and **adverse selection** — the applications clients most want to hand over are the ones least worth holding.

---

## 16. Multi-domain extension

**Rule:** core planes contain zero domain knowledge. Everything domain-specific lives in a pack (§5.6).

**A domain requires:** ontology; sufficiency standards; Tier 2 and Tier 3 conformance standards; archetype templates; connectors; reference data; conformance fixtures; **a named interpreting party** (§5.3); a regulatory watch source list (§5.4).

**A domain must not require:** changes to the specification format, archetype set, generation boundary, lifecycle, governance model, or oversight model. All six are owned by the platform architect (§3.3); a pack that needs one of them changed has found a core defect, and the change is made once for every domain, never for one.

**Candidate second domains:** accountancy practice compliance; installation and maintenance; logistics and transport; healthcare practice administration; housing corporations.

**Validate the pack format against two domains before shipping one.**

---

## 17. Suggested phasing

| Phase | Objective | Proves |
|---|---|---|
| 0 | **Explore only.** Discovery plane plus sufficiency standards, delivered as a human-staffed service for one real construction client. Applications built by hand. | The business case and conformance record are worth paying for |
| 1 | Specification service with API/MCP; composition for two archetypes; manual release gates at O0–O1 | Generation from specification is viable |
| 2 | Standards plane with enforcement at discovery, specification, and build time; construction pack v1; interpreting-party partnership signed | Standards can be executable, and someone credible will stand behind them |
| 3 | Delivery and operations plane; A0–A1 autonomy; oversight model with real ceilings; support commitments | The platform can be accountable |
| 4 | Regulatory watch, drift detection, re-attestation; Run and Retire phases | The moat exists |
| 5 | Second domain pack; portfolio governance; marketplace | The architecture generalises |

**Onboarding at N0–N1 belongs in Phase 0 alongside Explore, and possibly ahead of it.** It requires none of the generation capability, sells against pain the client already feels, and produces two things the greenfield path cannot supply early: a real portfolio at the first client (§6, §15.8) and a corpus of production-derived incidents and edge cases (§15.4). N2 arrives with Phase 3's delivery and operations plane, since it needs change control and release custody. N3 needs platform services stable enough to substitute in, and N4 needs composition mature enough to regenerate against — so both sit at Phase 4 or later, and neither should be sold before then.

**Phase 0 runs the case-shaping seat at O0, and must be instrumented as such.** The commercial risk is that discovery stays a consulting motion permanently and never gains operating leverage — and under a subscription it is the one cost that scales with tenants rather than with platform surface (§3.3), so it cannot stay human indefinitely. The defence is to treat the seat's work as data collection for its own automation (§12): every question asked, every gap found, every case declined and why, captured as structured artifact from the first engagement. A seat whose judgement stays tacit can never be promoted up the oversight ladder.

**Human staffing of a platform seat is a bootstrapping posture, not a structure.** Recording it in §3 as a role — as v0.4 did with "Facilitator" — makes a temporary staffing decision look like permanent governance.

---

## 18. Decisions log

| # | Decision | Rationale | Status |
|---|---|---|---|
| D1 | Specification is canonical; code is a build output | Enables safe regeneration and non-technical review | Proposed |
| D2 | Standards are executable objects, not documents | Unenforceable standards provide no assurance | Proposed |
| D3 | Regulatory calculation is deterministic, never model-inferred | Legal defensibility requires reproducibility | Proposed |
| D4 | Identity, tenancy, data plane, audit, and spec management are never generated | Dominant catastrophic failure modes | Proposed |
| D5 | Domain pack is the sole unit of domain extension | Prevents domain leakage into core | Proposed |
| D6 | Autonomy is a governed promotion, not configuration | Bounds blast radius during immaturity | Proposed |
| D7 | Conformance record is a first-class exportable artifact | Clearest expression of value | Proposed |
| D8 | Discovery is inside the governed lifecycle | The earliest gate is the most valuable | Proposed |
| D9 | Sufficiency standards are distinct from conformance standards | Discovery gates on knowledge, not compliance | Proposed |
| D10 | Governance weight set once, early, by consequence class | Uniform heaviness kills adoption and credibility | Proposed |
| D11 | Declining to build is a recorded, successful outcome | Prevents optimising against users | Proposed |
| D12 | Applications carry lifecycle phase as governed state | Determines applicable bars and gate content | Proposed |
| D13 | **Specification management is a platform service with API and MCP interfaces** | Makes the spec the integration seam; makes the gate a service property | Proposed (v0.3) |
| D14 | **All writes propose; only gates accept (P13)** | Makes external agent access safe by construction | Proposed (v0.3) |
| D15 | **Business case and specification are separate artifacts with a first-class typed link** | Cardinality, lifecycle, approver, and evaluation all differ — see §19.2 | Proposed (v0.3) |
| D16 | **Marketplace trades specifications, not deployments; cross-tenant service holding no runtime data** | P1 makes this safe; publish is a gated export | Proposed (v0.3) |
| D17 | **Platform-owned specifications expose a configuration surface; fork is the escape hatch, not the default** | Fork-only breaks upstream regulatory updates | Proposed (v0.3) |
| D18 | **Government is the source of Tier 3; a named interpreting party is the authority** | Machine-evaluable assertions are professional opinions carrying liability | Proposed (v0.3) |
| D19 | **Oversight levels (O0–O4) govern seat occupancy, with hard ceilings by seat and consequence class** | "Optionally swap humans for agents" without ceilings dissolves the product | Proposed (v0.3) |
| D20 | **Exit guarantees continuity of operation, not continuity of generation** | Honest and defensible; must be contractual, not discovered | Proposed (v0.3) |
| D21 | **Standards packs transfer at exit as a dated snapshot; drift detection ends on that date** | Subscription-after-exit cannot be guaranteed by an organisation that has ceased to operate | Proposed (v0.3.1) |
| D22 | **Oversight recording is built before demotion, which is built before promotion** | Recording cannot be retrofitted; promotion without demotion is a ratchet | Proposed (v0.3.1) |
| D23 | **Canonical interpretation in the pack; tenant's own advisor accepts it per standard (arrangement D)** | Maximum liability shield with no partnership dependency, without fragmenting the pack | Proposed (v0.3.2) |
| D24 | **Pack changes carry a materiality classification; material Tier 3 changes lapse tenant acceptance** | Without it, every release triggers a fleet-wide advisor round | Proposed (v0.3.2) |
| D25 | **Existing applications are onboarded through a distinct Assess gate producing an intake assessment; the five lifecycle phases still apply** | Brownfield needs its own sufficiency question — "is this ours to hold?" — without forking the lifecycle | Proposed (v0.4) |
| D26 | **Onboarding level N0–N4 is governed state on the application and appears on every conformance record and external attestation** | "On a governed platform" is not binary; without this, onboarding launders governance | Proposed (v0.4) |
| D27 | **Descriptive and generative specifications are distinct artifact classes; the flip to generative is a one-way governed gate** | Brownfield inverts P1 — code is the source — and the inversion must stay visible to auditors | Proposed (v0.4) |
| D28 | **Tier 1 binds what the platform builds and operates, not what it merely observes; below N3 violations are findings, not blocks** | Otherwise no real existing application can ever be onboarded | Proposed (v0.4) |
| D29 | **Remediation authority never exceeds the onboarding level, and no remediation is taken that cannot be both reversed and evidenced** | Prevents the platform acting beyond the authority it actually holds | Proposed (v0.4) |
| D30 | **At N1 the platform commits availability and response, never correctness; correctness commitments begin at N2** | Accountability without repair authority is the primary way an ops business fails | Proposed (v0.4) |
| D31 | **The re-engineering recommendation is shaped and its fit co-signed by the platform architect, evaluated mechanically, decided by the Sponsor; the conformance delta must state what it does not close** | A platform function must never decide that more platform surface is warranted — otherwise it is a sales instrument. *Amended v0.5: architect signs fit, Sponsor decides worth* | Proposed (v0.4, amended v0.5) |
| D32 | **Capability on an onboarded application is attested, not granted; only substituted boundaries yield revocable grants** | P8 assumes issuance the platform did not perform; the estate view must distinguish the two | Proposed (v0.4) |
| D33 | **Roles are separated into client-side accountability, external parties, and platform functions; no platform function holds a gate** | Fusing them let a delivery function sit in an authority table and left architecture unowned | Proposed (v0.5) |
| D34 | **The Facilitator role is deleted. Case shaping is a platform seat under §12, not an actor** | It held no authority and its occupant was defined by a §12 cross-reference — both signs it was a seat. Under subscription pricing it is also the one platform cost that scales with tenants | Proposed (v0.5) |
| D35 | **A platform architect owns the archetype catalogue, generation boundary, substitution catalogue, extension points, and specification representation, and co-signs four enumerated decisions — but there is no per-delivery architecture review gate** | Four architecture judgements were assigned to parties who cannot make them; a general gate would contradict P1 | Proposed (v0.5) |
| D36 | **Origination is an attribution on the artifact, not a role** | "Anyone authorised" grants nothing; it is recorded so P5 can exclude the raiser from sole approval | Proposed (v0.5) |
| D37 | **The measurable outcome declared at Explore is instrumented at Build, tracked at Run, and read by the Run gate** | The lifecycle demanded the same number in three places (§5.1, §10.1, §6) and produced it in none | Proposed (v0.6) |
| D38 | **Outcome metric definitions and the application dashboard are generated per application; ingestion, storage, query, and dashboard runtime are provided** | Keeps §9's boundary intact and makes the dashboard hand over with the application at exit (§13.5) | Proposed (v0.6) |
| D39 | **Platform services are built conventionally, then onboarded onto themselves as descriptive specifications at N2, flipping to generative when composition matures** | Resolves the §4.6 bootstrap paradox with machinery §14 already provides, and makes the platform its own first onboarded application | Proposed (v0.6) |
| D40 | **The primitive and provided-service sets in §9 are derived by walking §8's archetype catalogue, not enumerated by intuition; a new archetype forces a re-derivation** | Four requirements — allocation, offline sync, external identity, notification and escalation — were absent from §9 through v0.6 despite archetypes depending on them. The method catches this class of omission; a list does not | Proposed (v0.7) |
| D41 | **Capability enforcement sits in the provided layer, in an edge and capability gateway, not in a composed primitive** | P8 grants are real only if ceilings, limits, and revocation are imposed below anything generated (§11.2) | Proposed (v0.7) |
| D42 | **§14.7's substitution catalogue constrains how platform services are decomposed, not only the order they are substituted in** | A substitution exists only if the target is a separable service. Consolidating across a seam in that table deletes a rung of the N3 ladder rather than reordering it | Proposed (v0.8) |
| D43 | **The standard object carries `obligated_party`, `assurance_kind`, and `lapse_behaviour`; conditionality stays in `applies_when`** | All three were found by writing real first-domain standards into the v0.8 object and failing. Without the first the conformance record cannot say whose conformance it asserts; without the second it claims professional judgement the platform did not perform; without the third an instrument's expiry has undefined behaviour during the gap it routinely creates. The fields are free before the first pack version publishes and invalidate every record written before them afterwards (T7) | Proposed (v0.9) |
| D44 | **The platform is named `maestro` and its category is a governed application platform; it is the second iteration of maestro, whose code is deleted rather than migrated** | *Delivery* named the commodity input, not the product (§1.3); it excluded N0–N1, which deliver nothing and are the first thing sold (§14, §17); and it made the head noun the outcome P11 calls a success to decline. *Agentic* named the substrate, which T22 forbids a platform service from doing and which reads as risk rather than assurance to a compliance buyer. The name is reused because the thesis is continuous (§1.5) and the category is changed because the product is not | Proposed (v1.0) |

---

## 19. Resolved directions and open questions

**Resolved in v0.3** *(recorded as directions, not frozen)*

1. **Specification format and management** — a platform service with API and MCP interfaces (D13, §4.2), all writes proposing (D14). *Still open: the specification's internal representation.* Controlled natural language, structured domain model, or hybrid. The property worth preserving from the remote reference is requirement→artifact traceability, which is what lets a non-technical owner confirm "was my intent built?" without reading code.
2. **Business case vs specification** — **recommend separate artifacts, same service, first-class typed link** (D15). Reasoning: one case can spawn several applications and one application can serve several cases over time, so embedding forces a false 1:1; four of five Explore outcomes produce a case and no application, and those must live somewhere (§6); the Sponsor owns the case while the Owner owns the specification, so merging them collapses P5; and sufficiency standards read the case while conformance standards read the specification (§5.1), which stays much cleaner when the targets are distinct. The specification pins the case version that justified it at approval time — that pinned link is what makes the audit chain hold.
3. **Tenancy, instances, marketplace** — assessed and viable as a separate cross-tenant service (§7). Two additions required: a configuration surface so fork isn't the default path (D17), and an explicit warranted/as-is distinction because a listing is not a conformance guarantee (§7.3).
4. **Tier 3 authority** — government is the *source*; a named interpreting party is the *authority* (D18, §5.3). Regulatory watch (§5.4) automates detection, not interpretation.
5. **Tenancy model** — tenant / instance / specification (§7.1). Note the constraint your own exit answer creates: per-client repository handover (§13.5) implies application-level isolation strong enough to extract cleanly, which rules out the most aggressively pooled designs.
6. **Golden test derivation** — from acceptance criteria, with the coverage gap logged as a monitored risk (§15.4).
7. **Buyer** — both direct and intermediary; commercial model deferred. **One architectural consequence not deferrable:** an intermediary administering many tenants requires delegated cross-tenant administration (§7.5). Decide during the rebuild.
8. **Exit and continuity** — repositories and open platform services hand over; agentic constructs do not (§13.5, D20). Two things to state contractually: the promise is continuity of *operation*, not *generation*; and standards packs need their own explicit exit treatment, because for a compliance product they matter more than the code generator.
9. **Facilitator and oversight** — generalised into the oversight model (§12, D19). Automated with optional human review, promoted and demoted by a governance review agent, with hard ceilings that never lift. *Superseded in v0.5: the Facilitator role is deleted; the work is the case-shaping seat in §3.3 and the discovery plane in §4.1.*

**Remaining open**

- **A.** Specification internal representation (from 1 above) — now the single largest undecided item, and it gates the rebuild.
- **B.** Business case format — light enough for a foreman, structured enough to evaluate sufficiency standards against.
- **D.** *Direction set (D23): tenant's advisor accepts a canonical interpretation.* Open: what a fallback looks like for tenants with no advisor relationship; how acceptance is made specific enough to avoid rubber-stamping; and at what tenant volume each standard should migrate from D to B (§5.3.2).
- **E.** Sampling floor above O2 (§12.5) — the decay curve and the permanent floor are both open, but the floor being non-zero is settled.
- **G.** How is materiality classified on pack changes (D24), and who signs that classification? It sits directly on the operational cost of the whole model.

*Opened by §14 (v0.4) — all deliberately broad at this stage:*

- **H.** What exactly is in the minimum instrumentation contract (§14.6), and what happens to an application that cannot meet it — a permanent N0 ceiling, a platform-supplied instrumentation step, or refusal?
- **I.** Does a descriptive specification share the internal representation of a generative one (open question **A**), or is it a distinct format? Related: how is a descriptive specification re-derived and re-verified on each observed deployment, and what does "expired" do downstream?
- **J.** How is condition assessed at intake, and how does it flow into pricing and offerable SLOs? This is the defence against adverse selection (§14.11) and it is currently hand-waved.
- **K.** Does the marketplace (§7) ever list specifications derived from onboarded applications, and under what warranty? A descriptive specification published as if generative is the same failure as §7.3's, one layer down.
- **L.** Who holds source, credentials, and deployment custody at each level, and is escrow needed? Bears directly on the exit promise (§14.10, §13.5) and on the platform's own blast radius.
- **M.** Is N2 priced to stand alone? If not, the model quietly subsidises every application that parks there — which may be most of them.

*Opened by §3 (v0.5):*

- **N.** Under a subscription-plus-consumption model, **operational liability does not scale with what is metered.** Tokens price consumption; §13.2 service commitments, S1–S5 support, and incident response scale with the number and criticality of *running* applications. A flat subscription over an unbounded estate is an unpriced liability — the same shape as **M**, one level up. Two consequences to decide: whether the subscription carries a *governed capacity* dimension (applications at criticality tier, rather than price per application); and what backs the Explore gate once applications are free at the margin. If nothing does, P11 becomes socially hard to hold — "why not build it, it costs nothing?" — and the gate must stand on client-side consequence alone, which promotes §6's portfolio-level standards (personal-data footprint, aggregate outbound capability, connector concentration) from a secondary concern to the primary justification for gating at all.

*Opened by §10.5 and the technical design (v0.6):*

- **O.** **The document specifies no user interface, anywhere.** The portfolio view (§6), gap register (§14.5), conformance record (§5.8), opportunity register, and now the outcome dashboard (§10.5) are all defined as artifacts with no stated surface — while §1.1 commits that the user never sees code, a repository, a pipeline, or a cloud console. After **A**, this is the largest undocumented surface in the design. The outcome dashboard is settled (§10.5, generated as an archetype composition); everything the user touches *before* an application exists is not.

*Closed since v0.3: F (packs transfer as a dated snapshot, §13.5). Closed in v0.6: C — the platform is onboarded onto itself as a descriptive specification at N2, flipping to generative when composition matures (D39, §4.6).*

---

## 20. Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-07-28 | Initial draft |
| 0.2 | 2026-07-31 | Discovery brought inside the governed lifecycle. Five-phase product lifecycle; sufficiency standards; consequence class and proportionality (P10); "no" as first-class outcome (P11); portfolio register; Originator and Sponsor roles; decommission; assumption-breaking change class |
| 0.2.1 | 2026-07-31 | Facilitator recorded as settled direction with shape deferred; Facilitator role and independence constraint; Phase 0 instrumentation requirement |
| 0.3 | 2026-07-31 | All open questions answered. New: §7 tenancy, instances and marketplace; §12 oversight model (O0–O4 with ceilings); §5.3 interpreting-party model; §5.4 regulatory watch; §13.5 exit and continuity. New principles P12 (accountability never transfers) and P13 (writes propose, gates accept). Autonomy levels renamed A0–A4, support tiers S1–S5 to avoid collision. D13–D20 added. §15.4 derived-test-coverage risk added. Sections renumbered |
| 0.3.1 | 2026-07-31 | §5.3.1 added — four external-authority arrangements and the three exposures that never transfer. Pack exit resolved as dated snapshot (D21, §13.5). §12.5 oversight rollout recommendation added, including oversight level as a client-facing dial (D22). Interpreting party clarified as per-standard rather than per-pack. Open question F closed; D and E refined |
| 0.3.2 | 2026-07-31 | Arrangement D adopted, narrowed to acceptance-on-canonical-interpretation rather than per-tenant interpretation (D23, §5.3.2). Acceptance lapse and materiality classification added to re-attestation (D24, §5.7). Acceptance re-solicitation named as the primary operational risk (§15.3). D→B migration framed as volume-driven per standard. Open question G added |
| 0.4 | 2026-08-01 | **Onboarding of existing applications added (§14)** — deliberately wide, to be narrowed. Onboarding ladder N0–N4 (Observed / Operated / Governed / Integrated / Regenerated), covering both the ops-as-is path and the re-engineering path; Assess gate and intake assessment with five recorded outcomes; descriptive versus generative specifications and the one-way flip; assessed versus asserted conformance and the Tier 1 observation rule; instrumentation contract, remediation classes and the authority ceiling; platform-service substitution catalogue with reversibility-ordered sequencing; attested versus granted capability. New principle P14 (authority is declared, never assumed). New role: Incumbent operator. D25–D32 added. Open questions H–M added. §1.1, §10.1, §13.1, §13.2, §15.8, §15.9 and §17 updated for the brownfield path. Sections 14–19 renumbered to 15–20 |
| 0.5 | 2026-08-01 | **§3 restructured into three separated tables** — client-side accountability roles (§3.1), external parties (§3.2), platform functions (§3.3) — under the rule that no platform function holds a gate (D33). **Facilitator deleted** as a role; the work becomes the case-shaping seat under §12 (D34). **Platform architect added** as a platform function owning the archetype catalogue, generation boundary, substitution catalogue, extension-point design and specification representation, co-signing archetype fit, partial-fit boundaries, the target architecture proposal and the N4 flip — with no per-delivery architecture review gate (D35, §10.3). **Accepting advisor added**, missing since D23. **Standards authority split** into pack publication (platform) and interpreting party (external). **Originator demoted** to an attribution (D36). D33–D36 added. §8, §10.2, §10.3, §12.1, §12.3, §12.5, §14.3, §14.4, §14.7, §16, §17 and §19.9 updated. Open question N added on unpriced operational liability under subscription pricing. Change-log rows reordered chronologically |
| 0.6 | 2026-08-01 | **§10.5 outcome instrumentation added** — the measurable outcome declared at Explore is instrumented at Build, tracked at Run, and read by the Run gate, closing a loop §5.1, §10.1 and §6 all depended on and none produced (D37). Operational health and business outcome distinguished as two metric classes on one dashboard. **§9 generation boundary extended**: metric definitions and the application dashboard are generated, ingestion and dashboard runtime are provided (D38). §8 records the dashboard as an Insight + Monitoring archetype composition. **Open question C closed** — platform services are built conventionally then onboarded onto themselves as descriptive specifications at N2 (D39, §4.6). §5.1 and §6 updated. Open question **O** added: the document specifies no user interface anywhere. Companion `technical-design.md` opened for vendor and infrastructure decisions this document's scope excludes |
| 0.7 | 2026-08-02 | **§9's primitive and provided-service sets re-derived by walking the §8 archetype catalogue** (D40), which surfaced four requirements absent since v0.1: allocation and scheduling as an engine distinct from process; an offline sync engine for Field capture; external identity populations for External portal; and notification and escalation, required by §5.4, §5.7, §8 and §15.3 and provided nowhere. **Capability enforcement placed in the provided layer** as an edge and capability gateway (D41, §9). §8 extended: the four classification axes each carry a platform requirement, with actor topology and connectivity called out as the expensive ones to retrofit. Engine-level detail and build order in `technical-design.md` §4 |
| 0.9 | 2026-08-05 | **§5.5's standard object gains three fields** (D43) — `obligated_party`, `assurance_kind`, and `lapse_behaviour` — each found by writing a real NL-construction standard into the v0.8 object and failing, and each carried onto §5.8's conformance record where the first two stop it over-claiming. Conditionality stated as `applies_when` rather than a new field, and **§5.2 clarified that "never overridable" is not "unconditional"** — D28 has made Tier 1 conditional on onboarding level since v0.4 and the tier's prose read as though it had not. §5.2 also clarified that its seven Tier 1 entries are examples rather than the tier; the consolidated catalogue is `platform-standards.md` §3. Companion domain and platform standards documents opened: `uc1-nl-construction.md` and `platform-standards.md` |
| 1.0 | 2026-08-05 | **The platform is named `maestro`, category *governed application platform*** (D44), and the working codename `adel` is retired — filenames, cross-references, and identifiers renamed across the whole document set, including `maestro principal id` (T30) and the maestro workspace definition (T39). §1's placeholder-naming line replaced; the prior-art line rewritten to record that **this is maestro's second iteration**, that v1 never went live, and that its code is being deleted rather than migrated — so v1 is prior art in the strict sense and explicitly **not** a system onboarded under §14. **§1.5 added**, recording what changed between the iterations across seven dimensions — subject of governance, accountable human, gates, terminal artifact, standards, reach, buyer — because the difference is what justifies a rebuild over a refactor, what lets `specs-service` claim a generic core (T39), and what the category has to describe. *Delivery* dropped as naming the commodity input (§1.3) and excluding the rungs sold first (§14, §17); *agentic* dropped as naming the substrate, which T22 forbids elsewhere in the design and which reads as risk to a compliance buyer against P3 and §12.3. No architecture, principle, or standard changed in this version |
| 0.8 | 2026-08-02 | **§14.7 established as a constraint on platform-service decomposition, not only on substitution order** (D42) — a substitution exists only where the target is a separable service, so consolidating across a seam in that table removes a rung of the N3 ladder rather than reordering it. §9's data plane entry made explicit that it covers all four data shapes with streaming and batch access, following the event-hub/data-hub consolidation in `technical-design.md` §4.2 and T18 |