# PS16 — Runtime and Instance Custody — Service Design

**Status:** Draft v0.1 — for refinement
**Companions:** `conceptual-design.md` (v1.0) is authoritative for *what* and *why*; `technical-design.md` (v1.0) for the service set, build order, and substrate; `ps13` *(no document yet)* holds the artifact this service runs; `ps7-data-service.md` (v0.3) holds every byte an application keeps; `ps1-identity-service.md` (v0.1) holds the principal it runs as; `ps14-work-service.md` (v0.1) holds the commitment a deployment discharges. Precedence runs in that order and this document is wrong where it conflicts.
**Realised as:** `services/runtime-service` — one deployable in the maestro monorepo, not its own repository (**T53**). It has one consumer, which is the test; the FaaS runtime underneath it is adopted and is not ours to host anywhere.
**Scope:** The **instance** — its identity, its environment, its resource envelope, the authority the platform holds over it, and, where the platform hosts it, its execution. **Not the decision to release** (PS3/PS4), **not the artifact** (PS13), **not the data** (PS7), **not the inbound edge or the capability grant** (PS9), **not the credential** (PS10), **not the commitment to deploy** (PS14), and **no domain knowledge whatsoever** (§16).
**Why this one:** **§4.5 — the runtime plane — is the only one of the eight planes with no service at all**, and §3.0 of the technical design never listed it as a miss. Five obligations land in the hole: §7.1 makes *instance* one of three tenancy levels and nothing holds one; §13.3's automated rollback has a target in PS13 and no actuator; §14.6's restore class — restart, failover, re-run, scale, roll back — is *"the bulk of real remediation"* and nothing performs it; §13.4's decommission revokes and tears down and nothing does either; and T28's L1→L2 dial is defined as *"a deployment change"* that nobody owns. This is a third *variant* of one failure, not a third instance of one: T20 catches a plane with no service, T35 an obligation with no owner on a plane that already has one, and **T43 a plane the audit instrument itself cannot see** — §3.0's mapping table is organised by §9's row, so a plane §9 never mentions has no left-hand column to be missing from.

---

## 1. What PS16 is, in one paragraph

PS16 holds the **instance**: the binding of one specification version to one environment inside one tenant, with a resource envelope, a declared authority, and a stated hosting party. For instances the platform hosts it also *runs* them — serverless by default, as functions on a per-tenant shared open-source FaaS runtime, admitted through a mediated invocation that binds identity, isolation, and idempotency before any application code executes. For instances the platform does not host — every onboarded application at N0–N2 — it holds the record and nothing else, which is P14 made structural rather than promised. **PS16 decides nothing, accepts nothing, and grants nothing.** It applies decisions PS3/PS4 have already made, to artifacts PS13 already holds, under authority PS14 has already checked, and records that it did.

### 1.1 What PS16 is not

| Not | Owner | Why the confusion arises |
|---|---|---|
| The decision to release | **PS3/PS4** | P13. A promotion between environments is a *gate outcome applied*, never a gate. The moment PS16 can promote on its own there are two gates and P13 is a convention |
| Artifact identity, SBOM, signature, **rollback target** | **PS13** | Custody versus actuation — the §4.7 split a third time. **PS13 says what the known-good version is; PS16 makes reality match it.** Two stores for one deployment fact is W-D, and the live risk here (**X-C**) |
| The commitment to deploy, its deadline, its escalation | **PS14** | PS14 holds *that an act is owed* and refuses it at claim if authority is absent; PS16 performs it. A deployment with no work item is legitimate; a work item PS16 satisfies without PS14 knowing is not |
| Inbound exposure, capability ceilings, revocation | **PS9** | D41 puts enforcement below the generated layer. PS16 schedules the workload; PS9 fronts it. An ingress the deployer configures is enforcement-as-configuration |
| Credential custody | **PS10** | PS16 requests and injects; it never stores. §4 is the whole of the difference |
| Any application state | **PS7** | Under §3 a function retains nothing between invocations, so this is a physical property here rather than a discipline. That is most of the argument for serverless (§2.2) |
| The workflow inside an application | **AE1** | AE1 is a client's business process, durably orchestrated. PS16 is the execution surface AE1 runs *on*. T15's line, one layer down |
| Scheduling resources under constraints | **AE2** | Placing a function on a node is bin-packing the runtime does. Allocating a crew to a bouwplaats is constraint satisfaction and is a client's problem (T15, W2) |
| Hosting the platform's own services | — | **X6.** D39 onboards the platform at N2, which is change control, not hosting. PS16 running PS16 is a bootstrap loop nobody needs |
| A PaaS | — | The refusal is the product, exactly as PS14 §13 has it. Everything in §2 is derived from an obligation; *"a platform should also offer…"* is not an obligation |

