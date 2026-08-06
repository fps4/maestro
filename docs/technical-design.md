# maestro (mstr) — Governed Application Platform — Technical Design

**Status:** Draft v1.2 — for refinement
**Repo:** mstr
**Companion:** `conceptual-design.md` (v1.0). That document is authoritative for *what* and *why*; this one is authoritative for *what we build first, on what, and in what order*. Where they conflict, the conceptual document wins and this one is wrong.
**Naming:** the platform is **maestro** (conceptual D44), the second iteration of the project of that name; the codename `adel` is retired. Where an older reference to `adel` survives, read it as maestro.
**Scope:** Platform services and archetype engines. Vendor and infrastructure choices are in scope here precisely because the conceptual document's scope line excludes them.
**Substrate:** A **PoC on Docker**, then an **MVP on Kubernetes plus AWS managed services**. Recorded here rather than assumed, because §13.5's open-code commitment makes it a design constraint on every service (§3.1) and not merely a deployment detail.
**Objective:** Identify the minimum set of platform services that must exist before the first demo use case runs over the platform — and, equally, what must *not* be built yet.
**Service designs:** one document per service as it is built — `ps1-identity-service.md` (v0.1), `ps2-record-spine.md` (v0.2), `ps3-specs-service.md` (v0.3), `ps7-data-service.md` (v0.3), `ps14-work-service.md` (v0.1), `ps15-agent-service.md` (v0.1), `ps16-runtime-service.md` (v0.1). **Standards content:** `platform-standards.md` (v0.5) consolidates Tier 1 and the frameworks the platform can claim; `uc1-nl-construction.md` (v0.2) models the first domain. Both are subordinate to this document and to the conceptual design. **Diagrams:** `c4-diagrams.md` (v0.3), derived from these documents and never authoritative over them. This document stays authoritative for the service *set*, the order, and the substrate; each service design is authoritative for its own internals.
**Conceptual changes this document requires:** collected in §11. Following the §7 precedent, they are recorded here and written there separately; the conceptual document is not amended from this one.

---

## 1. What this document is for

The conceptual design specifies a governed lifecycle in full and deliberately says nothing about how it runs. That was correct while the model was being settled. It is now the binding constraint: the first demo requires a running platform, and nothing states which services that means.

This document answers five questions:

1. **Which services are platform-level**, as opposed to generated per application or deferred to a later phase?
2. **Which engines must exist** for the archetype catalogue to be buildable at all?
3. **What is the build order**, given that some things cannot be retrofitted?
4. **What do we buy, and what do we build?**
5. **On what substrate**, given a Docker PoC and a Kubernetes-plus-AWS MVP?

Questions 4 and 5 were asked in v0.1 and answered for one service. §3.1 answers them for all of them, because §13.5's open-code commitment makes the two questions the same question.

**Three organising rules, and all three are the conceptual design's, not this document's.**

**§9 — the generation boundary — decides the layer.** Anything in its "provided, never generated" row is a platform service (§3). Anything in "composed from primitives" is an archetype engine (§4). Anything in "generated per application" appears in neither, no matter how much it looks like infrastructure — the clearest instance is the application dashboard, which is generated (D38) even though the metric storage beneath it is provided.

**§8 — the archetype catalogue — decides the contents of the runtime.** The engine set is *derived* by walking the twelve archetypes and asking what each needs to run (D40), not enumerated from experience. That method is what recovered four components missing from v0.1 of this document and from §9 itself, and it is why a new archetype forces a re-derivation rather than an addition.

**§4's eight planes decide the coverage — and this rule is new in v0.4 (T20).** The archetype walk answers what a *generated application* needs. It is silent on what the *platform itself* is obliged to do, and through v0.3 §3 was derived from the §4.6 platform-services plane alone. Two planes were therefore left with no service at all: **§4.7 delivery and operations** (environments, promotion, release gating, rollback, patching, decommission) and **§4.8 assurance** (continuous conformance evaluation, evidence collection, attestation, drift). A third obligation — the domain pack as a versioned, transferable artifact (§5.6, §16) — sat between planes and was owned by nobody. PS11–PS13 are the result of walking the planes the same way D40 walks the archetypes.

**The v1.0 walk finds the plane the previous three walks did not miss halfway but missed entirely (T43).** §4.5 — the **runtime plane**, *"where applications execute"* — has no service in any version of this document, and §3.0's audit table, whose whole purpose is to make the derivation checkable, does not list it as a mismatch. Nor is the consequence abstract: §7.1 makes **instance** one of the three tenancy levels and nothing holds one; §13.3's automated rollback has a target in PS13 and no actuator; §14.6's restore class is *"the bulk of real remediation"* and nothing performs it; §13.4's decommission revokes and tears down and nothing does either; and T28's L1→L2 dial is defined as *"a deployment change"* with no owner. PS16 is the result. **The lesson is narrower than T20's and worse:** the audit table in §3.0 was built from §9's provided row, so a plane §9 never mentions could not appear in it even as a gap. An audit derived from one of the three sources cannot check the other two.

**The v0.4 walk was right about the method and stopped halfway on one plane — which is v0.7's finding (T35).** §4.7 has two halves: the *artifacts* of delivery and operations, and the *work* of them. PS13 took the artifact half — SBOM, signature, rollback target, deployment event. The work half was left where it started: §10.3's delivery-loop stages, §10.4's four triggers, §13.1's S1–S5 support tiers, §13.2's response and resolution times, §14.5's exception ledger and §14.6's remediation classes are all obligations with an owner named in prose and no service anywhere. Stated at its sharpest: **PS8 records that someone was told; through v0.6 nothing recorded that anyone did it.** PS14 is the result, and the general lesson is that a plane can be *half* covered and look covered — walking to the first service that fits is not the same as walking the plane.

---

## 2. Four things that cannot be retrofitted

Everything in the build order below follows from these. All four are already committed positions in the conceptual design, and all four are cheap now and extremely expensive later.

*§2.4 was added in v0.6. v0.4 extended this section from two to three; the pattern is that each new service design surfaces the constraint its own §1 cannot proceed without, and that is where the fourth came from.*

**2.1 Attributed, oversight-recorded decisions (D22, §12.4).** Every governed decision must record who or what made it, at which oversight level, under whose accountability — answerable years later. D22 states plainly that recording is built before demotion, which is built before promotion, *because recording cannot be retrofitted*. Every conformance record produced before the recording substrate exists is permanently weaker. This makes the record substrate the second service built, before anything that can produce a decision.

**2.2 Tenant isolation below the generated layer (Tier 1, §5.2).** Isolation is a Tier 1 standard, never overridable, and §9 names it as the dominant catastrophic failure mode. It must be a property of the data plane and the identity model, not of anything a composition step emits. That makes identity and tenancy the first service built, before there is anything to isolate.