---

## 2. The obligations it discharges

*Derived the way §3.0 of the technical design derives the service set: walked from the source. **A row with no source is not admissible.***

| Obligation | Source | What PS16 holds |
|---|---|---|
| **Instance** as one of three tenancy levels — the boundary for deployment, environment, configuration, runtime data | **§7.1** | The instance record. The concept has existed since v0.3 with no store |
| Environments and promotion | **§4.7** | Environment as a field on the instance; promotion as a transition between instances of one specification lineage, applying a PS4 decision |
| Automated rollback on defined failure signatures | **§13.3** | The actuator. PS13 holds the target and whether it has been exercised |
| Restore-class remediation — restart, failover, re-run, scale, roll back — *"the bulk of real remediation"* | **§14.6** | The act, with D29's authority ceiling checked at the act as well as at PS14's claim (§5) |
| Decommission: teardown, revocation of grants and credentials, notification of dependents | **§13.4** | The teardown, and the rule that the evidence outlives it (§2 of the technical design) |
| The instrumentation contract's *"identity and version of every deployed artifact, and an event when it changes"* | **§14.6** | The observed-instance half (§3.2) — the only part of PS16 that is first wave |
| L1→L2 as *"a deployment change"* | **T28** | The migration. T28 states the dial and T30 makes it survivable; nothing turned it |
| Tenant isolation enforced **below** the generated layer, by binding rather than filtering | **T6, T28** | The handle bound at admission from the instance record, never from anything function code can read or set (§4.3) |
| Ungranted capability is unavailable; enforcement below the generated layer | **P8, D41** | Egress denied by default at the sandbox, so PS9 is the only route out (X3). Under FaaS this is a network policy rather than a code review |
| Binding calculations deterministic and traceable | **P3, T14** | Nothing directly — but **at-least-once delivery makes a deterministic calculation produce a duplicated effect**, which §4.4 is entirely about |
| Availability targets and response times per criticality tier | **§13.2** | The warm floor resolved from consequence class (§4.5), and the redefinition of availability that scale-to-zero forces (X5) |
| Cost attribution for *"not earning its keep"* | **§6, §10.5** | Metered invocation, giving the portfolio a denominator it has never had (§8) |
| Applications hand over as repositories that run | **§13.5, P9** | The invocation contract as open, documented ABI — otherwise the client is handed functions only maestro can call (§9) |
| Authority is declared, never assumed | **P14** | `hosted_by` and `operated_by` as separate fields, and no actuation on an instance the platform does not host (§3.2) |

### 2.1 Tested and excluded

| Candidate | Rejected to | Argument |
|---|---|---|
| The deployment event on the spine | **PS13** | It is already in PS2's §3.3 taxonomy as `ArtifactDeployed` and already PS13's under T-O. PS16 raises instance-lifecycle events; the artifact event stays where it is |
| Deploying the platform's own services | `core-services`, then CI | X6. Also §3.2 of the technical design — that repository *is* the PoC substrate and is not displaced |
| Durable orchestration of long workflows | **AE1**, engine shared with PS15 | PS15 §11 already adopts a durable execution engine. A second one is T15's failure with different nouns; PS16 supplies the execution surface, not the orchestrator (**X-B**) |
| A build pipeline | CI, then the composition plane | PS16 runs an artifact PS13 holds. What produced it is not its concern, and a runtime that builds is a runtime that can deploy something no gate saw |
| Per-application dashboards | **PS6** + the generated dashboard | D38. PS16 emits; it renders nothing |
| Autoscaling policy as a client-facing knob | Consequence class | X5. A resource envelope selected by the Owner is a cost decision wearing a governance label; P10 already has the dial |
| Hosting an onboarded application at N1 "because we could" | Nobody | §14.2. N1 is *operated*, not *hosted*. Moving where an application runs is a migration, not a rung (X7) |

### 2.2 Why serverless is the right answer here specifically

Recorded because *"use serverless"* is a fashion in most designs and an argument in this one. **Four Tier 1 invariants stop being disciplines and become physical properties of the substrate**, which is the same reason §9 puts identity, isolation, and capability enforcement below the generated layer in the first place:

| Invariant | Under a long-running container | Under a function |
|---|---|---|
| All application state is in PS7 (T19) | A convention. A local cache, a temp file, or an in-process session breaks it invisibly | **Structural.** There is nowhere to put it |
| Outbound capability routes through PS9 (D41, P8) | Reviewable, not enforceable — any process can open a socket | **A network policy on a sandbox with no general egress** |
| No long-lived credential in application code (PS10) | Injected at start and resident for the process lifetime | **Invocation-scoped and expires with the call** |
| The tenant handle is bound, never filtered (T28) | Bound once at boot, then trusted for every request | **Bound per invocation from the instance record** |

**And one commercial property, which is §3.2's unfinished business.** Deployment-per-tenant was named as the PoC decision most expensive to unpick, because a namespace plus an RDS instance plus MSK capacity is a cost floor *"the twelve-person aannemer cannot carry."* §3.3 answered the data half with logical isolation. The compute half was never answered, and scale-to-zero is the answer: a tenant with four low-consequence applications and eleven users pays for invocations, not for eleven idle processes.

**What it does not solve, stated here rather than discovered.** Cold-start latency is real and lands on External portal and Field capture, which are the two archetypes with the least patient users; the job mode (§3.3) exists because AE2's solver and AE6's stream consumers do not fit request-response at all; incident response on ephemeral, scaled-to-zero workloads is materially harder, which promotes PS6's tracing from useful to load-bearing against §13.2's resolution times; and a FaaS control plane is itself infrastructure to operate, which is a real cost set against the one just saved.

---

## 3. The instance

### 3.1 The record

Modelled the way §5.5 models a standard and PS2 §3.1 models an event: **the object is the specification.**

```yaml
instance:
  instance_id:        ins-wkb-dossier-prod
  tenant_id:          tnt-aannemer-x
  application_id:     app-wkb-dossier

  # what it realises
  specification:      spec-wkb-dossier@14        # the accepted version, pinned
  spec_class:         generative                 # or descriptive (D27)
  artifact:           ps13://art-wkb-dossier@14  # what PS13 holds; PS16 never resolves a tag
  environment:        production                 # dev | test | acceptance | production

  # authority — P14, and the two fields are never merged
  hosted_by:          platform                   # platform | tenant | third_party
  operated_by:        platform                   # platform | incumbent | tenant
  onboarding_level:   n/a                        # N0–N4 where the application is onboarded
  authority:          [deploy, restart, scale, rollback, decommission]

  # the envelope — resolved, never authored (§4.5)
  consequence_class:  c3
  resource_class:     standard                   # names an envelope, never a size
  warm_floor:         1                          # resolved from consequence_class
  isolation_level:    L1                         # T28's dial, and this is where it is turned

  # lifecycle
  state:              running                    # provisioned | running | suspended | retired
  released_by:        dec-8841                   # the PS4 decision this instance applies
  provisioned_at:     2026-08-06T08:12:04Z
  rollback_target:    ps13://art-wkb-dossier@13  # PS13's, copied on, never computed here
```

**Five rules, enforced at write rather than documented:**

1. **`specification` is a version, never a lineage.** An instance realises exactly one accepted version. "Latest" is how a deployment happens that no gate saw.
2. **`released_by` must resolve to a PS4 decision whose outcome is `accepted` and whose subject is this specification version.** An instance with no decision behind it is a rejected write, not a warning. This is the single place P13 could leak into the runtime, and it is closed the way PS2 §3.1 closes attribution.
3. **`hosted_by` and `operated_by` are separate and neither defaults.** Every onboarded application below N3 is `hosted_by: tenant`, and §3.2 makes that a different kind of record rather than the same record with a flag.
4. **`resource_class` and `warm_floor` are resolved from `consequence_class`, never authored** (§4.5). A specification that could name a memory limit has named its substrate (T22).
5. **`artifact` is a digest-pinned reference into PS13.** PS16 never resolves a mutable tag, which is the deployment counterpart of PS2 §3.1's `payload_digest`.

### 3.2 Two kinds of instance, and only one of them executes

The distinction carries P14 and is the reason PS16 has a first wave at all.

| | **Managed instance** | **Observed instance** |
|---|---|---|
| Realises | A generative specification the platform composed | A descriptive specification derived from code the platform did not write (§14.4) |
| `hosted_by` | `platform` | `tenant` or `third_party` |
| PS16 does | Provisions, invokes, scales, rolls back, tears down | **Records.** Nothing else |
| Deployment source | A PS4 decision | An **observed** deployment reported by the instrumentation contract (§14.6) |
| Arrives | Phase 1, with the composition plane | **Phase 0**, with N0–N1 onboarding (§17) |
| Tier 1 | Blocking | Findings, not blocks — D28 binds what the platform builds and operates |

**The observed instance is the whole of PS16's first wave, and it is not optional.** §14.6's instrumentation contract requires *identity and version of every deployed artifact, and an event when it changes*, and §14.4 requires a descriptive specification to be **re-derived on every observed deployment** and treated as *expired* rather than stale when it cannot be verified. PS12 owns the expiry clock and PS13 owns the artifact — and the thing that says *this tenant is running that version, there, right now* had no home. That is the fact both of them read.