**Stated once, here, because v0.3 stated it three different ways** (PS1 said "PS1 and PS2", PS7 said "PS7 and PS1", §4.2's table marked PS2, PS6 and PS7 all topological): **isolation is topological in the identity model (PS1) and in every service that stores tenant data (PS2, PS6, PS7) — and is never a query filter, anywhere.** The service subsections reference this rule rather than restating it.

**2.3 Substrate portability, because the platform services hand over (§13.5, P9).** §13.5 commits that platform services are open-code and are handed to the client at exit, and §14.10 leans on that commitment to make an N3 engagement exitable at all. A platform service built on a proprietary primitive cannot be handed over, so **the exit promise is a constraint on vendor selection, not only on licensing** — and it binds hardest exactly where the MVP substrate is most tempting. §3.1 turns it into a selection rule. Two specific traps are called out where they arise: the tamper-evident archive (PS2, T-C) and capability enforcement (PS9).

The same constraint applies across the substrate change itself. The PoC runs on Docker and the MVP on Kubernetes plus AWS; a service that names its substrate makes that transition a rewrite instead of a configuration change (T22).

**2.4 Data classification at write (T5, T25, §5.2's Tier 1 personal-data rule).** *New in v0.6, surfaced by the PS7 design.* Every fact PS7 stores carries a classification — personal-data flag, category, data subject, lawful basis, retention rule, erasability. It is validated at write and never defaulted. The reason it belongs in this section rather than in PS7's own design is that **data written without a classification is not merely unclassified, it is unclassifiable**: the lawful basis and the data subject were known at write time and are not recoverable from the bytes afterwards. A backfill guesses, and a guessed lawful basis is worse than none.

This is §2.1's argument applied to the other plane. It has two consequences for the build order: the classification envelope is PS7's step 1, before any shape; and **`data-service` is started new rather than evolved out of `event-integration-platform`**, because adding a mandatory classification to a store that already holds unclassified data is the exact unrecoverable case (T33).

A further constraint is not a service but shapes all of them: **§13.4 requires evidence retention to outlive the application**, and regulatory retention outlives the software by years. No component may assume its own storage is the durable record.

---

## 3. Platform services

*Labelled **PS**n, not Sn — the conceptual design already uses S1–S5 for support tiers (§13.1), and its v0.3 renamed two other ladders specifically to avoid this collision.*

| # | Service | Responsibility | Depends on | First wave |
|---|---|---|---|---|
| **PS1** | **Identity and tenancy** | Principals (human *and* agent), internal and external populations, tenant boundary, delegated cross-tenant administration | — | ✅ |
| **PS2** | **Record spine** | Append-only governance event log plus durable archive; the substrate every other record projects from | PS1 | ✅ |
| **PS3** | **Specification service** | Opportunity → business case → specification chain; versioning, diff, lineage; UI, API, MCP | PS1, PS2 | ✅ |
| **PS4** | **Gate and decision service** | Propose/accept semantics; lifecycle phase state; gate ownership, consequence class, oversight level | PS3, *(PS5)* | ✅ |
| **PS5** | **Standards engine** | Evaluate machine-evaluable assertions against a business case or specification | PS3, PS11 | ✅ |
| **PS6** | **Telemetry and metrics** | Ingestion, storage, query, retention; the substrate beneath generated dashboards | PS1, PS2 | ◐ ingestion only |
| **PS7** | **Data plane and history** — realised as `data-service` (T32) | All application data — record, document, event, series — behind one contract, streaming and batch; schema evolution, history, lineage, erasure | PS1, PS2, *(PS10)* | ◐ record + series |
| **PS8** | **Notification and escalation** | Deliver, track, and record "someone must know this, by this date" | PS1, PS2 | ✅ |
| **PS9** | **Edge and capability gateway** | Inbound exposure and enforcement of capability grants — ceilings, limits, revocation | PS1, PS4, *(PS10)* | — |
| **PS10** | **Secrets and policy** | Credential custody and policy distribution | PS1 | — |
| **PS11** | **Pack registry** | Domain packs as versioned, effective-dated, transferable artifacts; materiality classification; ceiling configuration | PS2, PS3 | ◐ one pack, no publication gate |
| **PS12** | **Assurance and drift** | Scheduled and event-driven re-evaluation; evidence collection; the conformance record; drift, expiry, and attestation | PS2, PS5, PS8, PS11, *(PS14)* | ◐ conformance record only |
| **PS13** | **Artifact and release custody** | Artifact identity, version, signature, SBOM, rollback target, deployment event | PS1, PS2 | ✅ SBOM + deployment events |
| **PS14** | **Work and obligation custody** — realised as `work-service` | Every commitment to act and its closure: support cases, change requests, remediations, escalations, deadlines, recurrence, sampling. Assignment to human *and agent* principals, with the authority check at claim | PS1, PS2, PS8, PS4, *(PS11)* | ◐ support, remediation, obligation; no recurrence |
| **PS15** | **Agent execution and composition** — realised as `agent-service` | The deterministic machinery around a model: the run, the mediated action, the construct at a version, the transcript. The composition plane runs here | PS1, PS2, PS3, PS14, PS7 | — |
| **PS16** | **Runtime and instance custody** — realised as `runtime-service` | The **instance**: specification version bound to an environment, with a resource envelope, a declared authority, and a stated hosting party. Execution — serverless — for the instances the platform hosts | PS1, PS2, PS3, PS13, *(PS9, PS10)* | ◐ observed instances only; no execution |

**PS15 was absent from this table through v0.9**, which is a documentation defect rather than a derivation one — `ps15-agent-service.md` has existed since v0.7 and `platform-standards.md` §5.4 has been flagging the omission. Recorded here so the count in T1 is the count in the table.

**Read the graph in §5.1, not the numbers.** PS1–PS10 were numbered in a dependency-respecting order and that order is now broken: PS5 depends on PS11, which is numbered after it. PS11–PS16 are appended in the order they were *derived* rather than sorted into the sequence, because the PS numbers are referenced throughout §9's decision log and renumbering would invalidate those references. The numbering is not a priority order either — PS9 and PS10 depend only on PS1 and are deferred by trigger (§6), not by dependency, and **PS16 straddles the line**: its record half is first wave and its execution half is deferred (§5.1).

**PS7–PS10 were missing from v0.1**, which listed six services against a five-item row in §9 and lost the data plane entirely. They were recovered by the archetype walk in §4, which is the argument for D40: the provided set is *derived*, not remembered. **PS11–PS13 were missing from v0.3** for the mirror-image reason (T20): the archetype walk derives what a generated application needs and is structurally blind to what the platform itself is obliged to do. They were recovered by walking §4's planes.

**PS14 was missing from v0.6** for a third reason, distinct from both: the plane it belongs to already had a service. §4.7 was ticked off by PS13 and never re-walked, so the *work* half of delivery and operations stayed unowned while looking owned (T35, §1). **PS14 is needed before any application exists for the same reason PS8 is** — §13.1's support tiers, §13.2's response commitments, and D29/D30's remediation ceilings all land in Phase 0 with onboarding at N0–N1, none of which requires a single generated application.

**PS8 is needed before any application exists.** §5.4 calls pack-change notification "a product feature in its own right"; §5.7 escalates re-attestation to owner and steward with a deadline derived from `effective_from`; §15.3 names advisor re-solicitation as the sharpest operational risk in the whole model. All three are the platform notifying humans on a deadline, with a record that it did. That is a platform service, not an application feature, and the Monitoring-and-alerting archetype then reuses it. **PS12 and PS13 are here for the same reason** (T20), which is the argument generalised: an obligation the platform carries before any application exists is a platform service by definition.

### 3.0 The derivation, made auditable

Through v0.3 this section claimed to be §9's "provided, never generated" row *in full*. Walked entry by entry, it is not — and the mismatches are the useful part.

| §9 provided-row entry | Service |
|---|---|
| Identity and tenancy (internal and external populations) | PS1 |
| Specification management | PS3 |
| Telemetry and **audit** | PS6 *(telemetry)* **+ PS2** *(audit)* — one entry, two services |
| Metric ingestion, storage, query, and dashboard runtime | PS6 |
| Data plane and history (all four shapes, streaming and batch) | PS7 |
| Notification and escalation | PS8 |
| Edge and capability gateway | PS9 |
| Secrets and policy | PS10 |
| *no entry* | **PS4** — placed by §4.2, not by §9; see below |
| *no entry* | **PS11, PS12, PS13** — derived from §4.7, §4.8, §5.6 (T20) |
| *no entry* | **PS14** — §4.7's *work* half, which the v0.4 walk left behind PS13 (T35) |
| *no entry* | **PS15** — §4.4's composition plane, plus §9's determinism boundary, which §9 states as a *property* and assigns to nobody |
| *no entry* | **PS16** — §4.5, the runtime plane, which this table could not surface because it was built from §9's row (T43) |

Five consequences, all of them recorded rather than resolved here:

- **§9's row fuses telemetry and audit**, which T12 then spends a paragraph separating. The fusion is a defect in §9, not a defect in the split — §11.1 of this document raises it.
- **PS4 had no §9 anchor, and the conceptual design does place it — inside PS3.** §4.2 states that under P13 the gate *"becomes a property of the service rather than of any one client."* Splitting it into its own service was a **departure from the conceptual design that v0.3 did not flag as one**, and under this document's own precedence rule the conceptual design wins. **Closed in v0.8 (T40): PS4 folds in.** The missing anchor turned out to be the finding, not an oversight in §9.
- **Nothing in §9 covers the platform's own obligations**, which is T20 and the reason PS11–PS13 exist.
- **A plane with a service is not the same as a plane that is covered.** §4.7 had PS13 from v0.4 and was treated as answered; the work half of it was unowned for two more versions. The rule T20 states — *a plane with no service is a defect* — needs the stronger form: **an obligation with no owner is a defect, even on a plane that already has a service** (T35, §11.7).
- **This table cannot audit the walk it was added to audit** (T43, new in v1.0). It is organised by §9's provided row, so §4.5 could not appear in it as a gap — a plane §9 never mentions has no left-hand column to be missing from. The *no entry* rows are the tell: four of the six services derived from planes rather than from §9 arrived after the table did, and each was found by re-walking §4 rather than by reading this. **The table is a record of the derivation, not a check on it**, and it should be re-anchored on §4's eight planes with §9's row as the second column rather than the first.

### 3.0.1 What already exists

The `fps4` estate is not greenfield, and three repositories already occupy parts of this map. Recorded here because reuse changes the build order more than any other single factor, and because under D39 the reuse question is an **onboarding** question with machinery already designed for it (§14) rather than a library-selection question.

| Repository | Candidate for | Assessment |
|---|---|---|
| `identity-service` | **PS1** | **Adopted, v0.5** — for authentication only, with the governance identity layer built in maestro per its own ADR-0005. Mature: OAuth2/OIDC, Application/Assignment entitlement gate, admin plane, MCP, audit log, console, SDK. Eight gaps assessed in `ps1-identity-service.md`; the load-bearing one is that no maestro record may store its `sub` (T30) |
| `event-integration-platform` | **Neither — retired as a candidate** | **T33, now applied to both halves.** v0.4 assigned it to PS7 *(event shape)* and AE6 at once, which **T19 forbids**: connectors cross a trust boundary and enforce capability grants, and that is governance, not data. T33 then started `data-service` new rather than evolving it out of this repository, on §2.4's ground that a mandatory classification cannot be added to a store already holding unclassified data. **What remained was the AE6 half, and that is now retired too — so AE6 starts from nothing and its origin is unowned** (T-Q). Note that its documentation described a target its code does not implement (its own `LIMITATION-0001`): the Flink runtime and the AI assist layer were backlog, and what exists is a control plane over Kafka, an ingress/egress surface, and DLQ/replay — so the salvage value was always the smaller half. Still explicitly **not a PS2 candidate**: T5 forbids personal data in the record spine and an integration platform carries business events that routinely contain it |
| `specs-service` | **PS3 + PS4** | **Adopted, v0.8** (T39). A designed-but-unbuilt governed specification service, **derived from two consumers — maestro v1 and this rebuild — so its generic core is the overlap of two materially different governance models (conceptual §1.5) rather than a single-consumer extraction** (T39, weakened and recorded as such in T42). Artifact types, links, gates, lifecycles and attribution profiles are workspace configuration (its ADR-0001), which satisfies §16 structurally; the record sink port makes PS2 authoritative and its database a projection, which is S1 by configuration. It also supplies two things the PS3 design lacked — a mutable **draft** distinct from an immutable version, and gates *inside* the service, which closes **T-D**. Six gaps in `ps3-specs-service.md` §1.3; the load-bearing one is that ADR-0007 stores bodies inline with **no classification concept**, against T25 and §2.4 |
| `core-services` | **PS13**, PoC substrate | Per-host Docker stacks deployed over SSH with pinned Compose projects and Docker contexts, plus the Cloudflare Tunnel edge. This *is* the PoC substrate, and it is the natural first home for PS13's deployment events |

Each should be run through an Assess gate (§14.3) with its five outcomes genuinely available — including outcome 3, *replace*. "It exists, therefore we use it" is not an assessment.

### 3.1 Build or adopt, and on what substrate

*New in v0.4, answering §1's questions 4 and 5. They are one question, because §13.5 decides both.*

**The selection rule: adopt managed open source; never a proprietary primitive, anywhere in PS1–PS16** (T21). **PS15 is the single exception and it is granted on exit grounds rather than waived**: it is the one service that does not hand over (D20), so a proprietary model provider behind its model port does not weaken a promise it never made — see `ps15-agent-service.md` §11.1, and note that `platform-standards.md` §3.7 governs what may cross that port regardless. §13.5 commits that platform services are open-code and hand over at exit, and §14.10 makes N3 exitability depend on it. A managed service that is a hosted build of an open component — MSK is Kafka, RDS PostgreSQL is Postgres, Managed Grafana is Grafana — satisfies the commitment, because the client can be handed the open equivalent and the code that runs against it. A proprietary primitive with no open equivalent cannot, and adopting one silently converts P9 from a guarantee into an aspiration.

This is a rule about the **provided row only**. Generated applications, internal tooling, and CI are unaffected.

| # | Build or adopt | PoC (Docker) | MVP (K8s + AWS) | Handover form |
|---|---|---|---|---|
| **PS1** | Adopt or reuse the IdP; **build** the principal and tenancy model | `identity-service` or self-hosted | Same, on EKS | Open-code |
| **PS2** | Adopt the log and the object store; **build** the semantics | Kafka (KRaft, single broker) + MinIO | MSK + S3 | Kafka and S3 APIs |
| **PS3** | **Adopt `specs-service`**; **build** the maestro workspace definition (T39) | MongoDB replica set + MinIO | DocumentDB *(see PS7's caveat)* or self-hosted + S3 | Open-code |
| **PS4** | **Folded into PS3** as a bounded context (T40) | — | — | With PS3 |
| **PS5** | **Build** — it is the product | — | — | Ours |
| **PS6** | Adopt (T8) | Prometheus + Grafana + Loki | Managed Prometheus + Managed Grafana | Open-code |
| **PS7** | Adopt the engines; **build** the contract (T19), as `data-service` (T32) | Postgres, MongoDB, Kafka, ClickHouse, MinIO | RDS Postgres, DocumentDB *(see below)*, MSK, ClickHouse, S3 | Open-code per engine |
| **PS8** | **Build**; channels adopted behind an interface | SMTP + webhook | SES as a channel only | Ours |
| **PS9** | Adopt the edge; **build** the enforcement | Cloudflare Tunnel (`core-services`) + Envoy | ALB or Envoy ingress | Enforcement is ours |
| **PS10** | Adopt | OpenBao | OpenBao on EKS | Open-code |
| **PS11** | **Build** | — | — | Ours; D21 requires transfer as a dated snapshot |
| **PS12** | **Build** | — | — | Ours |
| **PS13** | **Build** the ledger; adopt the registry | Local registry | ECR | OCI is portable |
| **PS14** | **Build** | — | — | Ours |
| **PS15** | **Build** — it is the IP that does not transfer (D20) | — | — | **Does not hand over** |
| **PS16** | **Adopt** the FaaS runtime; **build** the instance record and the admission chain (X1) | OpenFaaS / faasd | Knative or OpenFaaS on EKS — **X-A** | Open-code; OCI artifacts |

**Ruled out of the provided row, with the service each would otherwise be the obvious choice for:** DynamoDB (PS7), EventBridge and Kinesis (PS2), CloudWatch and Timestream (PS6), Cognito (PS1 — which would also fight T2's agent principals and T3's delegated administration), Secrets Manager as the store of record (PS10), Step Functions (AE1), **Lambda and Fargate (PS16)**. Each is a reasonable engineering choice and each ends the exit promise.

**PS16 is the sharpest instance of T21 in the table and the easiest to get wrong**, because Lambda is the *most* convenient answer to *"where do generated applications run"* and because the exit consequence is worse there than anywhere else: a client handed their application's repository under §13.5, whose functions only execute on a proprietary runtime, has been handed source code and no continuity of operation. Every open FaaS is a container workload on Kubernetes or containerd, so the rule holds by construction rather than by vigilance.

**DocumentDB is the one genuine compromise** and is marked as such: MongoDB compatibility is partial, so the handover claim is weaker than it is for RDS Postgres. If PS7's document shape turns out to need what DocumentDB does not implement, self-hosting is the fallback, and that possibility belongs in the decision now rather than in an incident later.

**§14.7's substitution seams constrain AWS selection, not only internal decomposition.** D42 and T18 established that a substitution exists only where the target is a separable service. Managed services fuse precisely the seams §14.7 depends on: EventBridge for both governance and application events fuses PS2 and PS7, which T12 says destroys the audit substrate; CloudWatch for telemetry and audit fuses PS2 and PS6, and PS6 is held separate *specifically* because §14.7 makes telemetry the first and most reversible N3 substitution. Fusing either does not reorder the N3 ladder — it deletes its cheapest rung, for the platform's own clients, through a console decision. **D42 is therefore an AWS-selection criterion** (T23).

**No platform service names its substrate** (T22). T19 already binds generated applications: a specification names a shape and an access mode, never a store or a vendor. The same rule must bind the platform's own service contracts, or the Docker PoC bakes in assumptions the Kubernetes MVP has to unpick. Through v0.3 nothing protected the platform services from the coupling T19 protects applications from.

### 3.2 What the Docker PoC will get wrong if left to itself

Three places where the cheap PoC answer is the expensive MVP answer. All three are decisions, not code, and all three are effectively unpickable once made.

- **Deployment-per-tenant.** On Compose, another tenant is another project and a port. On Kubernetes plus AWS it is a namespace, an RDS instance, and MSK capacity — a cost floor that §3.1's twelve-person aannemer cannot carry. `identity-service`'s ADR-0018 already chose this model for a different problem, so it is both the easiest PoC path and the nearest precedent. **§3.3 closes the data half and PS16 closes the compute half** (T44): logical isolation for the stores, scale-to-zero for the applications, so an idle tenant costs storage and no compute. The PoC must run both models rather than the ones Compose makes easy — which for PS16 means a real FaaS on the PoC, not a long-running container per application that is *"the same thing, simpler for now."* It is not the same thing; §2.2 of the PS16 design lists four Tier 1 invariants that are structural under one and merely conventional under the other.
- **T-B answered against Compose.** A single-broker Docker Kafka will do topic-per-tenant happily. MSK has partition ceilings per broker that make the same choice a capacity decision. Answer T-B for MSK, then run that topology on the PoC even where it is over-engineered there.
- **Skipping the durable archive.** Kafka retention "works" on a PoC, so T4's separate archive is the first thing to be deferred — and it is the system of record for everything retained (§13.4), which the entire conformance claim rests on. **Fake the scale on the PoC; never fake the shape.**

### 3.3 Tenancy — logical between tenants, physical between deployments

*New in v0.5. **Closes T-L**, which PS2 could not proceed without.*

**Isolation between tenants is logical; isolation between deployments is physical; and which one a given tenant gets is a deployment choice, not an architecture choice.** T6 requires isolation to belong to the topology. It does not require separate hardware, and reading it that way is what produced the deployment-per-tenant reflex in §3.2.

| | Mechanism | Verdict |
|---|---|---|
| **L0 — filtered** | `WHERE tenant_id = …` | **Forbidden.** One bug from a Tier 1 violation (T6) |
| **L1 — logical** | Schema per tenant with a per-tenant role; exclusive stream partition; object-store prefix with a scoped credential | **The default.** Shared infrastructure, separate namespaces — this is what T6 means by topological |
| **L2 — physical** | Own deployment, own cluster, own database instances | **Available per tenant**, as a commercial and regulatory dial |

**The rule that keeps L1 and L2 interchangeable** (T28): *a tenant-scoped handle is acquired once per request, and no query names a tenant.* Isolation is enforced by **binding** — a Postgres role and `search_path`, a partition assignment, a prefix-scoped credential — never by **filtering**. Hold that line and moving a tenant between L1 and L2 is a deployment change. Break it in one code path and the choice is gone, because everything downstream will have learned to expect a shared store.

**`tenant_id` is stable across both levels and never encodes the deployment.** Otherwise an export, a conformance record, or a marketplace listing changes meaning when a tenant moves — and §7.1 makes the tenant the boundary for audit scope, which cannot be allowed to shift under a deployment decision.

### 3.3.1 What stays shared, and the test for it

Three services are cross-tenant by design and stay shared **at both levels**:

| Always shared | Why |
|---|---|
| **PS11 pack registry** | §5.3.2 keeps one canonical interpretation across tenants. A per-tenant pack *is* the fragmentation that section rejects, and it breaks fleet-wide re-attestation and conformance-record portability |
| **Marketplace** (Phase 5) | §7.2 — cross-tenant by construction, and safe precisely because it holds only published specification versions and their metadata |
| **Delegated administration identity** | §7.5 — an intermediary administering many tenants spans them by definition |

Internal platform telemetry is shared too, but as fleet operations rather than as a tenant-facing service.

**The test, generalised from §7.2's argument** (T29): **a service may be shared across tenants only if it holds no tenant runtime data.** That is what makes the marketplace architecturally sound under P1, and it is the question to ask before anything else joins this list. A shared service that accumulates tenant runtime data has become a pooled data plane wearing a control-plane label.

**Shared control plane, isolated data plane** is therefore the shape at both levels. L2 changes where the data plane runs; it does not change which services are shared.

### 3.3.2 Level by level, per service

| Service | L1 — logical | L2 — physical |
|---|---|---|
| **PS1** | Shared pool (`identity-service`) + maestro tenant membership | Own `identity-service` deployment |
| **PS2** log | Exclusive partition per tenant (PS2 §4) | Own cluster |
| **PS2** archive | Prefix + scoped credential | Own bucket |
| **PS3 / PS4** | Schema per tenant + per-tenant role | Own database |
| **PS6** | Per-tenant labels, scoped read | Own stack |
| **PS7** | Schema or prefix per tenant, per shape | Own instances |
| **PS12 / PS13** | Per tenant within shared services | Per tenant |
| **PS14** | Schema per tenant + per-tenant role | Own database |
| **PS15** | Per-tenant run scoping within a shared deployment | Own deployment |
| **PS16** | **FaaS namespace per tenant**, per-tenant service account and network policy; a tenant's own applications co-resident | Own cluster or node pool |
| **PS11, marketplace** | **Shared** | **Shared** |

**PS16's row is the one place T28's binding rule reaches into a *process* rather than a store, and it needs one extra rule** (T45): a runtime process may be shared across applications **within** a tenant and never across tenants. Cross-tenant co-residency makes Tier 1 isolation a property of a language sandbox, which is L0 with better packaging. Separation between a *tenant's own* applications is a consequence-class dial rather than a requirement — no Tier 1 standard demands it, and P10 says offer it rather than impose it.

**One prerequisite makes the dial real, and it is not optional** (T30). **No maestro record may store an identity provider's `sub`.** A local principal's subject is minted per `identity-service` deployment, so an L1→L2 migration re-mints it — against PS2 records whose `accountable` and `acting` fields are immutable and retained for years. maestro keeps its own principal registry mapping `(issuer, subject) → maestro principal id`, and only the maestro id reaches PS2, PS3, or a conformance record. With the indirection, migration re-points a mapping row. Without it, migration is a data migration through immutable records, which is to say it is not available. See `ps1-identity-service.md`.

**What the dial costs.** L2 per tenant means a log cluster, a database, and an object store per tenant — the floor §3.2 says the small end of the market cannot carry, which is why L1 is the default rather than the fallback. Nothing else is lost: a tenant at L2 keeps the shared pack registry and marketplace, because those hold no runtime data.

This is §12.5's pattern applied to infrastructure — expose the level, let consequence class set a floor, let the client choose above it. A regulated client asking for physical separation is telling you what they will pay for.

### 3.4 Repository topology

*New in v1.1 (T53). **Owed since v0.6.** `ps7-data-service.md` §1.3 and H19 cite **T35** for this and `ps15-agent-service.md` §15.2 cites it too; T35 is *PS14 added as the fourteenth service*, so both have been citing a decision this document never recorded — the inversion the precedence rule exists to prevent, and PS7 §16.4 has been saying so for two versions.*

**A repository boundary is earned by a consumer, never by a service boundary.** Two ways to earn one, and a service that has neither lives in the maestro monorepo:

| Earns its own repository | Services |
|---|---|
| **The platform consumes rather than builds it** — someone else owns the roadmap and the ADRs | `identity-service` (PS1 auth), in `../identity-service`; `specs-service` (PS3 + PS4), in `../mstr-specs` |
| **It has a consumer that is not maestro** — PS7 §1.3's trigger, stated as a condition rather than assumed | *None yet.* T42 records that maestro v1 does not satisfy it for `specs-service` either, so the test now applies symmetrically |
| **Neither** | Everything else: `record-spine`, `data-service`, `exchange-service`, `work-service`, `runtime-service`, the engines, and — architecturally — `agent-service` |

```
maestro/
  services/     record-spine · specs workspace · standards · packs
                assurance · notification · artifact-custody
                work-service · runtime-service · identity layer
  products/     data-service · exchange-service        ← split-out candidates
  agent/        agent-service                          ← never exported (D20)
  packages/     shared substrate
```

**None of that tree exists yet, and the estate currently contradicts it in three places.** Stated because a topology written against nothing is the easiest kind of decision to write and the easiest to have already been overtaken:

| On disk today | Against T53 |
|---|---|
| `mstr/` holds `docs/` and nothing else | Every directory above is prospective, and **so are the five import rules** — a rule with no tree to bind is `platform-standards.md` **V4**'s failure mode arriving *before* the code rather than after it, which is the only version of it that is still cheap to fix |
| `mstr-data/` and `mstr-work/` — empty, not git repositories | The reversed plan, sitting where someone will `git init` it. Both service designs carried a `Repo:` line naming them; both are corrected, and **the directories are the part a document cannot fix** |
| `mstr-specs/` — a real repository, one commit | Correct and outside, per row 1 of the table above. **The name is `mstr-specs` and the service is `specs-service`**, and PS3 used three names for the pair across two adjacent header lines until v0.4 |

**The rule this suggests, and it is the reason the mismatch is recorded rather than quietly fixed:** a `Repo:` line in a service design is a *claim about the world*, unlike almost everything else in these documents, and it is the one field that can be checked in a second and was not checked for four versions in two files. **It belongs in the CI conformance job with the import rules**, resolving each one and failing if it does not exist — which makes six rules with a pipeline rather than five without one.

**PS2 stays in `services/`, and it is the one service that cannot ever earn a repository.** *(Settled here rather than inherited.)* The other candidates are unmet conditions — `data-service` has one consumer today and could have two next year. PS2's case is structural: **its genericity could only be bought by deleting its invariants.** R1 rejects an append naming an agent as `accountable`; R2 copies the oversight level onto the decision; R13 refuses an identity provider's `sub`; and §3.3's fifteen event types are maestro's lifecycle spelled out — `OpportunityRaised`, `GateDecisionRecorded`, `PhaseTransitioned`. `specs-service` is generic because its ADR-0001 makes types, gates and lifecycles **configuration**. The equivalent move here is making **P12 configurable**, and P12 is the one thing in the design that must never be. A generic record spine is an append-only log with a Merkle chain, which is a library; what makes PS2 worth having is exactly the part that is not generic.

**Its exit path is already stronger than a repository would make it, which is the other half of the argument.** §13.5's hand-over of platform services is what makes a repository feel necessary, and PS2 discharges it differently and better: **R12's `export` produces the archive, the manifests, and the verifier**, and T24 requires the verifier to depend on no vendor primitive, so any party holding an export can verify it with no maestro at all. **PS2's handover unit is an artifact, not a repository** — and R12 already requires that path built in the first wave rather than at exit, so it is exercised continuously in the way PS7 §1.3 argues a separate repository would exercise a product's.

**What co-location costs, and it is a real cost.** Distance was enforcing something. R11 keeps `append` off MCP and API-only service-to-service, so PS2 has no external write path by design; in one repository, reaching a projection's store or the sealer directly is a short import away and invisible afterwards. **The boundary becomes an import rule, which is strictly weaker than a repository and is only as strong as the pipeline running it** — and `platform-standards.md` V4 already finds six Tier 1 invariants whose stated enforcement is a CI that does not exist. These rules must not become the seventh through twelfth.

| # | Import rule | Protects |
|---|---|---|
| 1 | `products/*` imports nothing from `services/*` | PS7 H1 — a product that reaches into maestro internals is not one |
| 2 | `data-service` and `record-spine` share only `packages/*`, never each other | The **PS2 → PS7 → PS2 cycle**. PS7 depends on PS2 and appends `PayloadErased` to it (H8); co-location makes the return edge easy to create by accident |
| 3 | `data-service` and `exchange-service` share only declared substrate packages | T19's trust boundary, now lint rather than distance |
| 4 | `packages/chain-verifier` imports nothing from `services/*` or `products/*` | **T24 and P9.** The verifier is the exit artifact; one maestro import and the integrity claim stops being independently checkable |
| 5 | Nothing under the exported tree imports from `agent/*`, and the export bundle is built from an **include** list, never an exclude list | **D20.** PS15 is the only thing that does not hand over, so its boundary is the one where a leak is commercially rather than technically expensive |
| 6 | Every `Repo:` or `Realised as:` line in a service design resolves to a directory that exists | The one claim in these documents that is checkable in a second, and the one that went unchecked in **four** files. See the table above |

**Rules 1–5 have no tree to bind and rule 6 binds today**, which is the order they should be built in rather than the order they are written.

**Five packages are shared between PS2 and PS7 and should be extracted deliberately rather than discovered twice** (PS7 §1.3): tenant-handle binding, the explicit tenant→partition map, the type registry with compatibility checking and upcast-on-read, content-addressed blob storage, and export packaging. **That sharing is the entire saving the monorepo buys.** It is not PS2 and PS7 becoming one service — T12 forbids it, rule 2's cycle makes it unbuildable, and a repository boundary was never what was preventing it. Shared libraries collapse maintenance; they do not move a plane boundary.

**`agent-service` is placed by this rule and not settled by it.** Architecturally it has one consumer and belongs in the monorepo like everything else. But it is the only tree that never leaves (D20), so co-location puts the exit boundary *through* a repository rather than *between* two — rule 5 instead of a shipping decision. PS15 §1.2 states the trade correctly: whether "strictly weaker" is "too weak" is a commercial judgement. **T-X** carries it.

### PS1 — Identity and tenancy

**Why first.** Nothing can be recorded without an attributed principal. P13 requires every write to carry its author; §4.2 requires every proposal to carry author *and* the oversight level in force. Both are impossible before PS1 exists.

**Agents are principals, not credentials.** §12.4's audit question is "*what* approved this, at what oversight level, under whose accountability" — all three answerable separately. An agent acting on a seat must be a first-class principal with its own identity, distinct both from the human accountable for the seat and from the service account it runs under. Modelling agents as shared service accounts makes §12 unimplementable, and it is the single most likely early mistake.

**Decide delegated administration now, even though the commercial model is deferred.** §7.5 and §19.7 both say so explicitly: an intermediary administering many tenants needs cross-tenant administrative identity, scoped delegation, and audit that distinguishes "the client did this" from "their advisor did this on their behalf." Retrofitting this into an identity model is painful in a way that retrofitting the commercial model is not.

**Tenant isolation** — per the single statement in §2.2.

**Settled in v0.5: PS1 is `identity-service` for authentication, plus a maestro-built governance identity layer.** The split follows that service's own ADR-0005 — it is the identity authority and a Policy Information Point, never a Policy Decision Point — so tenancy, the principal registry, agent principals, seats, and oversight belong to maestro and the credentials, federation, token issuance, and entitlement gate belong to it. §2.2's claim that isolation is enforced in the identity model survives because the identity model in question is maestro's.

**PS2 cannot record what PS1 cannot distinguish**, so the principal registry is a prerequisite for the next service rather than a parallel workstream. Full assessment, the eight gaps, and the two suggestions being sent back to `identity-service` are in `ps1-identity-service.md`.

### PS2 — Record spine

**The design.** An append-only event log as the write path, with projections built from it, and a separate durable archive as the system of record for anything with a retention obligation.

**Why a log rather than a set of tables.** The conceptual design already describes one without naming it. §4.2 requires the chain of record to be monotonic and immutable, with accepted versions never edited, only superseded, and with diff and lineage as core operations. §12.4 requires the oversight level recorded on the decision. §5.7 requires re-evaluating every affected specification when a pack version publishes. §6 requires a portfolio view across everything in flight. Those are one stream and several projections, not five stores that must be kept consistent with each other.

**Kafka is the intended backbone.** It fits this design better than it fits most, because the primary artifact genuinely is an append-only decision log rather than mutable state with an audit trail bolted alongside. Single-broker KRaft on the Docker PoC, MSK on the MVP — which satisfies §3.1's rule, since MSK is Kafka. **A single-broker PoC proves shape, not throughput**, and shape is what PS2 is for.

**Four constraints, all cheap now and expensive later:**

1. **The log is the spine, not the archive.** Retention and compaction will never satisfy a multi-year regulatory obligation (§13.4). The durable archive is a separate store fed from the log, and **it** is authoritative for retention. Decide and document which is authoritative for what before the first event is written — and build the archive on the PoC even though Kafka retention makes it look optional there (§3.2).
2. **Personal data does not go in the log.** Tier 1 requires personal data classified with a retention rule (§5.2), and GDPR erasure is a stated Tier 3 obligation. Erasure fights an immutable append-only log directly. The log carries decisions, references, and identifiers; the data plane carries payloads under a retention and erasure rule. The alternative is crypto-shredding every consumer, or a rewrite.
3. **Tenant isolation is a partitioning decision, not a filter.** A projection that filters by tenant is one bug away from a Tier 1 violation. Isolation belongs in the topology — see §2.2, and answer T-B against MSK rather than against Compose (§3.2).
4. **Tamper-evidence is computed, not procured** (T24). §13.5's exit promise means the mechanism has to hand over, and the obvious MVP answer — S3 Object Lock plus KMS signing — does not. Compute a hash chain or Merkle root **in application code** over archived records, so the evidence is verifiable by anyone holding the archive and a copy of the open-code service. Object Lock and KMS remain useful as defence in depth; neither may be *the* mechanism. This closes T-C's second half and belongs with §2's other unretrofittable decisions.

**What projects from it, on day one:** the specification chain (PS3), decision and oversight records (PS4), the portfolio view (§6), and the audit read model. All of these are consumers, not stores.

**The conformance record is *not* on that list, and v0.3 had it there.** A projection over an append-only log can replay what happened; it cannot re-evaluate a specification against a newly published pack version, cannot expire a descriptive specification, and cannot produce an attestation. §5.8 requires the record to be produced *continuously* and to begin at the business case, and §4.8 assigns evidence collection, attestation, and drift to the assurance plane. That work is PS12; PS2 supplies its substrate.

### PS3 — Specification service

**This is the centre of the product** — D13 makes it a platform service with API and MCP interfaces rather than an internal store, and §4.2 explains why: the gate becomes a property of the service rather than of any one client, which is what makes external agent access safe.

**Build.** The chain of record from opportunity through business case to specification; monotonic immutable versioning; diff and lineage as first-class operations; broad reads and narrow, always-attributed writes.

**Business case and specification are separate artifacts with a typed link** (D15), with the specification pinning the case version that justified it at approval time. Do not collapse them for expedience in v1 — §19.2 gives four independent reasons, and the pinned link is what makes the audit chain hold.

**Descriptive and generative specifications are distinct artifact classes** (D27) and must be distinguishable at the type level, not by a flag someone can set. The platform's own services will be the first descriptive specifications in the system (D39), so this is exercised immediately rather than theoretically.

**A specification can carry personal data, and T5 says the log cannot** (T25, new in v0.4). §5.1's sufficiency standards require a business case to record *who is affected*; §5.2's Tier 1 forbids secrets in a specification and says nothing about personal data in one; §7.4's scrubbing gate constrains what may be **published**, not what may be **stored**. So a business case naming a foreman, a ZZP'er, or a subcontractor's contact lands in an immutable append-only log, and GDPR erasure — a stated Tier 3 obligation — meets it head-on. PS2 anticipates this conflict for application payloads and v0.3 never picked it up for the artifacts PS3 itself holds.

**The split:** PS2 carries the structure, the decisions, the versions, and the references. Free-text and personal-data-bearing fields of a business case or specification are **PS7 payloads under a retention and erasure rule**, referenced from the log. A diff is then over structure and references — which is what §4.2 actually needs — and erasure remains possible without crypto-shredding the audit substrate. The conceptual counterpart is raised in §11.2.

**Open question A — the internal representation — is not resolved by this document and gates real generation.** The demo path below is deliberately arranged so that A can stay open: the demo needs the chain, the versioning, and the gates, not a settled specification language.

### PS4 — Gate and decision service

**Kept distinct from PS3 deliberately**, though it is a near thing. PS3 holds versions; PS4 holds the act of accepting one. It is also where lifecycle phase state lives (D12), where release gates run (§10.3), and where phase transitions are recorded as governed decisions themselves (§10.1).

**The split was a departure from the conceptual design and v0.3 did not say so** (T26, new in v0.4). §4.2 places the gate *inside* the specification service — *"the gate becomes a property of the service rather than of any one client"* — which is the property that makes external agent access over MCP safe. Under this document's precedence rule the conceptual design wins, so T-D was provisionally resolved against the split and it had to argue its way out.

**It did not, and v0.8 closes it: PS4 folds into PS3 as a bounded context** (T40). The argument for separation was that acceptance logic in exactly one place is what makes P13 a property rather than a convention — but a module boundary inside one service delivers that as well as a network boundary does, and it delivers *one* surface to guarantee rather than two. `specs-service` reached the same conclusion from its own two consumers — maestro v1 and this rebuild (§3.0.1, T42) — which is the third support. What stays outside the fold is **ceiling and oversight resolution**: those are read from PS11 and PS1 at decision time and are inputs to a gate rather than part of one, so W8's one-resolver rule is untouched.

**This is where P13 actually lives.** Every write from every interface — UI, API, agent over MCP, the composition plane itself — creates a proposed version; only PS4 accepts. If acceptance logic exists in more than one place, P13 is a convention rather than a property.

**Every acceptance record carries:** the gate, the accountable named human (P12, always, regardless of who acted), the acting principal, the oversight level in force, the consequence class, and the applicable standards results from PS5.

**That last field makes PS4 depend on PS5, and the build order puts PS5 second** — so **the first gates accept with an empty standards result, and the demo does not yet demonstrate P2.** This is a reasonable increment and it is now stated rather than discovered: a gate that records who accepted what, at which oversight level, is worth building before a gate that can also mechanically refuse. §5.1 carries the same note.

**Ceilings are configuration, not code** (§12.5) — they vary by jurisdiction and consequence class, Tier 1 sets absolute ceilings nothing may raise, and a pack may lower them further but never lift them. §12.5 is more specific than v0.3 recorded: ceilings belong **in the domain pack**, not merely outside code. Their store is therefore PS11, and until PS11 exists PS4's ceilings have no home that survives a pack version.

### PS5 — Standards engine

**For demo 1, sufficiency standards only.** This is the cheapest thing that proves the central bet (§1.3), because the Explore gate is what makes the platform a governance product rather than a code generator. Conformance standards, tier resolution, and Tier 3 with its interpreting-party machinery (§5.3) come later and none of them are needed to demonstrate that a business case can be mechanically judged insufficient.

**Build the standard object from §5.5 in full even while only evaluating sufficiency** — `applies_when`, `consequence_class`, `severity`, `effective_from`/`effective_to`, `interpreting_party`, `evidence_required`. The fields are cheap now; a standards store that has to grow them later invalidates every record written before.

**Effective dating is not optional even in v1.** A standards engine without it cannot answer "was this conformant at the time," which is the only question an auditor asks.

**PS5 evaluates; it does not store packs and it does not decide when to run.** v0.3 left both with no owner. Standards arrive from PS11 as part of a versioned pack, and re-evaluation is triggered by PS12 — on a pack publication, on an `effective_from` date arriving, on a `review_due`, or on an observed deployment (§14.4). PS5 stays a pure evaluator, which is what keeps it testable against golden fixtures.

### PS6 — Telemetry and metrics

**Two consumers, two very different products, and conflating them is the trap.**

| | **Internal platform telemetry** | **Client-facing application dashboard** |
|---|---|---|
| Audience | Platform engineering (support tier S3, §13.1), operations seat | Application Owner, Sponsor |
| Content | Fleet health, service metrics, traces, logs | Operational health *and* business outcome (§10.5) |
| Origin | Commodity | Generated per application from the specification (D38) |
| Decision | **Adopt** — Grafana-class tooling | **Build**, as an archetype composition |
| Hands over at exit? | No | Yes, with the application (§13.5) |

**Adopt for internal.** It is a commodity, it is not the product, and §1.3 says the engineering spend belongs on governance. Building an observability stack is the most seductive available way to spend six months not shipping a governance platform.

**Generate for client-facing.** Three reasons from the conceptual design, all binding: §1.1 commits that the user never sees a cloud console; the metrics are derived per application from the business case (§10.5); and it must hand over with the application at exit (§13.5). It is an Insight plus Monitoring-and-alerting composition over provided telemetry (§8), which is the §4.6 dogfooding claim made concrete rather than asserted.

**What PS6 provides** is therefore narrow and stable: ingestion, storage, query, retention, and the dashboard runtime. Not dashboards.

**MCP over telemetry, per D13's precedent.** It lets the Operations seat perform cause analysis through the same interface an Auditor reads, which means §12.3's ceilings apply to investigation automatically instead of needing a parallel authorisation path.

### PS7 — Data plane and history

*Full design in `ps7-data-service.md`. This section stays authoritative for placement, dependencies, and build order; that document is authoritative for the internals.*

**PS7 carries all application data, including the application event plane** (T18, revised v0.3). Streaming and batch are two *access modes* over the same shapes, not two services.

**PS7 is realised as `data-service`, a standalone product** (T32, new in v0.6) — its own domain, its own console, SSO through `identity-service`, and usable without maestro. This is the posture `identity-service` and `specs-service` already take, and it is not a commercial flourish: §13.5 hands the platform services to the client at exit, and a service with consumers of its own hands over as a product rather than as a maestro-shaped extraction. It also decouples the schedule. PS7's first wave is **◐ record + series**, so the event shape is not on maestro's critical path and arrives with AE6 — which means the service can be built product-first rather than under demo pressure.

**The name is deliberately not `event-data-service` or anything naming Kafka.** T22 forbids a platform service naming its substrate, and *event* is one of four shapes — the two the first wave actually needs are record and series. Kafka is an engine under the event shape; it appears in the deployment topology and never in the contract (PS7 H3).

**Shape it by §8's data-shape axis, not by vendor category.** The axis is *record / document / event / series*, and it maps almost exactly onto relational, document, log, and columnar storage. Deriving the interface from the archetype axis rather than from product categories keeps the two aligned by construction: a new data shape in §8 is the only thing that should add a store.

| | Shapes | Access modes |
|---|---|---|
| **A specification may name** | record, document, event, series | streaming, batch |
| **A specification may never name** | a store | a vendor |

**Consolidate the contract; keep the engines separable.** The unification worth having is a single interface where a specification declares a shape and a mode. Underneath, the log, relational, document, and columnar engines stay independently operable and independently replaceable. The failure mode of "one larger generic data service" is an interface that is the union of four products' APIs, owned by nobody — deriving the contract from §8's axes rather than from the products is what prevents it.

**Why the application event plane belongs here rather than beside PS2.** Business events routinely carry personal data, and T5 places personal data in the data plane under a retention and erasure rule. A separate event hub would therefore need PS7's retention classification, erasure machinery, and schema evolution — so it would either be PS7 or a second implementation of PS7's hardest parts. Two schema registries diverge, and §9 names schema evolution as a place things fail catastrophically rather than visibly. *Event* is also already one of §8's four shapes; a separate event store duplicates the taxonomy rather than extending it.

**What makes it a governance service rather than database-as-a-service** is the second half of §4.6's name — *and history*. It owns schema evolution, temporal history, and lineage. Lineage that stops at a plane boundary is not lineage: §4.2 requires traceability in both directions, and a fact in a registry and the same fact on a stream belong to one graph.

**Tenant isolation** (T6) — per the single statement in §2.2. Offline tolerance is a property of this service plus AE7, decided now (§4).

**PS7 also holds the personal-data-bearing fields of specifications** (T25, PS3). That is not a widening of its remit — it is the same retention-and-erasure rule it already applies to application payloads, applied to the one artifact class that would otherwise force personal data into PS2.

**Connectors are not part of PS7** (T19). The exchange engine AE6 crosses a trust boundary and enforces outbound capability grants alongside PS9 — volume ceiling, value ceiling, approval threshold, reversal path (§11.2). That is a governance function. Folding connectors into a data hub is how capability enforcement quietly becomes a data-plane feature and stops being Tier 1.

### PS8 — Notification and escalation

Deliver a message to a named party, with a deadline, and record that it was delivered, seen, and acted on. Deadlines are derived, not entered — §5.7 derives them from `effective_from`.

**It is a platform service because the platform needs it before any application does:** pack-change notification (§5.4), re-attestation escalation to owner and steward (§5.7), advisor acceptance re-solicitation (§15.3, §5.3.2), remediation escalation at N1 where the platform may not fix the thing itself (§14.6), and Tier 1/Tier 3 finding deadlines on the exception ledger (§14.5). The Monitoring-and-alerting archetype is then a *consumer* of PS8, not a reimplementation of it.

**The record matters as much as the delivery.** "We notified the tenant's advisor on this date and they did not respond" is an audit artifact, and under §15.3 it is the evidence that the platform discharged an obligation it does not control the other half of.

### PS9 — Edge and capability gateway

**Provided, not composed, because it is a Tier 1 enforcement point** (D41). P8 says ungranted capability is unavailable; §11.2 requires every outbound ability scoped with a volume ceiling, value ceiling, approval threshold, and reversal path. Those limits are worthless if anything generated can set them.

Inbound exposure for External portal, Field capture, Conversational surface, and Integration-and-exchange terminates here. It is also precisely the "auth edge" seam in §14.7's N3 substitution table, which means building it well is what makes N3 sellable.

**PS9 depends on PS4**, which v0.3 did not record: §11.2 scopes every grant with an *approval threshold*, and an approval threshold is a gate. A grant above its threshold is a proposal, not a capability.

**The edge is adopted; the enforcement is built** (§3.1). Terminating TLS and routing is commodity — Envoy behind the existing Cloudflare Tunnel on the PoC, an ALB or Envoy ingress on the MVP. Ceilings, limits, and revocation are **not** commodity and must not become a feature of whatever gateway is in front, or the enforcement stops handing over at exit and P8's grants become as unenforceable as the attested capability D32 distinguishes them from.

**Attested versus granted capability (D32) is visible here or nowhere.** An onboarded application's existing capability does not pass through this gateway and cannot be revoked by it; only substituted boundaries yield real grants. The gateway is the boundary that makes the distinction observable rather than theoretical.

### PS10 — Secrets and policy

Deferred until a generated application touches a real external system. Listed because §9 puts it in the provided row and omitting it from the service list is how it ends up half-implemented inside three other services.

### PS11 — Pack registry

*New in v0.4 (T20). Derived from §5.6 and §16, which have no service in §9's row.*

Through v0.3 "pack" appeared in this document only as a passing reference, and PS5 was tacitly assumed to hold standards. **A pack is much more than its standards** — §5.6 bundles vocabulary and ontology, sufficiency standards, Tier 2 and Tier 3 conformance standards, archetype templates and reference specifications, connector definitions, reference data, and golden test fixtures — and §12.5 adds oversight ceilings to that list. It has a lifecycle nothing else owns:

- **Versioning and effective dating** (§5.5, §5.6), which is what lets PS5 answer "was this conformant at the time"
- **Publication as a governed act**, by the pack-publication platform function at an O2 ceiling (§3.3) — so publication is a PS4 gate like any other
- **Materiality classification on every change** (D24), the field that lapses tenant advisor acceptance fleet-wide, that §15.3 names as the sharpest operational risk in the model, and that open question **G** says is still unassigned
- **Transfer at exit as a dated snapshot** (D21) — an explicit contractual deliverable, and §19.8 says packs matter more to a compliance client than the code generator does
- **Ceiling configuration** (§12.5), which is where PS4's ceilings actually live

**§16's rule binds this service hardest of all.** Core carries zero domain knowledge; PS11 is the registry, never an author, and it must be able to hold two packs simultaneously — §16 requires the pack format validated against two domains before shipping one.

**First wave: one pack, no publication gate.** The first wave needs a construction pack to exist, be versioned, and be effective-dated. It does not need materiality classification, a publication gate, or a second domain — but the *fields* go in from the start, for the T7 reason: a registry that grows them later invalidates every record written before.

### PS12 — Assurance and drift

*New in v0.4 (T20). This is §4.8, the assurance plane, which had no service through v0.3.*

**Nothing owned time.** §5.4's regulatory watch, §5.7's re-attestation on `effective_from`, `review_due` on the standard object, and §14.4's re-derivation of a descriptive specification on every observed deployment all require something to *fire* on a date or an event. PS8 delivers a message once told to; it does not decide when. PS5 evaluates when invoked; it does not invoke itself. PS12 is what invokes them.

Its remit is §4.8's, stated as a service:

- **Triggers** — scheduled (`effective_from`, `review_due`, re-derivation cadence) and event-driven (pack publication, observed deployment, incident)
- **Re-evaluation** — calls PS5 across every affected specification and classifies the result into §5.7's four outcomes: conformant, conformant with drift, non-conformant auto-remediable, non-conformant manual
- **The conformance record** (§5.8) — produced continuously, beginning at the business case, not projected from PS2
- **Expiry, not staleness** — §14.4's rule for descriptive specifications, which needs a clock and an owner
- **Escalation** — hands PS8 the deadline, derived from `effective_from` rather than entered

**PS8's own argument applies verbatim: the platform needs this before any application does.** Four platform obligations depend on it and none of them wait for a generated application.

**The alternative — folding the triggers into PS8 — is rejected.** It would make the notification service invoke the standards engine, which inverts the dependency and puts governance logic inside a delivery mechanism.

**First wave: the conformance record only.** The first wave produces a record from the business case forward. Scheduled re-evaluation arrives with PS11's second pack version, and regulatory watch stays deferred to Phase 4 (§6).

### PS13 — Artifact and release custody

*New in v0.4 (T20). This is §4.7, the delivery-and-operations plane, which had no service through v0.3.*

Four commitments already made in this document and the conceptual design have nowhere to land:

| Commitment | Source |
|---|---|
| Every deployed artifact emits an SBOM, **from the first one** | T10, §7 |
| Artifacts are signed | §10.3 |
| Every release is reversible to the previous specification version, with data intact | §13.3 |
| Identity and version of every deployed artifact, an event when it changes, and **a known-good rollback target under platform custody** | §14.6's instrumentation contract |

**This is not deferrable, and that is the surprise.** T10 says SBOM emission starts now; §17 puts onboarding at N0–N1 in **Phase 0**, so the instrumentation contract's rollback-target obligation lands before the composition plane exists. PS13 therefore has a first-wave scope even though nothing is generated yet: an artifact ledger, SBOM capture, and a deployment event on PS2 for every environment.

**`core-services` is the PoC substrate and the natural first home** (§3.0.1) — it already deploys per-host Docker stacks over SSH with pinned Compose projects and contexts, which is exactly the deployment event PS13 needs to record.

**The registry is adopted, the ledger is built** (§3.1). A local registry on the PoC and ECR on the MVP; OCI is portable, so the exit constraint is satisfied. What must be ours is the ledger tying artifact → specification version → gate decision → deployment → rollback target, because that chain is the §4.2 traceability requirement extended to the runtime, and nothing off the shelf holds it.

### PS14 — Work and obligation custody

*New in v0.7 (T35). This is the **work** half of §4.7, which PS13 left behind — see §1 and §3.0. Full design in `ps14-work-service.md`.*

**The one-sentence case: PS8 records that someone was told, and nothing records that anyone did it.** Six commitments in the conceptual design have no store, and they are not minor ones:

| Commitment | Source |
|---|---|
| Response and resolution times by severity, per criticality tier | §13.2 |
| S1–S5 triage, and the S4/S5 misroute §13.1 calls the costliest | §13.1 |
| Remediation authority never exceeds the onboarding level; the correct N1 output is a **recorded** escalation whose *pattern* is the argument for N2 | **D29**, §14.6 |
| At N1 the platform commits availability and response, **never correctness** — *"contractual rather than understood"* | **D30**, §14.11 |
| The exception ledger's expiries and remediation deadlines; *"a ledger with no expiries is a way of never fixing anything"* | §14.5 |
| Sampling above O2 and the periodic audit of the meta-control at a fixed cadence | §12.2, §12.5 |

**Two of those become mechanical rather than contractual, and that is the strongest argument for the service.** D29 and D30 are today enforced by a sentence in a contract. PS14 checks them at claim and *refuses* — a `patch`-class item cannot be claimed on an N1 application, and a correctness-shaped commitment cannot be raised there at all. §14.11 names D30's failure mode as the primary way an ops business dies; a mechanical check beats a contractual one against a failure of that weight.

**PS14 is also the evidence base §12.2 lacks.** Automatic demotion needs an adverse-outcome signal and sampling needs a population. PS4 supplies the *decision* population; above O2 most of what an agent does is work rather than decisions, and nothing recorded it. This is why PS14 is first wave and not deferred with the promotion machinery it feeds — §12.5's order is recording, then demotion, then promotion, and recording is the part that cannot be retrofitted.

**The boundary with PS12 is a clock rule, not a subject-matter rule** (T36). PS12 decides *what must be re-evaluated and when* and, where §5.7's outcome is *non-conformant, manual*, it **raises a work item**; PS14 chases it to closure. A clock belongs to whoever owns the subject it fires on. The tidier alternative — PS14 as the platform's only scheduler, PS12 reduced to a pure evaluator like PS5 — is rejected because it puts *which specifications does this pack change affect* inside a work service. PS14 depends on nothing about PS12's internal shape, so a later consolidation of PS12 with its neighbours costs nothing here (W-A).

**Built, not adopted, and this needs saying because the off-the-shelf answer is loud.** A work tracker is the most obviously buyable thing in §3, and none of them can hold the three checks in §5 of the service design: authority resolved from onboarding level and remediation class, a ceiling resolved from a domain pack, and an outcome vocabulary in which *escalated out* is a success. A bought tracker would also become a second home for governance facts, against W1 and §4.2. The board is cheap; the refusal is the product.

**One thing it must not become.** Scheduling *work in time* is PS14; scheduling *resources under constraints* is AE2, and T15 exists to keep those apart. Work *about* an application is PS14; work *inside* one is AE1. Both lines are in the service design as W2 and §1.1, because a work service with no stated exclusions grows into a workflow engine nobody approved.

### PS15 — Agent execution and composition

*Design in `ps15-agent-service.md` (v0.1). Absent from §3's table until v1.0, which was a transcription defect rather than a derivation one.*

The deterministic machinery around a model: the run, the construct at a version, and the **mediator** — the single place a model's output stops being a proposal and becomes an effect. It is §9's determinism boundary made an enforced interface, which T14 requires and nothing else provides; §11.1's A0–A4 ladder checked at the moment of action; §4.4's composition plane, which has had no service since v0.2; and the physical home of D20's non-transferring IP, which is why it is the one entry in §3.1's table with **no handover form**.

### PS16 — Runtime and instance custody

*New in v1.0 (T43). This is §4.5, the runtime plane, which had no service in any version of this document. Full design in `ps16-runtime-service.md`.*

**PS16 holds the instance and executes the ones the platform hosts.** §7.1 has made *instance* one of three tenancy levels since v0.3 — *"a running realisation of a specification within a tenant… the boundary for deployment, environment, configuration, runtime data"* — and nothing has held one. Four further obligations landed in the same hole: §13.3's automated rollback (PS13 holds the target, nothing moves to it), §14.6's restore class (*"the bulk of real remediation"*, minimum level N1, no actuator), §13.4's decommission, and T28's L1→L2 dial, defined as *"a deployment change"* with no owner.

**Execution is serverless: functions on a per-tenant shared open-source FaaS runtime** (T44). The argument is not economy of fashion but that **four Tier 1 invariants stop being disciplines and become physical properties** — application state has nowhere to live but PS7 (T19); a sandbox with no general egress makes PS9 the only route out, which is D41 enforced by network policy rather than by code review (PS16 X3); credentials are invocation-scoped so PS10 has no bypass; and the tenant handle is bound per invocation from the instance record rather than at boot and trusted thereafter (T28). This is §9's own logic — the layers where failure is catastrophic rather than visible are the ones taken out of the generated layer's reach — applied to the substrate instead of to the service set.

**The contract names an execution mode and a resource class, never a runtime, a container, an orchestrator, or a node** (T44). Four modes, derived by the D40 walk rather than enumerated: **request**, **event** (at-least-once), **scheduled**, and **job**. `job` is in the set because AE2's constraint solver does not fit request-response at all, and a design shipping only the first two discovers that under load rather than in review — T34's failure on a different plane.

**Two kinds of instance, and only one executes** (T47). A **managed** instance realises a generative specification the platform composed and hosts. An **observed** instance is a descriptive specification's running counterpart on the *client's* infrastructure — every onboarded application at N0–N2 — and PS16 records it and does nothing else. They are distinct kinds rather than one kind with a flag, for D27's reason and P14's: a single record with a defaulted `hosted_by` is one field away from the platform acting on infrastructure it does not own.

**This gives PS16 a first wave that contains no execution at all.** The observed half discharges §14.6's instrumentation-contract obligation — *identity and version of every deployed artifact, and an event when it changes* — and supplies the fact PS12's re-derivation clock and PS13's ledger both read and neither holds. The execution half waits for the composition plane in Phase 1. **This is §4.7's two-halves lesson applied prospectively rather than in hindsight**, which is the first time the T35 rule has been used before rather than after the omission.

**Three exclusions, each of which will be pressed.** PS16 applies a PS4 decision and never makes one, so an instance with no accepted decision behind it is a rejected write (P13). It does not host the platform's own services — D39 onboards the platform at N2, which is change control, not hosting, and a runtime service running itself is a circular dependency at the worst layer (T48). And **hosting is not a rung on §14.7's ladder** (T49): every substitution in that table replaces a seam inside an application that keeps running where it runs, and selling *"we will move it to our platform"* as an N3 step converts a graded engagement into the bet §14.7 exists to prevent.

---

## 4. Archetype engines

*New in v0.2. This section derives the engine set by walking §8's catalogue — the method behind D40.*

### 4.1 Three layers, not two

Platform services (§3) are one row of §9. The archetype engines are a different row with different rules, and keeping them apart matters more than where any individual component lands.

| Layer | Rule | Contents |
|---|---|---|
| **Generated per application** | Emitted by the composition plane from a specification | Domain model, rules, process definitions, screens, bindings, metric definitions, dashboard |
| **Composed from primitives** (**AE**) | Platform-built, **wired by specification**, may differ per application | The engines below |
| **Provided, never generated** (**PS**) | Identical for every tenant; carries P4's guarantees | §3 |

The failure mode in each direction is concrete. An engine that drifts *up* into the provided row means every application shares one process model. A service that drifts *down* into the composed row means schema evolution or capability enforcement becomes generated, which §9 names as catastrophic.

### 4.2 Three planes, not two

*Revised in v0.3. The v0.2 split was record spine versus application event plane; the question "should the event hub and the data hub be one service?" showed the boundary sits elsewhere. It is **governance record versus application data**, with telemetry held separate for a third reason.*

| | **PS2 record spine** | **PS7 application data plane** | **PS6 telemetry** |
|---|---|---|---|
| Carries | Decisions, versions, attributions, oversight levels | All application data — record, document, event, series | Operational signals and metrics |
| Producers | Platform services only | Generated applications | Everything |
| Retention | Multi-year, driven by §13.4 | Per classification and erasure rule | Operational |
| Personal data | **Never** (T5) | Routinely, under a retention rule | Avoided |
| Mutability | Append-only, immutable — the audit substrate | Shape-dependent | Rolled up, expired |
| Isolation | Topological (T6) | Topological (T6) | Topological (T6) |

**PS2 stays separate because merging it destroys what it is for.** Fold business traffic into the audit substrate and you either inherit "no personal data, multi-year retention" on everything, or you relax those constraints and lose the property the whole conformance record rests on.

**PS6 stays separate for a different and less obvious reason: §14.7's substitution order.** Telemetry and audit is substitution **1**, high reversibility; data plane and history is **last, often never**, very low reversibility. §14.7 states that reversibility — not value — is the ordering criterion, because an irreversible early step converts a graded engagement into a bet. A single fused data platform cannot be substituted piecewise, which removes the cheapest and safest first step of every N3 engagement. **The substitution catalogue is therefore a constraint on service decomposition, not just on sequencing** (T18).

**Streaming and batch are access modes, not services.** Both are PS7 concerns over the same shapes; see PS7 in §3.

**Connectors split across layers.** The exchange engine is platform (AE6); connector *definitions* live in the domain pack (§5.6); the wiring is generated. They are not part of PS7 (T19) — they cross a trust boundary and enforce capability grants. §16's rule holds: core carries zero domain knowledge.

### 4.3 Archetype → engine matrix

Every archetype in §8, and what it requires to run.

| Archetype | Platform services | Engines |
|---|---|---|
| **Registry** | PS7 | — |
| **Insight** | PS6, PS7 | — |
| **Workflow and approval** | PS7, PS8 | AE1 |
| **Scheduling and allocation** | PS7 | AE2 |
| **Monitoring and alerting** | PS6, PS8 | AE3 (thresholds), AE1 (response) |
| **Document generation** | PS7 | AE4, AE3 |
| **Document understanding** | PS7 | AE5, bounded by AE3 |
| **Integration and exchange** | PS9 | AE6 |
| **External portal** | PS1 (external population), PS9 | AE1 |
| **Field capture** | PS7 | AE7 |
| **Conversational surface** | PS1 | AE5 |
| **Rules and calculation** | PS7 | **AE3** |

**PS16 is deliberately absent from every row and belongs in all twelve** (T43). It is left out for the same reason PS1 and PS2 are: a service every archetype needs unconditionally carries no information in a matrix whose purpose is to show *which* archetype needs *what*. The absence is worth stating once rather than repeating twelve times, because it is exactly how §4.5 stayed unowned — **a requirement so universal that no row records it looks, from the row side, like no requirement at all.**

| # | Engine | Serves | Notes |
|---|---|---|---|
| **AE1** | **Process engine** | Workflow and approval; External portal; alert response | State machines, human tasks, escalation. UI, API, MCP — but writes *propose* (§4.5) |
| **AE2** | **Allocation and scheduling engine** | Scheduling and allocation | **Not the same as AE1.** Constraint satisfaction over resources and time, not state transition. Conflating them produces a workflow engine that cannot schedule and a scheduler nobody can approve against |
| **AE3** | **Calculation engine** | Rules and calculation, and most others | Deterministic, versioned, effective-dated, traceable. §8's only cross-cutting archetype |
| **AE4** | **Document engine** | Document generation | Templating, composition, rendering, versioned output. The Wkb dossier lives here |
| **AE5** | **Agent runtime** | Document understanding; Conversational surface | Model-backed and therefore non-deterministic by construction — see the boundary below |
| **AE6** | **Exchange and connector engine** | Integration and exchange | Engine platform, definitions from the pack, wiring generated |
| **AE7** | **Offline sync engine** | Field capture | Conflict resolution, ordering, partial connectivity. A property of the design or absent from it |

### 4.4 AE3 is the one that gates the product

**The calculation engine is not one engine among seven.** P3 requires anything with legal or financial consequence to be computed by a versioned deterministic rule, never inferred by a model at runtime. Tier 1 requires every binding calculation deterministic and traceable. §14.7 states that rules and calculation is "where P3 and Tier 3 conformance actually get satisfied."

The consequence for build order is hard: **you can ship applications without AE3, but you cannot ship a regulated one** — and regulated applications are the product. It is also the busiest engine, since §8 marks it cross-cutting and most other archetypes route binding values through it.

**AE3 and AE5 are designed together, because the determinism boundary is the seam between them.** §9's phrasing is the specification: *the agent may propose a rule, never be the rule at runtime.* AE5 extracts, classifies, drafts, and proposes; AE3 computes anything binding. If that boundary is a convention rather than an enforced interface, P3 is decorative — and P3 is most of what a regulated client is buying.

### 4.5 Every service and engine exposes UI, API, and MCP — under one constraint

D13 already makes MCP the integration seam for the specification service, and the same triad should be the default everywhere. **P13 constrains what the write half may do: every interface proposes, only PS4 accepts.** An engine with an MCP write surface that commits its own state has created a second gate, and P13 degrades from a property to a convention.

The specification service UI is the platform's primary human surface — where an originator raises, a sponsor decides, an owner approves — and is the first concrete answer to conceptual open question **O**.

---

## 5. Build order

### 5.1 Platform services

```
PS1 identity ──► PS2 record spine ──► PS3 + PS4 specification and gates ──► PS11 packs ──► PS5 standards
                       │                                                                        │
                       ├──────────► PS6 telemetry ──► (generated dashboards)                     │
                       ├──────────► PS7 data plane                                               │
                       ├──────────► PS8 notification ──► PS14 work ◄──────────────── PS12 assurance
                       └──────────► PS13 artifact custody              (PS12 raises, PS14 chases)
                                          │
                                          └──► PS16 instance record  ── observed instances only

  deferred by trigger, not by dependency (§6):   PS9 edge and capability ◄── PS1, PS4
                                                 PS10 secrets and policy ◄── PS1
                                                 PS15 agent and composition ◄── PS3, PS14
                                                 PS16 execution ◄── PS9, PS10, PS13, composition plane
```

**PS16 appears twice on purpose, and that is the shape rather than an untidiness.** Its record half sits in the first wave beside PS13 because §14.6's instrumentation contract lands in Phase 0 with N0–N1 onboarding; its execution half is deferred by trigger, because there is nothing to execute until the composition plane exists. Splitting a service across the line is new here and is the honest reading of T35 — the two halves of §4.7 turned out to be two services, and the two halves of §4.5 turn out to be two waves.

**PS11 moves in front of PS5**, which is the one real reordering in v0.4: a standards engine with no pack to load standards from has to invent a store, and that store becomes a second registry the moment a real pack arrives.

| Step | Gate on moving to the next |
|---|---|
| **PS1** | An agent principal is distinguishable from the human accountable for its seat, and from its service account, in a query |
| **PS2** | An event is written, archived, and projected; a tenant-scoped read cannot return another tenant's data by construction rather than by filter; an archived record's integrity is verifiable from the open-code service alone, with no vendor primitive in the chain |
| **PS3 + PS4** | A business case can be proposed, gated, accepted, superseded, and diffed — with the accepting decision carrying accountable human, acting principal, and oversight level. **The standards result on that decision is empty until PS5, and the P2 claim is not yet demonstrated** |
| **PS11** | A pack is published at a version with an effective date, and a second version supersedes it without invalidating records written against the first |
| **PS5** | A business case is mechanically declared insufficient, with the failing standard, its version, and its pack named |
| **PS6** | An application's operational health is ingested, stored, queried, and retained. *Not* the outcome metric — §10.5 instruments that at Build, which Phase 0 does not have (§17), so v0.3's gate presumed a phase the first wave never reaches |
| **PS7** | A schema change is applied with history preserved and lineage queryable, and the same fact is readable in streaming and batch mode without naming a store |
| **PS8** | A deadline-bearing notification is delivered, tracked, and recorded as an audit artifact |
| **PS14** | A `patch`-class remediation on an N1 application is **refused at claim**, closes as *escalated out* to the Owner, and that application's escalated-out rate is queryable in one call — and separately, an item breaches its derived deadline with every chase step delivered through PS8 and recorded |
| **PS12** | A pack version publishes and every affected specification is re-evaluated unprompted, classified into §5.7's four outcomes, with a deadline derived from `effective_from` and escalated through PS8 |
| **PS13** | Every deployed artifact has an SBOM, a signature, a recorded deployment event, and a named rollback target that has been exercised at least once |
| **PS16** *(record half)* | An observed deployment updates an application's instance record, PS12 re-derives its descriptive specification against it, and *age since last observed deployment* is queryable per application. **No execution in this step** |
| **PS9** *(deferred)* | A grant with a volume and a value ceiling is enforced at the edge, revoked, and the refused attempt recorded — with the enforcement in our code rather than in the gateway's configuration |
| **PS10** *(deferred)* | No service reads a credential from its own configuration |
| **PS15** *(deferred)* | A model-proposed action that exceeds the run's autonomy level is refused before any effect exists, and the refusal is queryable as a rate |
| **PS16** *(execution half, deferred)* | A function runs; a second tenant's invocation cannot resolve the first's tenant handle by any payload; an invocation without an idempotency key is refused; a redelivered event produces exactly one effect; a `patch`-class act on an N1 instance is refused **at the act**, not only at PS14's claim |

**PS9, PS10, PS15 and PS16's execution half have gates even though they are deferred**, because a deferred thing with no definition of done arrives under pressure with its criteria invented on the spot. PS9 and PS10 were the original instance of this; PS15 and PS16 would have been the next two.

### 5.2 Engines

§17 Phase 1 calls for composition against **two archetypes**. The pair, and what follows:

| Order | Engines | Unlocks | Why here |
|---|---|---|---|
| **1** | AE1 process | Workflow and approval | With PS7 gives **Registry + Workflow** — a change-order register with approval is a real construction application and proves the generation loop end to end |
| **2** | **AE3 calculation** | Rules and calculation | Gates every regulated application (§4.4). Nothing Tier 3 ships before it |
| **3** | AE4 document | Document generation | The Wkb dossier (§5.8), the flagship NL construction deliverable |
| **4** | AE5 agent runtime | Document understanding, Conversational surface | Designed against AE3's boundary, never before it |
| **5** | AE6 exchange | Integration and exchange | Needs PS9 and PS10 |
| **6** | AE2 allocation, AE7 sync | Scheduling, Field capture | Real requirements, no demo dependency — but AE7 constrains PS7's design, so **decide offline tolerance now even though the engine is built last** |

**Registry + Workflow proves that composition works. Registry + Calculation + Document proves the product works.** The first is the cheaper demo; the second is the one a construction client would pay for. Sequencing them 1 → 2 → 3 gets both without building anything twice.

### 5.3 PS7 is built shape by shape

Consolidating the contract does not mean building the whole data plane at once. Shapes arrive as the archetypes that need them arrive, which makes the consolidated PS7 strictly cheaper than running two hubs from the start.

| Shape | Arrives with | When |
|---|---|---|
| **Record** | Registry | First wave |
| **Series** | Insight, outcome metrics (§10.5) | First wave |
| **Document** | Document generation | With AE4 |
| **Event / stream** | Integration and exchange | With AE6 |

Access modes follow the same rule: batch first, streaming when the event shape arrives. What is fixed from the start is the *contract* — shape and mode, never a store — because that is the part a specification binds to and therefore the part that cannot change later without invalidating every specification written against it.

**One thing comes before any shape: the classification envelope** (§2.4, new in v0.6). It ships on every shape as it arrives, including on shapes that only carry demo data, because a shape that accepts an unclassified write has produced data nobody can classify later. The full eight-step order is in `ps7-data-service.md` §13.

PS3 and PS4 are built together; the boundary between them is real but they are not independently useful.

**Everything in this order runs at O0–O1** per §12.5: ship the first client with no promotion machinery and no governance review agent. The framework's value at this stage is that the ceilings and the recording exist, not that anything is automated.

---

## 6. Explicitly not built yet

Recorded so they are not drifted into. Each has a stated trigger.

| Deferred | Until |
|---|---|
| **Composition plane** | Phase 1. Demo applications are hand-built (§17 Phase 0) |
| **PS16 execution — the FaaS runtime, admission chain, and every mode** | The composition plane emits something to run, or an application reaches N4. **The instance record is not deferred with it** — the observed half is first wave (§5.1) |
| **PS15 agent execution and composition** | Phase 1 with the composition plane. Its mediator is the enforcement point for §9's determinism boundary and gates nothing before there are agents acting |
| **PS9 edge and capability gateway** | An application is exposed externally, or an outbound capability grant needs enforcing |
| **PS10 secrets and policy** | A generated application touches a real external system. Not needed while nothing is composed |
| **AE2 allocation, AE4 document, AE5 agent runtime, AE6 exchange, AE7 sync** | Per the engine order in §5.2 — but AE7's existence is a PS7 design input now (§4.3) |
| **Conformance standards, tier resolution, Tier 3** | Phase 2, with the construction pack and an interpreting party (§5.3) |
| **PS11 publication gate and materiality classification** | The second pack version. The *fields* exist from the first (T7's rule) |
| **PS11 second domain pack** | Phase 5 — but §16 requires the format validated against two domains before shipping one, so the *validation* is not deferred with it |
| **PS12 scheduled re-evaluation** | The second pack version. The conformance record itself is first-wave |
| **Regulatory watch** | Phase 4 (§5.4) |
| **Supply-chain watch pipeline** | See §7 below — but SBOM emission and PS13's ledger start now |
| **Marketplace** | Phase 5 (§7) |
| **PS14 recurrence, sampling schedules, fleet fan-out** | Recurrence and sampling arrive with the first promotion above O2; fleet fan-out with PS11's second pack version. **The classes that carry Phase 0 — support, remediation, obligation — are first wave** |
| **Governance review agent, promotion machinery** | After an evidence base exists (§12.5). Demotion before promotion, always (D22). **PS14 is that evidence base**, which is why it precedes rather than accompanies this row |
| **Onboarding above N0–N1** | N2 needs change control and release custody, which arrive with Phase 3 (§17) — release custody is PS13, whose first-wave scope therefore also serves N0–N1 onboarding in Phase 0 |

**The user interface is not on the build list because it is a client of every service and engine, not one of them.** It is also still unspecified anywhere in the conceptual design — open question **O**. That is a gap to close before, not during, the demo build.

---

## 7. Supply-chain watch — deferred, with one thing done now

The conceptual design has a regulatory watch function (§5.4) and no equivalent for dependency vulnerabilities, while §13.2 already commits to a "maximum patch latency for security defects." The obligation exists; the function discharging it does not.

The pipeline is the same shape as §5.4 with different sources and a different artifact:

```
CVE and advisory feeds → SBOM match → affected instances → patch → re-verify
```

It maps cleanly onto machinery that already exists: detection needs only a manifest, so it works at **N0/N1**; patching is a Patch-class remediation requiring **N2** (§14.6), and at N1 the correct output is an escalation to the Owner, consistent with D30. Impact assessment is far more automatable than its regulatory counterpart — SBOM matching is mechanical — so its oversight ceiling can sit much higher than §5.4's.

**One thing is done now, because it is near-free and unpleasant to backfill: every deployed artifact emits an SBOM**, from the first one. Without it the watch function has nothing to match against, and reconstructing manifests for already-deployed artifacts is exactly the brownfield archaeology §14 exists to charge money for.

**As of v0.4 the SBOMs have somewhere to go: PS13.** v0.3 committed to emitting them and named no service that holds them, which is the omission T20 generalises — the obligation existed, the plane it belongs to (§4.7) had no service, and the commitment sat in a deferred section with nothing behind it. When the pipeline is built it consumes PS13's ledger and PS12's trigger machinery; neither needs to be reinvented for it.

*The conceptual-design changes this section implies are carried in §11.4.*

---

## 8. Bootstrapping: the platform onboards itself

D39, and it resolves the §4.6 paradox rather than working around it.

PS1–PS16 and the engines are built conventionally — deployed by `core-services` and then by CI, never by PS16, which is T48. They are then **onboarded onto themselves** using §14's machinery: each service gets a **descriptive** specification (§14.4) — a claim about code that already exists — at approximately **N2**, where the platform holds change control but the code is still hand-written. They flip to generative only when the composition plane can regenerate them, which is Phase 4 at the earliest and may be never for some of them.

Three things this buys, beyond closing the paradox:

- **The descriptive/generative distinction (D27) is exercised on day one** rather than first meeting reality on a client's system.
- **The first entries in the portfolio (§6) are the platform's own services**, which is the §15.8 sequencing problem solved for free.
- **It is the most credible possible demonstration of §14**, which is otherwise the least proven part of the design.

The upgrade path is the ordinary one and needs no special case: a service is governed by its own accepted specification version while its successor is proposed, gated, and released against it.

**The Docker-to-Kubernetes migration is the platform's own first N3 substitution** (T27, new in v0.4). Under D39 the platform services are onboarded onto themselves as descriptive specifications, and moving them from the PoC substrate to the MVP substrate is exactly what §14.7 describes: a sequence of platform-service substitutions, ordered by reversibility rather than value, on an application whose specification is descriptive rather than generative. Run it in §14.7's order — telemetry and audit first, identity and secrets next, the data plane last or never — and two things follow. The descriptive specifications will rot against the migrating code, which is §14.11's rot risk experienced first-hand and at no client's expense. And **if §14.7's sequencing does not survive contact with our own migration, it will not survive a client's** — which makes the migration the cheapest available test of the least proven part of the design.

---

## 9. Decisions

| # | Decision | Rationale |
|---|---|---|
| T1 | **Sixteen platform services (PS1–PS16) and seven archetype engines (AE1–AE7), derived from three sources: §9's "provided, never generated" row, §8's archetype catalogue, and §4's planes** | The generation boundary answers what is platform-level; the catalogue answers what must exist to run an application; the planes answer what the platform itself is obliged to do. *Revised v0.2 — the v0.1 list of six omitted the data plane, notification, the capability gateway, and every engine. Revised v0.4 — the v0.3 list of ten omitted the pack registry, assurance, and artifact custody (T20). Revised v0.7 — the v0.6 list of thirteen omitted the work half of §4.7, because PS13 made that plane look covered (T35). Revised v1.0 — the v0.9 table listed fourteen against a design set of fifteen, and both omitted §4.5 entirely (T43). **Four revisions, each finding what the previous derivation could not see; the count is a lagging indicator and the method is the artifact.*** |
| T2 | **Identity is built first; agents are first-class principals, distinct from the accountable human and from service accounts** | §12.4 requires all three answerable separately; shared service accounts make the oversight model unimplementable |
| T3 | **Delegated cross-tenant administration is designed into PS1 now, though the intermediary commercial model is deferred** | §7.5 and §19.7 both call it architectural rather than commercial; retrofitting an identity model is the painful case |
| T4 | **An append-only event log is the write path; projections are read models; a separate durable archive is the system of record for retained evidence** | §4.2's chain of record is a log; §13.4's retention outlives anything a log should hold |
| T5 | **Personal data never enters the event log; the log carries decisions and references, the data plane carries payloads under a retention rule** | GDPR erasure and immutable append-only logs are in direct conflict; resolving it later means crypto-shredding or a rewrite |
| T6 | **Tenant isolation is topological, not a query filter** | Tier 1, never overridable; a filter is one bug from a catastrophic failure (§9) |
| T7 | **PS5 evaluates sufficiency standards only for demo 1, but stores the full §5.5 standard object including effective dating** | Sufficiency is the cheapest proof of §1.3's bet; missing fields invalidate every record written before they are added |
| T8 | **Internal telemetry is adopted (Grafana-class); client-facing dashboards are generated as archetype compositions** | §1.1, §10.5, and §13.5 all forbid the client-facing case being platform tooling; the internal case is a commodity |
| T9 | **MCP is extended to telemetry, following D13's precedent for the specification service** | Lets the Operations seat investigate through the interface an Auditor reads, so §12.3 ceilings apply without a parallel path |
| T10 | **Every deployed artifact emits an SBOM from the first one, though the supply-chain watch pipeline is deferred** | §13.2 already commits to patch latency; backfilling manifests is archaeology |
| T11 | **The platform is onboarded onto itself at N2 with descriptive specifications (D39)** | Closes open question C, exercises D27 immediately, and populates the portfolio at the first client |
| T12 | **The governance record spine (PS2), the application data plane (PS7), and telemetry (PS6) are three separate planes** | *Revised v0.3.* PS2's retention, personal-data, and mutability constraints are incompatible with business traffic; PS6 is separate for the substitution reason in T18 |
| T13 | **AE3 (calculation) gates every regulated application and is built second, immediately after the first archetype pair** | P3 and Tier 1 both require binding values computed deterministically; without AE3 the platform can ship applications but not the product |
| T14 | **AE3 and AE5 (agent runtime) are designed together; the determinism boundary is an enforced interface, not a convention** | §9: the agent may propose a rule, never *be* the rule at runtime — the seam between these two engines is where P3 is real or decorative |
| T15 | **AE2 (allocation) is a distinct engine from AE1 (process)** | Constraint satisfaction over resources and time is not state transition; merging them yields a workflow engine that cannot schedule and a scheduler nobody can approve against |
| T16 | **Offline tolerance is decided now as a PS7 design input, even though AE7 is built last** | Field capture is a foreman on a bouwplaats with no signal; offline cannot be retrofitted onto a connected-assumption data plane |
| T17 | **Every service and engine exposes UI, API, and MCP; every write proposes and only PS4 accepts** | D13 makes MCP the seam; P13 collapses into a convention the moment a second component can accept its own writes |
| T18 | **The application event plane consolidates into PS7; PS2 and PS6 do not. Streaming and batch are access modes over shared shapes, not services** | Business events carry personal data, so a separate hub would reimplement PS7's retention, erasure, and schema evolution — and *event* is already one of §8's four shapes. PS6 stays out because §14.7 makes telemetry the first and most reversible N3 substitution, so **the substitution catalogue constrains service decomposition**, not only sequencing |
| T19 | **PS7's contract names a shape and an access mode, never a store or a vendor; the underlying engines stay independently replaceable. Connectors are not part of PS7** | Deriving the interface from §8's axes is what stops a consolidated data service becoming the union of four products' APIs; connectors cross a trust boundary and enforce capability grants, which is governance, not data |
| T20 | **The service set is derived by walking §4's planes as well as §9's row and §8's catalogue; a plane with no service is a defect** | D40's archetype walk derives what a *generated application* needs and is structurally blind to the platform's own obligations. §4.7 and §4.8 therefore had no service at all through v0.3, and the domain pack — §5.6's unit of extension, with its own versioning, publication gate, materiality classification, and exit deliverable — was owned by nobody. PS11–PS13 are what the walk recovered. **The method is the durable part, not the list** |
| T21 | **Adopt managed open source; never a proprietary primitive, anywhere in the provided row** | §13.5 hands the platform services to the client and §14.10 makes N3 exitability depend on it. MSK is Kafka and RDS is Postgres, so both hand over; DynamoDB, EventBridge, CloudWatch, Cognito and Step Functions do not, and adopting one converts P9 from a guarantee into an aspiration |
| T22 | **No platform service names its substrate, extending T19's rule upward from generated applications to the platform itself** | T19 protects specifications from vendor coupling and nothing protected the services from it. With a Docker PoC and a Kubernetes-plus-AWS MVP, a service that names its substrate makes the promotion a rewrite |
| T23 | **§14.7's substitution catalogue is a criterion for AWS service selection, not only for internal decomposition (extends D42)** | Managed services fuse the seams §14.7 depends on — EventBridge across PS2/PS7, CloudWatch across PS2/PS6. Fusing either deletes the cheapest, most reversible rung of every N3 engagement through a console decision |
| T24 | **Tamper-evidence for the durable archive is computed in application code — a hash chain or Merkle root — never delegated to a vendor primitive** | T-C's mechanism has to hand over at exit like everything else. S3 Object Lock and KMS are defence in depth, never the mechanism, or the conformance record's integrity claim dies with the AWS account |
| T25 | **Personal-data-bearing fields of a business case or specification are PS7 payloads under a retention and erasure rule, referenced from PS2** | §5.1 requires the case to record who is affected; T5 forbids personal data in the log; §7.4 constrains publication, not storage. Without the split, GDPR erasure meets an immutable log inside the platform's own centre |
| T26 | **The PS3/PS4 split is recorded as a departure from §4.2 and PS3+PS4 ship as one deployable with a hard internal boundary until T-D closes** | §4.2 places the gate *inside* the specification service, and this document's precedence rule says the conceptual design wins. v0.3 presented the split as settled when it is a divergence that has not been argued |
| T27 | **The Docker-to-Kubernetes migration is run as the platform's own first N3 substitution, in §14.7's reversibility order** | Under D39 the platform is its own first onboarded application. The migration is a free, client-free test of the least proven part of the design — and if §14.7's sequencing fails here it will fail on a client |
| T28 | **Tenant isolation is logical (L1) by default and physical (L2) per tenant by choice; enforced by binding a tenant-scoped handle once per request, never by filtering. `tenant_id` is stable across both and never encodes the deployment** | Closes T-L. T6 requires isolation in the topology, not in separate hardware; reading it as the latter produced a cost floor the small end of the market cannot carry. Binding rather than filtering is what keeps L1 and L2 interchangeable — one filtered code path removes the choice permanently |
| T29 | **A service may be shared across tenants only if it holds no tenant runtime data. PS11, the marketplace, and delegated-administration identity qualify; nothing else does yet** | Generalises §7.2's argument for a cross-tenant marketplace. Shared control plane, isolated data plane — and a shared service that accumulates runtime data has become a pooled data plane with a control-plane label |
| T30 | **No maestro record stores an identity provider's `sub`; maestro keeps a principal registry mapping `(issuer, subject)` to a maestro principal id** | A local subject is minted per `identity-service` deployment, so an L1→L2 migration re-mints it — against PS2 records that are immutable and retained for years. Without the indirection the deployment dial in T28 is not actually available |
| T31 | **PS1 is `identity-service` for authentication plus a maestro-built governance identity layer** | Follows that service's own ADR-0005: it is the identity authority and a Policy Information Point, not a Policy Decision Point. Tenancy, agent principals, seats and oversight are governance concepts and were never its problem to solve |
| T32 | **PS7 is realised as `data-service`, a standalone product composable under maestro — and the name never carries a shape or a substrate** | §13.5 hands the platform services over at exit, and a service with consumers of its own hands over as a product rather than as an extraction. It also decouples the schedule: PS7's first wave is record and series, so the event shape is off the critical path and the service can be built product-first. The name follows T22 — *event* is one of four shapes and Kafka is one engine, so neither belongs in it |
| T33 | **`event-integration-platform` splits into `data-service` (PS7) and `exchange-service` (AE6); `data-service` is started new rather than evolved out of it.** *Superseded in part: the repository is retired as a candidate for both halves, so what stands is **started new**, applied to AE6 as well as to PS7* | §3.0.1 assigned that repository to PS7 and AE6 at once, which T19 forbids — connectors cross a trust boundary and enforce capability grants. The split is therefore forced, not chosen. Starting new follows from §2.4: mandatory classification cannot be added to a store that already holds unclassified data, which is the one thing an in-place refactor would have to do first. *The AE6 half was retired separately, which leaves that engine with no origin and its requirements unwritten (§3.0.1, T-Q) — the salvage was in any case thin, since the repository's Flink runtime and AI assist layer were documented rather than built (`LIMITATION-0001`)* |
| T34 | **The application event plane's tenancy is a topic per tenant with a tenant-chosen partition count, not PS2's exclusive-partition model** | PS2 buys strict per-tenant ordering for its hash chain and can afford it because its volume is tiny by construction (PS2 §1). PS7 carries business volume and needs partition parallelism *within* a tenant. Copying PS2's model caps every tenant at one partition, which is discovered under load rather than in review. Narrows T-G: the two planes now have different topologies, so sharing a cluster is a cost decision and no longer a design one |
| T35 | **PS14 work and obligation custody is added as the fourteenth service; §4.7's plane was half-covered by PS13 and read as covered. The rule generalises: an obligation with no owner is a defect, even on a plane that already has a service** | PS8 records that someone was told and nothing recorded that anyone did it. §13.1's support tiers, §13.2's resolution times, §10.4's objective and signal artifacts, §14.5's exception ledger, §14.6's remediation ceilings and §12.2's sampling were all obligations named in prose with no store. T20's walk stops at the first service that fits a plane, which is one service short whenever a plane has two halves |
| T36 | **A clock belongs to whoever owns the subject it fires on: PS12's fires on specifications and packs, PS14's on commitments. PS12 raises a work item; PS14 chases it** | Keeps PS12 whole and avoids a cycle. Making PS14 the platform's only scheduler would move *which specifications a pack change affects* into a work service, which is the same inversion the PS12 rationale rejects for folding triggers into PS8 |
| T37 | **A work item is neither a proposal nor an acceptance; PS14 exposes no accept operation and holds no artifact versions. T17 gains a qualifying clause rather than an unstated exception** | P13 governs artifacts that assert something. A work item records that someone owes an act, and its state changes are facts — PS2 §6.3's ground, applied to a second service. Where an outcome needs acceptance, PS3 proposes and PS4 accepts and the item links to it. A decision a service quietly excepts itself from is worse than one with a stated boundary |
| T38 | **D29's authority ceiling and D30's no-correctness-at-N1 are enforced mechanically at claim in PS14, and refusal is a recorded outcome rather than a warning** | Both are contractual today, and §14.11 names D30's failure as the primary way an ops business dies. *Escalated out* is first-class because §14.6 makes the pattern of N1 escalations the commercial argument for N2, and a rate is a product input where a pile of closed tickets is not |
| T39 | **PS3 is `specs-service`, adopted, with maestro supplying a workspace definition rather than a service** | It was derived from **maestro v1 and this rebuild together**, whose artifact types, gates, and accountable roles differ across every dimension in conceptual §1.5 — so its generic core is the overlap of two materially different governance models rather than a single-consumer extraction, and it is generic by construction rather than by discipline. Its ADR-0001 makes artifact types, gates and lifecycles configuration, which satisfies §16 structurally; its record-sink port makes PS2 authoritative and its own store a projection, which is S1 without argument. It also supplies the **draft** entity PS3 v0.1 lacked, without which every agent extraction pass becomes a proposed version. **Weakened by the v1.0 rename and recorded as weakened** (T42) |
| T42 | **The rename costs T39 part of its force: the two consumers are two iterations of one product, not two products** | Stated rather than glossed. The generalisation argument survives, because the two models differ in subject, accountable human, gate set, terminal artifact, standards tiers, reach, and buyer (conceptual §1.5) — an overlap across that gap is a real generic core. What is no longer available is the stronger claim that an unrelated consumer validated the shape. So PS7 §1.3's split-out trigger — *a consumer that is not maestro* — is **not** satisfied by v1 and remains genuinely open, and the first outside consumer is still the event that proves the core is generic rather than merely argued to be |
| T40 | **T-D closes against the split: PS4 is a bounded context inside PS3, not a separate service** | §4.2 places the gate inside the specification service and is authoritative; T26 already resolved provisionally the same way and left the split to argue its way out, which it did not; and `specs-service` holds gates in the service. Three supports and none against. Ceiling and oversight resolution stay outside the fold — they are inputs read from PS11 and PS1, and W8's one-resolver rule is unaffected |
| T41 | **A `specs-service` version carries a classification validated at propose; erasure stays redaction in place rather than relocating the body to PS7** | T25's *goal* is that GDPR erasure never meets PS2's append-only substrate, and that service's redaction achieves it — the digest deliberately mismatches and the event explains why, so silent deletion stays distinguishable from tampering. What redaction does not supply is the classification, and §2.4's rule is absolute: a write with none is *unclassifiable*, not merely unclassified. This narrows T25 to its purpose rather than its mechanism |
| T43 | **PS16 runtime and instance custody is added as the sixteenth service; §4.5 — the runtime plane — had no service in any version of this document, and §3.0's audit table could not surface it because that table is organised by §9's row** | §7.1 makes *instance* one of three tenancy levels and nothing held one; §13.3's rollback had a target and no actuator; §14.6's restore class is *"the bulk of real remediation"* and nothing performed it; §13.4's decommission and T28's L1→L2 dial had no owner. Third variant of the same failure: T20 catches a plane with no service, T35 an obligation with no owner on a covered plane, and **T43 a plane the audit instrument itself cannot see**. PS15 is entered in §3's table in the same pass, having been omitted since v0.7 |
| T44 | **Execution is serverless by default — functions on a per-tenant shared open-source FaaS runtime — and the contract names an execution mode and a resource class, never a runtime, a container, an orchestrator, or a node** | Not economy but §9's own logic applied to the substrate: four Tier 1 invariants become physical rather than disciplinary — state has nowhere but PS7 (T19), a no-egress sandbox makes PS9 the only route out (D41), credentials are invocation-scoped (PS10), and the tenant handle binds per invocation rather than at boot (T28). T19 and T22 give the contract vocabulary; the four modes are derived by the D40 walk, with `job` present because AE2's solver does not fit request-response |
| T45 | **A runtime process is shared across applications within a tenant and never across tenants; separation between a tenant's own applications is a consequence-class dial** | T6 read exactly. Cross-tenant co-residency makes Tier 1 isolation a property of a language sandbox — L0 with better packaging, and one bug from the violation §3.3 forbids. No Tier 1 standard requires isolation between a tenant's *own* applications, so P10 says offer it rather than impose it |
| T46 | **The warm floor is resolved from consequence class and never authored; availability is invocation success rate and admission latency at a percentile, never uptime** | A scaled-to-zero instance is not down, so §13.2's availability target is unanswerable as written — a conceptual defect this decision surfaces rather than creates (§11.9). Resolving the floor from consequence class is P10 and turns a committed response time into a priced line item; leaving it authorable makes it a cost decision wearing a governance label |
| T47 | **A managed instance and an observed instance are distinct kinds, not one kind with a flag, and only the managed kind executes** | D27's discipline applied to the runtime and P14's rule made structural: the platform warrants only what it holds, and a single record with a defaulted `hosted_by` is one field from acting on infrastructure it does not own. It is also what gives PS16 a first wave — the observed kind discharges §14.6's instrumentation contract in Phase 0 with no execution at all |
| T48 | **PS16 does not host the platform's own services** | D39 onboards the platform at N2, which is change control and not hosting. `core-services` and then CI deploy the platform. A runtime service that runs itself is a circular dependency at the layer where a circular dependency is least recoverable |
| T49 | **Hosting is not a rung on §14.7's ladder** | Every substitution in that table replaces a *seam* inside an application that keeps running where it runs, and reversibility is the ordering criterion. Relocating an application is very low reversibility with no seam at all — selling it as N3 converts a graded engagement into the bet §14.7 exists to prevent. It is an N4 consequence, never a rung |
| T50 | **Every invocation carries an idempotency key derived from its trigger and is refused without one; effects at the PS7 and AE3 boundaries are keyed by it** | At-least-once delivery is the default under three of the four modes. **P3 survives per invocation and dies per effect** — a CAO calculation posted twice is a wrong regulated number, not a determinism failure — and the long-running-container design hides this behind in-process deduplication nobody wrote down. Deriving the key from the trigger rather than from the runtime keeps it verifiable across a substrate change (T22) |
| T51 | **A generated application instance is a workload principal in PS1, distinct from the end-user principal it acts for and from any service account; both principals are required on a PS7 write and an AE3 call** | T2's argument, one plane over. PS1 models human and agent populations; an application instance is neither, and would arrive as the shared service account T2 exists to forbid. Without it an audit trail can say a record changed and not which running thing changed it, which fails §12.4 for applications exactly as it fails for agents. **This is a PS1 change**, carried to §11.10 |
| T53 | **A repository boundary is earned by a consumer, never by a service boundary: two services are outside because the platform consumes rather than builds them, and everything else — PS2 first among them — lives in the maestro monorepo behind six CI rules, the sixth of which is that a `Repo:` line must resolve** | Owed since v0.6 and cited as **T35** by two service designs that could not know it was never written (PS7 §16.4). **PS2 is the one service that could never earn a repository**: the others have unmet conditions, but PS2's genericity could only be bought by deleting R1, R2, R13 and its event taxonomy — which is making **P12 configurable**, the one thing that must never be. Its §13.5 obligation is discharged by R12's `export` — archive, manifests, and a verifier with no vendor primitive in it (T24) — so **its handover unit is an artifact, not a repository**, and R12 already exercises that path from the first wave. The cost is real and stated: distance was enforcing R11's no-external-write-path, and an import rule is only as strong as the pipeline running it (V4) |
| T52 | **An invocation is never a governance event; PS2 receives instance lifecycle only** | PS2 §1's volume invariant — *"if PS2's volume ever looks like PS7's, something has leaked"* — and PS16 is the estate's most likely leak, because every invocation superficially looks worth recording. Invocations are PS6, effects are PS7. The single exception is an `authority_absent` refusal, which is a fact about the platform's own boundary and is §12.2's sampling population, following PS15's refused-proposal precedent |

---

## 10. Open

- **T-A.** Specification internal representation — conceptual open question **A**, unchanged and still gating real generation. The build order above is arranged so it can stay open through the demo.
- **T-B.** Event log topology: topic-per-tenant, partition-per-tenant, or cluster-per-tier. Bears directly on T6 and on the cost floor per tenant. **Must be answered against MSK's partition ceilings rather than against a single-broker Compose Kafka, which will accept any answer** (§3.2).
- **T-C.** Where the durable archive lives. *Narrowed by T24 — the tamper-evidence mechanism is settled (computed in application code, never a vendor primitive); the location and the retention topology are not.*
- ~~**T-D.**~~ **Closed in v0.8 against the split** (T40): PS4 is a bounded context inside PS3. §4.2's placement, T26's provisional resolution, and `specs-service`'s own gate model all agree. *The T-D/T-M/T-R shape survives it — see T-R.*
- **T-E.** Which Grafana-class stack, and whether the same storage serves internal telemetry and client-facing outcome metrics or they are deliberately separated for tenancy reasons. *Narrowed by T21 — Managed Prometheus and Managed Grafana on the MVP, self-hosted on the PoC; the tenancy separation is the part still open.*
- **T-F.** What the demo use case actually is. The build order is derived from the conceptual design rather than from a specific case, which makes it defensible but not yet validated against a real one.
- **T-G.** Whether PS2 and PS7's event shape share a cluster with separated topologies or run as two clusters. Cost, isolation, and blast radius all pull differently. *Narrowed by T18 — the service boundary is settled, the deployment topology is not. Narrowed again by T34 — the two now have deliberately different topologies (exclusive partition per tenant versus topic per tenant), so what remains is a cost and blast-radius question rather than a design one.*
- **T-I.** How AE3's rule representation relates to conceptual open question **A**. If binding rules and specifications share a representation, A is bigger than it looks; if they do not, the traceability from specification to executed rule needs its own answer.
- **T-J.** Whether PS8 delivery channels are platform-provided or pack-supplied. Notification content for a Wkb deadline is domain knowledge, which §16 says must not live in core. *Widened in v0.7 — PS14's escalation ladder and its response and resolution targets are the same question (W10): how hard and how fast you chase a Wkb deadline is as domain-specific as what the message says. The two should be answered together, and the answer is probably PS11 for both.*
- **T-K.** What identity assurance the external population (PS1) requires — subcontractors and ZZP'ers on External portal have a different onboarding and offboarding path from tenant staff, and it is not obviously the same identity service.

*Opened in v0.4:*

- **T-M.** Whether PS11 is a separate deployable from PS5, or a bounded context inside it — the same question as T-D, one service along. The argument for separation is that a pack's lifecycle (publication, materiality, exit snapshot) has nothing to do with evaluation; the argument against is that nothing else reads a pack.
- **T-N.** Who signs a materiality classification. PS11 gives conceptual open question **G** a *store* and a publication gate; it does not answer the signatory, and §3.3 puts the seat at an O2 ceiling without naming who occupies it at the first client.
- **T-O.** Whether PS13's ledger is a projection of PS2 or its own store. Deployment events are governance events and belong on the spine; SBOMs are bulky, immutable, and referenced rather than queried, which is the T5 shape argument applied to a different payload. *Widened in v1.0: PS16's instance record is the same question about the same fact viewed from a second service (**X-C**), and the two must be answered together — a deployment is one event that PS13 and PS16 both have a claim on, and answering them apart is precisely how W-D's two-stores-one-ledger arrives.*

*Opened in v0.6:*

- **T-P.** **Where transformation lives**, and it decides how big AE6 is. Flink SQL at an ingress boundary is AE6; Flink SQL over a PS7 stream is arguably PS7's streaming access mode. Nothing in the design distinguishes the two cases. *No longer gated by a refactor — with `event-integration-platform` retired there is no inherited transformation layer to place, so this closes with AE6's design rather than ahead of it. Also carried as **H-A** in the PS7 design.*
- **T-Q.** Whether `exchange-service` gets its own design document before it is built, or whether an ADR set is sufficient. AE6 is deferred in §5.2's engine order, which argues for the lighter answer — but AE6 is also the enforcement point for P8's capability grants alongside PS9, which is the argument the other way. **Sharpened by the retirement of `event-integration-platform`:** the lighter answer used to mean *boundary requirements over an inherited codebase*, and there is now no inherited codebase and no requirements document, so AE6 starts from nothing and this question is no longer about how much to write but about whether anything is written before code.

*Opened in v0.7:*

- **T-R.** Whether PS14 and PS12 are one service — the third instance of the same shape as **T-D** (PS3/PS4) and **T-M** (PS5/PS11), and the pattern is now worth naming: *a lifecycle with a single reader looks like a bounded context and argues like a service.* Provisionally separate under T36. PS14 is deliberately built to depend on nothing about PS12's internal shape — only on *some service raises an item* — so consolidating PS12 with its neighbours later costs nothing here. **The part that must not drift is the exception and finding ledger** (§14.5): PS12 owns the finding as a conformance fact, PS14 owns the commitment to clear it, and two stores for one ledger is the live risk (W-D).
- **T-S.** Whether PS14's SLA clock becomes a *binding* calculation under P3 once service credits attach to a breach. If it does, it belongs behind AE3's interface rather than in PS14 — and it would be the first binding calculation the platform performs **on itself**, which is a case §4.4 does not currently contemplate.

*Opened in v1.0:*

- **T-T.** **Which open-source FaaS**, and it is decided by the `job` and `event` modes rather than by `request`, where the candidates are indistinguishable. Knative gives scale-to-zero, a mature eventing model and the closest fit to all four of PS16 §3.3's modes, at the cost of a control plane the Docker PoC does not want; OpenFaaS with faasd on the PoC is dramatically lighter and its eventing is thinner. Both satisfy T21. *Carried as **X-A**.*
- **T-U.** **Whether AE1 adopts the durable execution engine PS15 §11 already adopts.** One engine for the platform's own runs and for a client's long-running workflows is one blast radius and one operational burden; two is T15's cost with different nouns. It decides whether PS16 needs a fifth execution mode or none. *Carried as **X-B**.*
- **T-V.** **Whether PS16's meter is an input to invoicing**, which would make it a financially binding calculation and therefore AE3's under P3. This is **T-S** arriving a second time on a different service, and the pattern is now three deep — the platform performing binding calculations *on itself* is a case §4.4 does not contemplate at all, and if the answer is yes for either the SLA clock or the meter it is yes for both. *Carried as **X-E**.*
- **T-W.** **Whether PS16 is one service or two.** Its record half and its execution half sit on opposite sides of the first-wave line, share almost no machinery, and have different blast radii — an instance registry holds no credentials and a runtime holds cluster reach. This is the fourth instance of *a lifecycle with a single reader looks like a bounded context and argues like a service* (T-D, T-M, T-R), and it is the first where the two halves are separated by *time* rather than by subject. Provisionally one service, because a split would put the instance record and the thing that mutates it in different deployables.

*Opened in v1.1:*

- **T-X.** **Whether `agent-service` gets its own repository despite T53 placing it in the monorepo** (PS15 §1.2). It is the only tree that never leaves (D20), so co-location routes the exit boundary *through* a repository — import rule 5 — rather than *between* two. The rule's answer is *in*; the counter-argument is not architectural but commercial, and this is the one place in T53 where "strictly weaker" may be too weak. **Decide before the first export bundle is built**, not after: an include list assembled around an existing leak is not a fix.

*Closed in v1.1: the repository topology, owed since v0.6 and cited by two service designs as **T35**, which was never it (T53, §3.4). **PS2's placement is settled permanently rather than provisionally** — it is the one service whose split-out condition is impossible rather than merely unmet.*

*Closed in v0.3: **T-H** — PS7 exposes one contract over separable engines, binding on shape and access mode, never on a store (T19).*
*Closed in v0.5: **T-L** — logical isolation between tenants, physical between deployments, enforced by binding rather than filtering, with `tenant_id` stable across both (§3.3, T28–T30).*

---

## 11. Conceptual-design changes this document requires

*New in v0.4, generalising the note §7 has carried since v0.1.*

This document is subordinate: where the two conflict, the conceptual design wins and this one is wrong. Several findings in v0.4 are therefore defects **there**, not here, and amending that document from this one would invert the precedence rule. They are recorded here, to be written there separately and to be visible in the meantime.

**11.1 §9's provided row is incomplete, and one entry is fused.** Six changes:

| Change | Why |
|---|---|
| Split **"telemetry and audit"** into two entries | T12 spends a paragraph separating them and §14.7 makes them substitutions 1 and — effectively — never. One entry covering both is what let v0.1 lose the distinction |
| Add **governance record and decision** | PS2 and PS4 are anchored only in §4.2's prose. §9 is the rule that decides the layer, so a provided service with no row entry means the rule is not being applied to itself |
| Add **domain pack registry** | §5.6 makes the pack the unit of extension and §16 governs it, but nothing places it in a layer. It is provided, never generated, and it transfers at exit under D21 |
| Add **assurance and drift** | §4.8 defines the plane; §5.7 and §5.8 define the work; §9 places neither |
| Add **artifact and release custody** | §4.7's plane, and the home for §10.3's signatures, §13.3's rollback targets and §14.6's instrumentation contract |
| Add **delivery work and obligations** *(new in v0.7)* | §4.7's other half. §10.4's objective and signal artifacts, §13.1's S1–S5, §13.2's resolution times, §14.5's ledger and §14.6's remediation ceilings all name work with no owner (T35) |
| Add **agent execution and the composition plane** *(new in v1.0)* | §4.4 has been a plane since v0.2 and appears in no layer. §9 states the determinism boundary as a *property* — *the agent may propose a rule, never be the rule* — and assigns it to nothing, which is what T14 has to describe as "an enforced interface" without naming the enforcer |
| Add **runtime and instance custody** *(new in v1.0)* | §4.5, the runtime plane, whose entire content in the conceptual design is *"where applications execute. Provides the archetype engines they compose against"* — the second sentence places the engines and the first places nothing. §7.1's instance, §13.3's rollback actuation, §14.6's restore class, §13.4's teardown and T28's deployment dial all land here (T43) |

**11.2 §5.2's Tier 1 list needs a personal-data rule for specifications.** It forbids secrets in a specification and is silent on personal data, while §5.1's sufficiency standards require the business case to record *who is affected* and §7.4 constrains only what may be **published**. The gap forces personal data into the audit substrate (T25). Suggested addition: *personal data in a business case or specification is carried as a classified, erasable reference, never inline in the chain of record.* §5.1 should also state whether "who is affected" is satisfiable by role rather than by name, since it usually is.

**11.3 ✅ Withdrawn in v0.8 — no conceptual change is required after all.** v0.4 asked §4.2 either to permit the gate as a separate service or to have PS4 fold in. **PS4 folds in** (T40), so §4.2 stands unamended and this document is the one that changed. Recorded rather than deleted, because a subordinate document withdrawing its own request for an upstream change is the precedence rule working the way it is supposed to.

**11.4 Supply-chain watch has no conceptual home.** Carried from §7 since v0.1: it should become §5.9 of the conceptual design, with an SBOM Tier 1 standard in §5.2 and an addition to §14.6's instrumentation contract. Still not written.

**11.5 D40's derivation method should be extended to the planes.** D40 makes the archetype walk the method for deriving §9's contents, and it is the right method for what a generated application needs. It is structurally blind to the platform's own obligations, which is how §4.7, §4.8 and §5.6 ended up with no service (T20). The conceptual counterpart of T20 is a companion to D40: *a plane with no service, or an obligation with no owner, is a defect in the derivation — and the platform's obligations are walked separately from the archetypes'.*

**11.6 §4.6 should permit a platform service to be an independently viable product.** *New in v0.6.* §4.6 says platform services are *never generated, identical for every tenant*, and D39 adds that they are onboarded onto themselves. Neither anticipates a platform service with consumers outside maestro — which is now true of `identity-service`, `specs-service`, and `data-service` (T32). Suggested addition: *a platform service may be an independently viable product with consumers outside the platform. This strengthens P9 rather than complicating it: a service with its own users hands over at exit as a product rather than as an extraction, and its exit path is exercised continuously by people who are not the platform.* Without the sentence, three of the platform services are quietly outside §4.6's description of what a platform service is.

**11.7 Four obligations are stated in the conceptual design with no artifact and no owner.** *New in v0.7, and the reason PS14 exists (T35).* Each should gain a named artifact there, in the section that already carries the obligation:

| Where | What is missing |
|---|---|
| **§10.4** | The *objective* trigger produces "a change with no new specification" and the *signal* trigger produces "a cause analysis and proposed fix". Both are named as artifacts and neither is defined anywhere, while intent and policy triggers resolve to artifacts §4.2 already holds |
| **§13.1 and §13.2** | S1–S5 defines routing and §13.2 commits to "response and resolution times by severity" with no record carrying a received-at, a severity, an assignee, or a resolved-at. An availability commitment that cannot be evidenced is the §14.11 failure mode, one plane over |
| **§14.5 and §14.6** | The exception ledger has expiries and owners; the N1 escalation is required to be "a recorded one, since a pattern of them is the argument for N2". Both require a store that counts, and §14.5's own line — *a ledger with no expiries is a way of never fixing anything* — is unenforceable without one |
| **§12.2** | Sampling above O2 and automatic demotion on adverse outcome both require a population of *executed work*, not of decisions. §12.5 puts recording first in the rollout order and nothing records it |

**The stronger form of the derivation rule belongs there too**, as a companion to §11.5's: *an obligation with no owner is a defect even on a plane that already has a service.* §4.7 had PS13 from v0.4 and read as covered for two versions while half of it was unowned.

**11.9 §13.2's availability target is unanswerable against a scale-to-zero application.** *New in v1.0 (T46).* §13.2 commits to *"availability target"* per criticality tier, and §10.5 warns that the Run gate must not degrade into *"is it up?"* — but with serverless execution the question is not merely unhelpful, it has no truth value: an instance at zero replicas is not down, it is idle, and a health probe against it is a cold start. Suggested replacement, in §13.2 rather than here: **availability is expressed as invocation success rate and admission latency at a stated percentile**, and the resources that make a latency commitment achievable are set by consequence class, not negotiated. Two consequences follow that §13.2 should carry: a committed response time on an application with no warm floor is not a commitment, and **the price of a commitment therefore becomes visible at the point it is made** — which is P10 working as designed rather than a concession.

**11.10 §7.1's tenancy model needs a fourth thing, or the third one needs an owner.** *New in v1.0.* Tenant / instance / specification is right, and *instance* is the only one of the three with no service and no artifact — §4.2's chain of record runs opportunity → business case → specification → **application** → conformance record, where *application* is an abstraction and *instance* is the thing that actually runs, is actually certified, and is actually torn down. Two additions: **the instance is a named artifact with a lifecycle** (PS16 §3.1), and **the chain of record should say whether an instance is a link in it or a fact about one** — the same question §11.8 raises for work items, and it should get the same kind of explicit answer rather than being left to look like an omission.

**11.11 PS1's principal model has no place for a running application.** *New in v1.0 (T51).* §12.4 requires *what* acted, at what oversight level, under whose accountability, answerable years later, and T2 makes agents first-class principals precisely so the first of those three is answerable. A **generated application instance writing to the data plane** is neither a human nor an agent, and under the current model it arrives as a service account — the exact shape T2 forbids one plane over. Suggested addition to §7.1 or §9's identity entry: *an application instance is a principal, distinct from the end user on whose behalf it acts and from the infrastructure identity it runs under; a write carries both.* Note that this is the **second** structural addition PS1 is being asked to absorb — `platform-standards.md` V8 proposes a third identity case for delegated government authorisation — and the two should be designed together rather than bolted on in sequence.

**11.8 §4.2's chain of record should say what is not on it.** *New in v0.7.* The chain runs opportunity → business case → specification → application → conformance record, and PS14's work items are deliberately outside it: a work item asserts nothing and needs no acceptance, so P13 does not apply to it (T37). That is a defensible position and it is currently unstated, which leaves it looking like an omission rather than a boundary. One sentence in §4.2 — *facts about obligations are recorded on the spine but are not links in the chain, and do not propose* — closes it.

---

## 12. Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-08-01 | Initial draft. Six platform services identified from §9's generation boundary, with build order and gating criteria. Event log spine with retention, personal-data, and isolation constraints. Internal-versus-client-facing telemetry split. Deferred list with triggers. Supply-chain watch deferred with SBOM emission starting now. Self-onboarding bootstrap (D39). T1–T11 recorded |
| 0.2 | 2026-08-02 | **§4 archetype engines added** — three-layer placement (generated / composed AE / provided PS); the record spine and application event plane separated as two planes on one technology (T12); archetype→engine matrix covering all twelve §8 archetypes; AE1–AE7 defined. **Platform services completed to PS1–PS10** — v0.1 listed six against a five-item row in §9 and lost the data plane; PS7 data plane and history, PS8 notification and escalation, PS9 edge and capability gateway, and PS10 secrets and policy added. **Engine build order** keyed to §17's phases, with AE3 calculation second because it gates every regulated application (T13). Determinism boundary between AE3 and AE5 made an enforced interface (T14). AE2 separated from AE1 (T15); offline tolerance made a PS7 design input (T16); UI/API/MCP triad with P13's propose-only constraint (T17). §5 build order split into services and engines; deferred list and open questions extended (T-G to T-K). Sections 5–10 renumbered to 6–11 |
| 0.3 | 2026-08-02 | **Event hub and data hub consolidated into PS7** (T18). The application event plane moves into the data plane: business events carry personal data and would otherwise reimplement PS7's retention, erasure, and schema evolution, and *event* is already one of §8's four shapes. **PS2 and PS6 stay separate** — PS2 because merging destroys the audit substrate, PS6 because §14.7 makes telemetry the first and most reversible N3 substitution, which establishes that **the substitution catalogue constrains service decomposition, not only sequencing**. §4.2 rewritten as three planes. **PS7's contract binds shape and access mode, never a store or vendor** (T19); streaming and batch become access modes rather than services; connectors stay out of PS7 as a governance function. §5.3 added — PS7 is built shape by shape, driven by archetype order. T12 revised; T18–T19 added; T-G narrowed; **T-H closed** |
| 0.4 | 2026-08-03 | **§3 re-derived by walking §4's planes as well as §9's row** (T20), which recovered three services absent since v0.1: **PS11 pack registry** (§5.6's unit of extension had no owner for versioning, materiality classification, ceiling configuration, or D21's exit snapshot), **PS12 assurance and drift** (§4.8's plane; nothing owned time, so no `effective_from` or `review_due` could fire), and **PS13 artifact and release custody** (§4.7's plane; T10's SBOM commitment and §14.6's rollback-target obligation had nowhere to land). §3.0 added — the §9-row-to-service mapping made auditable, which surfaced that PS2 is half-anchored under a fused entry and **PS4 has no anchor at all and is a departure from §4.2** (T26); T-D provisionally resolved against the split. §3.0.1 added — the `fps4` estate assessed against PS1, PS7 and PS13. **§3.1 added — build-or-adopt and substrate**, answering §1's fourth and fifth questions for every service under one rule: **adopt managed open source, never a proprietary primitive** (T21), because §13.5 hands the platform services over. §14.7's substitution catalogue extended into an AWS-selection criterion (T23); no platform service names its substrate (T22). §3.2 added — three PoC decisions that are cheap on Docker and expensive on Kubernetes plus AWS, chief among them deployment-per-tenant. Tamper-evidence settled as computed in application code (T24), closing half of T-C. **Personal data in specifications split to PS7** (T25), resolving a direct conflict between T5 and §5.1. §2 extended to three unretrofittable constraints; isolation stated once. The conformance record moved off PS2's projection list to PS12. "Demo 1" renamed **first wave** with partials marked, after PS6's v0.3 gate was found to presume a Build phase Phase 0 does not have. PS11 inserted ahead of PS5 in the build order; PS9 and PS10 given gates. Docker-to-Kubernetes recorded as the platform's own first N3 substitution (T27). **§11 added — conceptual-design changes required**, generalising the note §7 has carried since v0.1. T1 revised; T20–T27 added; T-B, T-C, T-D, T-E narrowed; T-L to T-O opened; change-log rows reordered chronologically; §11 renumbered to §12 |
| 0.5 | 2026-08-03 | **T-L closed** (§3.3). Tenant isolation is **logical by default and physical per tenant by choice**, enforced by binding a tenant-scoped handle rather than by filtering, with `tenant_id` stable across both levels and never encoding the deployment (T28). §3.3.1 adds the test for a shared service — **it may be shared only if it holds no tenant runtime data** — which qualifies PS11, the marketplace, and delegated-administration identity and nothing else (T29), generalising §7.2's argument into *shared control plane, isolated data plane*. §3.3.2 maps every service to both levels. **PS1 settled as `identity-service` for authentication plus a maestro-built governance identity layer** (T31), following that service's own ADR-0005 split between identity authority and policy decision point. **No maestro record stores an identity provider's `sub`** (T30) — a subject is minted per deployment, so without a principal-registry indirection the deployment dial is unavailable against immutable multi-year records. §3.2's deployment-per-tenant bullet redirected to §3.3; §3.0.1's `identity-service` row updated to adopted. T28–T31 added; `ps1-identity.md` opened |
| 0.6 | 2026-08-04 | **PS7 given its own service design** (`ps7-data-service.md`) and **realised as `data-service`, a standalone product composable under maestro** (T32) — the `identity-service` and `specs-service` posture, which also decouples PS7's schedule from maestro's because the first wave needs record and series and the event shape arrives with AE6. **`event-integration-platform` splits** into `data-service` (PS7) and `exchange-service` (AE6) with `data-service` started new rather than evolved (T33): §3.0.1 had assigned that repository to PS7 and AE6 at once, which **T19 forbids** — connectors cross a trust boundary and enforce capability grants — so the split is forced rather than chosen, and its own `LIMITATION-0001` shows the Flink runtime and AI assist layer are documented rather than built. Requirements, inventory, and seven-phase sequencing recorded in `eip-refactoring-requirements.md`. **§2 extended from three unretrofittable constraints to four** — data classification at write (§2.4), because data written unclassified is *unclassifiable*, not merely unclassified, which is §2.1's argument on the other plane and is what forces the new-rather-than-in-place refactor. Application event-plane tenancy separated from PS2's model as a topic per tenant with a tenant-chosen partition count (T34), since copying PS2's exclusive-partition model caps every tenant at one partition; T-G narrowed again as a result. §5.3 given a classification-first step. T32–T34 added; **T-P** (where transformation lives — the item blocking phase 3 of the refactor) and **T-Q** (whether `exchange-service` needs its own design document) opened. §11.6 added — §4.6 should permit a platform service to be an independently viable product, which three of them now are. Change-log rows 0.4 and 0.5 restored to chronological order |
| 0.8 | 2026-08-05 | **`specs-service` assessed and adopted as PS3** (T39), following T31's pattern for `identity-service` — and unusually strongly placed, because it was derived from **two** consumers so its generic core is their overlap rather than a single-consumer extraction. *(Qualified at v1.0 by T42: the two consumers are two iterations of one product.)* Its ADR-0001 makes artifact types, gates and lifecycles workspace configuration, satisfying §16 structurally; its record-sink port makes PS2 authoritative and its own store a projection. **T-D closed against the split** (T40): PS4 is a bounded context inside PS3, on §4.2's authoritative placement, T26's provisional resolution, and that service's own gate model — three supports and none against. **T25 narrowed to its purpose** (T41): bodies stay inline and erasure stays redaction-in-place, which already satisfies the goal of keeping GDPR erasure away from PS2's append-only substrate; what is added is a **classification validated at propose**, because §2.4's rule that an unclassified write is *unclassifiable* admits no exception. §3.0.1, §3.1 and the service-design list updated; the two standards documents recorded as subordinate companions; the stale filenames for the PS1 and PS3 designs corrected. Full assessment and six gaps in `ps3-specs-service.md` §1.2–§1.3 |
| 0.7 | 2026-08-04 | **PS14 work and obligation custody added as the fourteenth service** (T35), realised as `work-service`, with its own design in `ps14-work-service.md`. §4.7 had a service from v0.4 and was treated as covered; PS13 took the *artifact* half and the *work* half stayed unowned — **PS8 records that someone was told and nothing recorded that anyone did it.** §10.4's objective and signal artifacts, §13.1's S1–S5, §13.2's resolution times, §14.5's exception ledger, §14.6's remediation ceilings and §12.2's sampling population were all obligations named in prose with no store. T20's rule strengthened accordingly: **an obligation with no owner is a defect even on a plane that already has a service**. **The PS12 boundary is a clock rule** (T36) — a clock belongs to whoever owns the subject it fires on, so PS12 raises a work item and PS14 chases it, rather than PS14 becoming the platform's only scheduler and pulling standards-domain knowledge into a work service. **A work item is neither a proposal nor an acceptance** (T37), on PS2 §6.3's ground that a fact is not a proposal; T17 gains a qualifying clause rather than an unstated exception. **D29 and D30 become mechanical** (T38): authority is checked at claim and refused, and *escalated out* is a first-class outcome so §14.6's pattern-of-escalations argument for N2 is a rate rather than a pile. PS14 recorded as the evidence base §12.2 needs for sampling and automatic demotion, which is why it is first wave rather than deferred with the promotion machinery it feeds. §1, §3, §3.0, §3.1, §3.3.2, §5.1 and §6 updated; T1 revised; T35–T38 added; **T-R** (PS14/PS12 — the third instance of the T-D/T-M shape) and **T-S** (whether the SLA clock becomes a binding calculation under P3) opened; T-J widened to cover the escalation ladder as pack content. §11.7 and §11.8 added — four conceptual obligations with no artifact, and §4.2 should state what is deliberately *not* a link in the chain of record |
| 1.2 | 2026-08-06 | **§3.4 checked against the estate on disk, which contradicted it in three places** — and the check was prompted by an `ls`, not by anything in the documents. `mstr/` holds `docs/` and nothing else, so the tree in §3.4 and **five of its six rules are prospective**; `mstr-data/` and `mstr-work/` exist as empty non-repositories, which makes PS7's and PS14's `Repo:` lines **plans that T53 reverses rather than stale text**, corrected in both and recorded in PS7's log as a correction to what v0.4 first wrote there; and `mstr-specs/` is real, correctly outside, and named differently from the service it holds. **PS3 used three names for one pair across two adjacent header lines** — `mstr-specs`, `../specs-service`, and a `Repo:` field — and only one resolved on disk, in the line whose only job is to say where the thing is. Settled as *`specs-service` is the service, `mstr-specs` is the repository*, with the redundant `Repo:` field dropped. **A sixth CI rule added: every `Repo:` or `Realised as:` line resolves to a directory that exists** — the one claim in these documents checkable in a second, and the only rule of the six that binds today. Applying it by hand found a fourth file: **PS1's line read `mstr-idp = 'identity-service'`**, a repository that does not exist joined by an equals sign to one that does, trying to express in punctuation the split T31 made in v0.5 — and T53 puts the two halves on opposite sides of a repository boundary, so PS1 gets a `Realised as:` naming both and no `Repo:` at all. §3.4 gains the mismatch table and the build order for its own rules; T53's statement updated from five rules to six. PS1 v0.2, PS3 v0.4, PS7 v0.4, PS14 v0.2. No service, order, substrate, dependency, or placement changed — **the topology was right and its claims about the world were not** |
| 1.1 | 2026-08-06 | **§3.4 added — repository topology, owed since v0.6** (T53). `ps7-data-service.md` §1.3 and H19 and `ps15-agent-service.md` §15.2 have all cited **T35** for this, and T35 is *PS14 added as the fourteenth service* — three documents citing a decision their companion never recorded, which is the inversion the precedence rule exists to prevent and which PS7 §16.4 has been reporting for two versions. The rule: **a repository boundary is earned by a consumer, never by a service boundary.** `identity-service` and `specs-service` are outside because the platform consumes rather than builds them; `data-service` and `exchange-service` are inside with the split-out trigger stated as a condition (*a consumer that is not maestro*, unmet for both under T42). **PS2 stays in `services/` and is the one service that could never earn a repository** — the others have unmet conditions, but PS2's genericity could only be bought by deleting R1, R2, R13 and its fifteen-type taxonomy, which is making **P12 configurable**. `specs-service` is generic because ADR-0001 makes gates and lifecycles configuration; the same move here dissolves the invariant that is the product. **Its §13.5 obligation is discharged by an artifact rather than a repository** — R12's `export` yields the archive, the manifests, and a verifier with no vendor primitive in it (T24), built in the first wave rather than at exit, which exercises the exit path more continuously than a repository split would. The cost is stated rather than glossed: R11 keeps `append` off every external surface and *distance* was enforcing that, so the boundary becomes an import rule that is only as strong as the pipeline running it — and `platform-standards.md` **V4** already finds six invariants whose stated enforcement is a CI that does not exist. **Five import rules** named, including the two neither service design had: `packages/chain-verifier` importing nothing from `services/` or `products/` (T24, P9), and the export bundle built from an **include** list so D20's boundary is not an exclude list nobody re-reads. PS16's placement settled by the same rule; **`agent-service` placed by it and not settled by it** — the counter-argument there is commercial rather than architectural (**T-X**) |
| 1.0 | 2026-08-06 | **PS16 runtime and instance custody added as the sixteenth service** (T43), realised as `runtime-service`, with its own design in `ps16-runtime-service.md`. **§4.5 — the runtime plane — had no service in any version of this document**, and §3.0's audit table could not surface it because that table is organised by §9's row: a plane §9 never mentions has no left-hand column to be missing from. That is a third variant of one failure — T20 catches a plane with no service, T35 an obligation with no owner on a covered plane, and **T43 a plane the audit instrument itself cannot see** — and §3.0 is annotated as a record of the derivation rather than a check on it. Five obligations were unowned: §7.1's *instance*, one of three tenancy levels since v0.3; §13.3's automated rollback, which had a target in PS13 and no actuator; §14.6's restore class, *"the bulk of real remediation"*; §13.4's decommission; and T28's L1→L2 dial, defined as *"a deployment change"* with no owner. **Execution is serverless** — functions on a per-tenant shared open-source FaaS runtime (T44) — argued from §9's own logic rather than from economy: four Tier 1 invariants become physical properties of the substrate instead of disciplines, since state has nowhere but PS7, a no-egress sandbox makes PS9 the only route out, credentials are invocation-scoped, and the tenant handle binds per invocation. The contract names an **execution mode and a resource class**, never a runtime or a container (T44), with `job` in the mode set because AE2's solver does not fit request-response. **Co-tenancy rule** (T45): shared within a tenant, never across, with intra-tenant separation as a consequence-class dial. **Warm floor from consequence class and availability redefined** as invocation success rate and admission latency (T46) — a scaled-to-zero instance is not down, which makes §13.2's target unanswerable as written (§11.9). **Managed and observed instances are distinct kinds** (T47), which gives PS16 a first wave containing no execution at all: the observed half discharges §14.6's instrumentation contract in Phase 0 and supplies the fact PS12's re-derivation clock and PS13's ledger both read. **Idempotency at the trigger** (T50), because at-least-once delivery breaks P3 at the *effect* rather than at the calculation. **A workload principal is required in PS1** (T51) — an application instance is neither human nor agent and would otherwise arrive as the service account T2 forbids; carried to §11.11. Invocations excluded from PS2 (T52); the platform's own services excluded from PS16 (T48); hosting excluded from §14.7's ladder (T49). **PS15 entered into §3's table**, omitted since v0.7. §3.1 rules out Lambda and Fargate; §3.2's deployment-per-tenant bullet closed on the compute half; §3.3.2, §5.1, §5.2's gate table and §6 updated. T43–T52 added; **T-O widened** to cover PS16's instance record; **T-T to T-W opened**. §11.9, §11.10 and §11.11 added |
| 0.9 | 2026-08-05 | **Renamed throughout to `maestro`** on conceptual D44 — the platform's name, its category (*governed application platform*), and the retirement of the `adel` codename. Mechanical across the document set: the `adel-` filename prefix dropped, every cross-reference updated, and the identifiers renamed — **no maestro record stores an identity provider's `sub`** (T30) and **the maestro workspace definition** (T39). **T42 added, and it is the only non-mechanical consequence:** the rename costs T39 part of its force, because `specs-service`'s "two consumers" are now two iterations of one product rather than two products. The generalisation argument survives on conceptual §1.5 — the two models differ in subject, accountable human, gate set, terminal artifact, standards tiers, reach, and buyer, and an overlap across that gap is a real generic core — but the stronger claim that an unrelated consumer validated the shape is gone. **PS7 §1.3's split-out trigger is therefore *not* satisfied by v1 and stays open**, and the first outside consumer remains the event that proves the core generic rather than argued so. §3.0.1's `specs-service` row, §5.2's PS4 fold argument, and the v0.8 change-log row qualified accordingly. No service, order, substrate, or dependency changed |