**Observed instances are also where §14.11's rot risk becomes measurable.** *Descriptive specification age since last observed deployment* is a number, and it is the leading indicator that a conformance claim is degrading.

### 3.3 Execution modes

The T19 shape, one layer up. **A specification names a mode and a resource class; it never names a runtime, a container, an orchestrator, or a node.**

| Mode | Shape | Scale to zero | Serves |
|---|---|---|---|
| **request** | Synchronous request/response, bounded by an admission timeout | Yes, subject to the warm floor | Registry, Insight, External portal, Conversational surface, Field capture |
| **event** | Triggered by a PS7 stream or a queue; **at-least-once** | Yes | Monitoring and alerting, Integration and exchange, Document understanding |
| **scheduled** | Fired on an interval or a calendar | Yes | Re-derivation, batch exchange, periodic recomputation |
| **job** | Bounded long-running, higher memory, no request attached | To zero between runs | **AE2's solver**, document batch generation, regeneration, export |

**`job` exists because the archetype walk says it must.** Walk §8 the way D40 requires: eleven archetypes are request- or event-shaped and one is not. Scheduling and allocation is constraint satisfaction over resources and time (T15) — minutes of CPU and gigabytes of working set, against a FaaS timeout measured in seconds. A design that ships only request and event modes discovers AE2 under load, which is exactly the failure T34 describes on the other plane.

**Durable orchestration is not a mode.** A workflow that waits three days for a human approval is AE1, running *on* these modes and holding its state in PS7. PS15 §11 already adopts a durable execution engine for the platform's own runs; whether AE1 adopts the same one is **X-B** and is not decided here.

### 3.4 Instance lifecycle events

Added to PS2's §3.3 taxonomy. **Four types, and the count matters** — PS2 §3.3 warns that the sixteenth type is how a log becomes a message bus, and a runtime service is the single most likely source of that pressure.

| Type | Raised when |
|---|---|
| `InstanceProvisioned` | An accepted specification version is bound to an environment |
| `InstancePromoted` | An instance in one environment supersedes one in another, applying a PS4 decision |
| `InstanceStateChanged` | running ⇄ suspended, or a rollback executes — carrying the acting principal and the authority under which it acted |
| `InstanceRetired` | Teardown completes, with the revocation and export receipts (§7) |

**An invocation is never one of these** (X4). §5 is the rule; this is the taxonomy that would otherwise carry it.

---

## 4. Admission — the only interesting part of the execution path

Everything below happens **before any application code runs**, and it is PS15 §6's mediator pattern applied to a different subject: the point where an untrusted thing becomes a bounded thing, deterministically, in one place.

```
invocation
  → 1. resolve instance        (state running? artifact digest matches PS13?)
  → 2. mint workload principal (PS1, invocation-scoped)
  → 3. bind tenant handle      (from the instance record — never from the payload)
  → 4. idempotency key         (present, or the invocation is refused)
  → 5. inject credentials      (PS10, invocation-scoped, expiring)
  → 6. admit                   — or refuse, and record the refusal
```

### 4.1 The workload principal, which PS1 does not have

**This is the largest genuine gap the serverless model surfaces, and it is not caused by it.** T2 makes agents first-class principals distinct from the humans accountable for their seats and from service accounts. PS1 models **human** and **agent** populations, internal and external. A *generated application instance writing to PS7* is neither, and today it would arrive as a service account — which is precisely the modelling error T2 exists to forbid, one plane over.

An application invocation has **two** principals and they answer different questions:

- the **workload principal** — *which instance of which specification version, in which tenant, did this?* Minted per invocation, scoped to the instance, never long-lived, never reused across environments.
- the **end-user principal** — *on whose behalf?* Arrives from PS9 in the request, from either identity population (§8's actor topology).

Both are required on any PS7 write and on any AE3 call. Collapsing them means an audit trail that can say a record changed and not which running thing changed it, which fails §12.4 for applications the same way a shared service account fails it for agents. **This is a PS1 change, not a PS16 one**, and it is carried to the technical design's §11 rather than decided here.

### 4.2 Refusal is an outcome, never a warning

PS14 §T38's rule, applied to the act rather than to the claim. **A refusal is recorded with its reason and is queryable as a rate.** Six refusal classes:

`no_such_instance` · `instance_not_running` · `artifact_digest_mismatch` · `authority_absent` · `no_idempotency_key` · `jurisdiction_refused`

**`authority_absent` is D29 enforced twice, deliberately.** PS14 refuses a `patch`-class item at claim on an N1 application. PS16 refuses the *act* on an instance whose `authority` list does not carry it — because a restart triggered by an alert, an operator, or a remediation agent may reach the runtime without ever passing a work item. Two checks for one rule is not redundancy here; it is the difference between a rule that binds one entry path and a rule that binds the act.

**`artifact_digest_mismatch` is what makes PS13's ledger load-bearing rather than decorative.** A running instance whose bytes are not the bytes PS13 recorded is either a deployment nobody gated or a compromise, and both are hard stops.

### 4.3 Isolation, and the rule about sharing

**A runtime process may be shared across applications *within* one tenant. It may never be shared across tenants** (X2).

This is T6 read exactly. A shared cross-tenant FaaS runtime makes Tier 1 isolation a property of the language sandbox — which is L0 wearing a container's clothes, one bug from a Tier 1 violation, and precisely the filtering §3.3 forbids. Per tenant it is a clean L1: the tenant boundary *is* the process boundary, and every handle inside it is already tenant-scoped by binding.

| Level | Compute topology | Matches |
|---|---|---|
| **L1 — logical** | One FaaS namespace per tenant; functions from many of that tenant's applications co-resident; per-tenant service account and network policy | §3.3's default |
| **L2 — physical** | Own cluster or own node pool | The commercial and regulatory dial |
| **Between applications, within a tenant** | Shared by default; **separable on consequence class** — a `c4` application gets its own namespace inside its tenant's boundary | P10's dial, one level finer than §3.3 has it |

The third row is new and is the only place PS16 extends T28 rather than applying it. No Tier 1 standard requires isolation *between a tenant's own applications*; consequence class should be able to require it anyway, for the same reason §12.5 exposes the oversight level as a client-facing dial.

### 4.4 Exactly-once effect, because at-least-once is the default

**P3 survives per invocation and dies per effect, and this is the sharpest thing serverless changes.**

A binding calculation is deterministic, versioned, and traceable (P3, `PLAT-DET-001`). Under at-least-once delivery it is also executed twice on a retry — and a CAO hour calculation that posts twice is not a determinism failure, it is a wrong number in a regulated record. Long-running containers hide this behind in-process deduplication that nobody wrote down.

The rule: **every invocation carries an idempotency key, and it is refused without one.** The key derives from the triggering fact — the PS7 event id, the request id minted at PS9, the scheduled occurrence — never from a clock or a random value inside the function. Effects at the PS7 write boundary and at the AE3 call boundary are keyed by it. Retries then converge; they do not accumulate.

**The key is a property of the trigger, not of the runtime**, which is what keeps it verifiable after a substrate change (T22).

### 4.5 The envelope is resolved from consequence class

| Consequence class | Warm floor | Admission target | Separable namespace |
|---|---|---|---|
| c1 — internal, low | 0 — cold start accepted | best effort | no |
| c2 | 0 | seconds | no |
| c3 — regulated output | 1 | sub-second | on request |
| c4 — binding, external filing | ≥1, multi-zone | sub-second, committed | **yes** |

**Two things follow, and both are P10 rather than engineering.** The warm floor is where §13.2's availability target stops being a sentence and becomes a line item — a committed response time on a scale-to-zero application is not a commitment. And the low-consequence case genuinely costs nothing when idle, which is what makes the small end of the market servable at all (§2.2).

**Availability must be redefined for this to be measurable** (X5). A scaled-to-zero instance is not down, and *uptime* is unanswerable against it. §13.2 needs **invocation success rate** and **admission latency at a percentile**, per criticality tier. This is a conceptual-design change and is carried as such; PS6 measures whichever definition wins, but it cannot measure one that does not exist.

---

## 5. What PS16 must never see

**Invocations are not governance events** (X4). PS2 §1 states its own volume invariant — *"if PS2's volume ever looks like PS7's, something has leaked across the boundary in §4.2, and the fix is upstream"* — and PS16 is the most likely leak in the estate, because every invocation superficially looks like something worth recording.

| Fact | Where it goes |
|---|---|
| An instance was provisioned, promoted, suspended, rolled back, retired | **PS2**, via §3.4 |
| A function was invoked; it took 40ms; it succeeded | **PS6** |
| A refusal at admission | **PS6** for the rate; **PS2** only when the refusal class is `authority_absent`, because that one is a governance fact about the platform's own boundary |
| What the invocation changed | **PS7**, classified, by the application |
| The invocation's cost | **PS6** as a series; aggregated to the portfolio (§8) |

The middle row is the only judgement call, and it goes this way because §12.2 needs a population of *refusals* to sample against and PS15 sets the precedent — refused proposals are its contribution to the demotion evidence base.

---

## 6. Interfaces

Per T17: UI, API, MCP — under P13's constraint, which here has an unusually sharp form.

| Operation | Surface | Notes |
|---|---|---|
| `provision(instance)` | API | Requires a `released_by` PS4 decision. Refused without one |
| `promote(instance, environment)` | API, UI | Applies a decision; never makes one |
| `invoke(instance, payload)` | Internal only | Reached through PS9, never directly. Not on MCP at any level |
| `restart · scale · rollback · suspend` | API, UI, MCP | Each checks `authority` and records the act. MCP so the Operations seat works through the interface an Auditor reads (T9's argument) |
| `retire(instance)` | API, UI | §7 |
| `observe(deployment)` | API | The instrumentation-contract intake for observed instances (§3.2) |
| `query(instances, …)` | API, MCP | The portfolio's runtime half |

**`invoke` is never exposed on MCP.** An agent that can invoke a client's application directly has routed around PS9, which holds the capability grant, and around the end-user principal, which carries the *on whose behalf*. PS2 §9 makes the same exclusion for `append` and for the same reason.

---

## 7. Decommission

§13.4 lists five obligations and PS16 discharges four of them. It is worth writing out because *"and then we delete it"* is where an exit promise usually dies.

1. **Teardown** — functions removed, namespace deleted, warm floor released.
2. **Revocation** — capability grants revoked through PS9, credentials through PS10, workload principal retired in PS1. Revocation receipts are part of `InstanceRetired`.
3. **Data** — PS7's, not PS16's. **PS16 refuses to retire an instance whose data export has not completed**, because a torn-down instance with orphaned classified payloads is the §2 rule violated: no component may assume its own storage is the durable record.
4. **Notification of dependents** — PS8, from the instance graph PS16 holds. This is the one place PS16 knows something nobody else does: which other instances call this one.
5. **The final conformance record** — PS12's, closing the chain that started with the business case.

**The instance record itself is retained, not deleted.** A retired instance is evidence of what ran, when, under whose authority. Its retention outlives it (§13.4), which is why the record is a PS2 projection rather than a PS16 store (**X-C**).

---

## 8. Cost, and the thing it unlocks

Metered invocation gives §6 a denominator it has never had. *"Not earning its keep"* is defined in §10.5 as a reading of the outcome series against a target — and it has always been a numerator with no divisor. **Cost per outcome is computable when compute is metered per invocation and attributed per instance**, and it is not computable when a tenant's applications share an always-on process.

This also lands on conceptual open question **N** — that operational liability does not scale with what a subscription meters. It does not close it: a metered runtime prices *consumption*, and N is about the unpriced liability in §13.2's commitments and S1–S5 support, which scale with the number and criticality of running applications. What PS16 supplies is the measurement — governed capacity as *instances at criticality tier*, which is the dimension N asks for and nothing produced.

---

## 9. Substrate

| | PoC (Docker) | MVP (K8s + AWS) | Handover |
|---|---|---|---|
| FaaS runtime | OpenFaaS / faasd, single node | **Knative or OpenFaaS on EKS** — **X-A** | Open-code, OCI artifacts |
| Function artifact | OCI image, from PS13 | Same | OCI is portable |
| Job mode | Compose one-shot | Kubernetes Job | Open-code |
| Egress control | Docker network + proxy | NetworkPolicy, egress only to PS9 | Open-code |
| Per-tenant boundary | Compose project | Namespace + service account | Open-code |
| Metering | Invocation records to PS6 | Same | Ours |

**Lambda is ruled out** under T21, alongside the six services already named in §3.1: it is a proprietary primitive with no open equivalent, and adopting it converts P9 from a guarantee into an aspiration for the one service that decides where a client's application runs. Every open FaaS above is a Kubernetes or containerd workload, so §3.1's rule holds by construction.

**The name follows T22 and T32.** Not `compute-service` (names the resource), not `faas-service` or `container-service` (names the substrate), not `deployment-service` (names the act, of which there are four). It is a **runtime** service because *instance* is what it holds and *execution* is what it does with the half of them the platform hosts.

**The invocation contract is part of the handover** (§13.5, P9). A function that only maestro can call is not a repository the client can run, whatever the licence says. The ABI — the invocation envelope, the two principals, the idempotency key, the handle-binding contract — is documented open and versioned, and the exit bundle includes the FaaS deployment alongside the functions. The IP that does not transfer is PS15's constructs (D20), and nothing here is that.

---

## 10. Build order and gates

| # | Step | Gate |
|---|---|---|
| 1 | **Instance record; observed instances only** | An observed deployment updates the instance's artifact version, PS12 re-derives against it, and *age since last observed deployment* is queryable per application. **No execution anywhere in this step** |
| 2 | Managed instance, request mode, admission chain | A function runs; a second tenant's function cannot resolve the first's handle by any payload; an invocation without an idempotency key is refused and the refusal is recorded |
| 3 | Egress denial, workload principal, PS10 injection | A function's direct outbound call fails at the sandbox; a PS7 write carries both principals; no credential outlives its invocation |
| 4 | Rollback, restart, suspend, with authority checks | A `patch`-class act on an N1 instance is refused at the act, not only at PS14's claim; a rollback to PS13's target executes and is recorded |
| 5 | Event, scheduled, and job modes | An AE2-shaped job runs past the request timeout and to completion; an at-least-once event redelivery produces exactly one effect |
| 6 | Warm floor by consequence class; metering; retire | A `c4` instance holds its floor; cost per instance is queryable; a retire is refused while a data export is incomplete |

**Step 1 is first wave and steps 2–6 are not.** This is the §4.7 two-halves lesson applied prospectively rather than in hindsight: the record half discharges a Phase 0 obligation (§14.6's instrumentation contract, at N0–N1) and the execution half waits for something to execute (Phase 1, with the composition plane). Building step 1 without the rest is not a stub — it is the whole of what onboarding needs.

---

## 11. Failure modes

| Failure | Detection | Response |
|---|---|---|
| Cold start breaches an admission target | Admission latency percentile per instance | Raise the warm floor — which is a *cost* decision at a *consequence* class, so it goes to the Owner, not to an operator |
| Retry storm on a poison payload | Redelivery count per idempotency key | Park to a dead-letter shape in PS7; the effect stays exactly-once by construction |
| Artifact digest mismatch on a running instance | Continuous reconciliation against PS13 | Hard stop for that instance. Never repaired in place — PS2 §12's rule for a duplicate sequence, applied here |
| Drift between the instance record and reality | Reconciliation loop; observed state versus recorded state | The record is not authoritative about reality, only about intent. Divergence is an incident, and a *silent* divergence is a Tier 1 finding |
| A tenant's namespace exhausts its quota | Per-tenant resource accounting | Refuse admission for that tenant with a distinct class. **Never spill into another tenant's capacity** — that is isolation failing as availability |
| Observed instance stops reporting | Age since last observation versus threshold | The descriptive specification **expires** (§14.4), which is PS12's act. PS16 supplies the clock input, not the verdict |

---

## 12. Decisions

| # | Decision | Rationale |
|---|---|---|
| **X1** | **PS16 holds the instance and, for platform-hosted instances only, executes it. Execution is serverless by default: functions on a per-tenant shared open-source FaaS runtime** | §4.5 is the only plane with no service and §7.1's instance had no owner. Serverless because four Tier 1 invariants become physical properties of the substrate rather than disciplines (§2.2), and because scale-to-zero answers the compute half of §3.2's cost floor, which §3.3 answered only for data |
| **X2** | **A runtime process is shared across applications within a tenant and never across tenants; separation between a tenant's own applications is available on consequence class** | T6 read exactly. Cross-tenant sharing makes Tier 1 isolation a property of a language sandbox, which is L0 in a container's clothes. The intra-tenant dial is P10, and no Tier 1 standard demands it — which is why it is offered rather than imposed |
| **X3** | **A function has no general network egress; all outbound capability routes through PS9** | D41 puts enforcement below the generated layer, and under FaaS this is a network policy on a small sandbox instead of a code review of a long-running process. It is the cheapest place in the whole design to make P8 true |
| **X4** | **An invocation is never a governance event. PS2 receives instance lifecycle only** | PS2 §1's volume invariant, and PS16 is the estate's most likely leak. Invocations are PS6; effects are PS7. The one exception is an `authority_absent` refusal, which is a fact about the platform's own boundary and is §12.2's sampling population |
| **X5** | **Availability is invocation success rate and admission latency at a percentile, never uptime; the warm floor is resolved from consequence class and is never authored** | A scaled-to-zero instance is not down, so §13.2's availability target is unanswerable as written. Resolving the floor from consequence class is P10 and makes a committed response time a priced line item rather than a hope |
| **X6** | **PS16 does not host the platform's own services** | D39 onboards the platform at N2 — change control, not hosting. `core-services` and then CI deploy the platform; PS16 running PS16 is a bootstrap loop that buys nothing and costs a circular dependency at the worst possible layer |
| **X7** | **Hosting is not a rung on the §14.7 ladder** | Every substitution in that table replaces a *seam* inside an application that keeps running where it runs. Moving where it runs is a migration with very low reversibility, and selling it as an N3 step converts a graded engagement into the bet §14.7 exists to prevent. It is available as an N4 consequence, never as a rung |
| **X8** | **Every invocation carries an idempotency key derived from its trigger, and is refused without one; effects at the PS7 and AE3 boundaries are keyed by it** | At-least-once delivery is the default under every mode in §3.3. P3 survives per invocation and dies per effect — a binding calculation posted twice is a wrong regulated number, not a determinism failure, and the long-running-container design hides this behind deduplication nobody wrote down |
| **X9** | **A managed instance and an observed instance are distinct kinds, not one kind with a flag; only the first executes** | D27's discipline applied to the runtime. P14 says the platform warrants only what it holds, and a single record with `hosted_by: tenant` is one defaulted field away from the platform acting on infrastructure it does not own. It is also what gives PS16 a first wave: the observed half discharges §14.6's instrumentation contract in Phase 0 |
| **X10** | **A specification names an execution mode and a resource class; it never names a runtime, a container, an orchestrator, or a node** | T19 one layer up, and T22 applied to the service that is most tempted to break it. `job` is in the mode set because the D40 walk puts AE2 there — a design shipping only request and event discovers the solver under load |
| **X11** | **`released_by` must resolve to an accepted PS4 decision for the pinned specification version, and `artifact` is digest-pinned into PS13** | The one place P13 could leak into the runtime. A mutable tag or an absent decision is how something reaches production that no gate saw, and neither is detectable afterwards from the running system alone |

---

## 13. Open

- **X-A.** **Which FaaS.** Knative gives scale-to-zero, a mature eventing model, and is the closest fit for §3.3's four modes, at the cost of a heavy control plane the PoC does not want. OpenFaaS (faasd on the PoC, OpenFaaS on EKS) is far lighter and its eventing is thinner. Both satisfy T21. The decision should be made against §3.3's `job` and `event` modes, which is where they differ, and not against the request mode, where they do not.
- **X-B.** **Whether AE1 adopts the durable execution engine PS15 §11 already adopts.** One engine for the platform's own runs and a client's long-running workflows is attractive and is one blast radius; two is T15's cost with different nouns. Bears on whether §3.3 needs a fifth mode or none.
- **X-C.** **Whether the instance record is a PS2 projection or PS16's own store.** Identical in shape to **T-O** for PS13's ledger, and the two should be answered together — they are the same fact viewed from two services, and answering them apart is how W-D's two-stores-one-ledger arrives.
- **X-D.** **The workload principal is a PS1 change and PS1 has no design version carrying it** (§4.1). Whether it is a third population beside internal and external, or a distinct principal *kind* orthogonal to population, is not obvious — and V8 already proposes a third identity case for delegated government authorisation, so PS1 is absorbing two structural additions at once.
- **X-E.** **Metering granularity, and whether it is billing.** §8 makes cost per outcome computable. Whether PS16's meter is an input to invoicing — which makes it a financially binding calculation and therefore AE3's under P3 — is the same question **T-S** asks about PS14's SLA clock, arriving a second time. If the answer is yes for either, it is yes for both.
- **X-F.** **What an admission timeout means for Field capture.** AE7 syncs from a bouwplaats with intermittent signal into a possibly-cold function. The idempotency rule (§4.4) makes retries safe; it does not make them fast, and the interaction between an offline sync window and a warm floor of zero is untested.

*Inherited:* **T-O** (PS13's ledger, see X-C), **T-S** (binding calculation on the platform's own numbers, see X-E), **N** (unpriced operational liability, see §8), **H** (what is in the minimum instrumentation contract — §3.2 is now its principal consumer).

---

## 14. Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-08-06 | Initial design. PS16 established as the service for §4.5, the only plane with no service, and for §7.1's ownerless instance (X1). **Two kinds of instance** — managed and observed — as distinct kinds rather than one kind with a flag (X9), which is what gives PS16 a Phase 0 scope discharging §14.6's instrumentation contract with no execution at all. **Serverless by default** on a per-tenant shared open-source FaaS runtime, argued from four Tier 1 invariants becoming structural rather than disciplinary (§2.2) and from the compute half of §3.2's cost floor. Co-tenancy rule (X2), egress denial (X3), and the PS2 volume rule (X4). **Availability redefined** as invocation success rate and admission latency, with the warm floor resolved from consequence class (X5). **Idempotency at the trigger**, because at-least-once delivery breaks P3 at the effect rather than at the calculation (X8). Four execution modes derived by the D40 walk, `job` included because AE2 does not fit request-response (X10). Admission chain in §4, including **the workload principal PS1 does not model** (§4.1, X-D) — the largest gap surfaced and not caused by the serverless choice. Hosting excluded from §14.7's ladder (X7); the platform's own services excluded from PS16 (X6). Build order in six gated steps with only step 1 in the first wave. X-A to X-F opened |
