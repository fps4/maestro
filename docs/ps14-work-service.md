# PS14 — Work and Obligation Custody — Service Design

**Status:** Draft v0.2 — for refinement
**Repo:** `maestro/services/work-service`. *(Corrected in v0.2 — this line read `mstr-work` and a `Repositories/fps4/mstr-work` directory was created against it. **T53 reverses that plan**: a repository is earned by a consumer, and this service has one. The empty directory is the reversed plan still sitting on disk.)*
**Companions:** `conceptual-design.md` (v1.0) is authoritative for *what* and *why*; `technical-design.md` (v1.1) for build order and substrate; `ps2-record-spine.md` (v0.3) for the substrate this service projects from; `ps1-identity-service.md` (v0.1) for the principal model it assigns against. Precedence runs in that order and this document is wrong where it conflicts.
**Realised as:** `work-service`, one deployable in the maestro monorepo (**T53**).
**Scope:** The work item — its classes, its authority checks, its clock, and its closure. The commitment to act, from whatever raised it to a recorded outcome. **Not the authorship of work** (whoever owns the subject raises it), **not the artifact a work item produces** (PS3), **not the decision that accepts it** (PS4), and **not the delivery of the messages it sends** (PS8).
**Why this one:** the design tracks that someone was *told* — that is PS8, and it is built. Nothing tracks that anyone *did it*. §13.2 commits to resolution times, §5.7 escalates on a deadline, §14.6 makes the pattern of N1 escalations the argument for N2, and §12.2 says an unsampled seat is unsupervised. All five are commitments with no store.

---

## 1. What PS14 is, in one paragraph

PS14 holds every commitment the platform makes to act, from whatever raised it through to a recorded outcome: who must do what, by when, under whose accountability, at what oversight level, within what authority — and whether it happened. It is the delivery board for the platform's own work, and because that work is increasingly done by agents (T2), it is also where an agent's assignment, its ceiling, and its adverse outcomes become evidence rather than anecdote. **It authors nothing and accepts nothing.** A work item is a fact about an obligation, not a claim about the world, which is what keeps it outside the chain of record while still living on the same spine.

### 1.1 What PS14 is not

| Not | Owner | Why the confusion arises |
|---|---|---|
| Human tasks *inside* a generated application | **AE1** | Both are work with an assignee and a state. **PS14 holds work *about* an application; AE1 holds work *inside* one.** Cross it and client business process is living in a platform service, against §4.6 and §16 |
| Resource allocation and scheduling under constraints | **AE2** | "Scheduling" is three words. Scheduling *work in time* is PS14; scheduling *resources* is AE2 and T15 exists to keep them apart; scheduling *deployments* is a PS14 commitment over a PS13 event |
| Notification delivery and acknowledgement | **PS8** | Both carry dates. PS8 tracks *was it delivered*; PS14 tracks *was it done*. The failure of a notification is undelivered; the failure of a work item is unclosed |
| Deciding when a specification must be re-evaluated | **PS12** | Both hold clocks. See W3 — a clock belongs to whoever owns the subject it fires on |
| The finding, exception, or drift result itself | **PS12** | PS12 owns the conformance fact; PS14 owns the commitment to clear it. See W-D — this is the boundary most likely to end up with two stores for one ledger |
| The specification version a change produces | **PS3** | A `change` item *causes* a proposal; it does not contain one |
| The gate decision that closes it | **PS4** | PS14 records that a gate decided, exactly as PS2 does (§6.3 of that document) |
| A project management product | — | No obligation in the design demands sprints, estimates, velocity, or story points, and §2's derivation is the admission test |

---

## 2. The obligations it discharges

*Derived the way §3.0 of the technical design derives the service set: walked from the source, not enumerated from experience. Every row is a commitment already written in the conceptual design with no service behind it. **A row with no source is not admissible**, which is the only defence against this service becoming a general work tracker.*

| Obligation | Source | What PS14 holds |
|---|---|---|
| S1–S5 triage, routing, and resolution | §13.1 | The case, its tier, and the route it took — including the S4/S5 misroute §13.1 calls the costliest |
| Response and resolution times by severity | §13.2 | The clock, the breach, and the evidence the commitment was met |
| **At N1: availability and response, never correctness** | **D30**, §14.6 | The refusal of a correctness-shaped commitment on an N1 application, at raise |
| Remediation classes and their minimum onboarding level | §14.6, **D29** | The class, the authority check, and the reversal-and-evidence precondition |
| N1 escalation to the Owner with a recommendation — *"and a recorded one, since a pattern of them is the argument for N2"* | §14.6 | The escalation, and the pattern made queryable |
| Intent recovery where S4 has no target | §14.6, §13.1 | Discovery work on a brownfield application, billable, and the reliable pull from N1 to N2 |
| Objective trigger — *a change with no new specification* | §10.4 | The only artifact §10.4 names that no other service holds |
| Signal trigger — *a cause analysis and proposed fix* | §10.4 | The item from incident to fix, linked to the PS3 proposal if one results |
| Intent trigger — the change request with an Owner | §10.4, §13.1 | The request; the specification version it produces is PS3's |
| Non-conformant-manual escalation with a deadline derived from `effective_from` | §5.7 | The commitment, its deadline, and its closure — PS12 classifies, PS14 chases |
| Advisor re-solicitation, per tenant, per material change | §5.3.2, §15.3 | One item per affected tenant per standard — and therefore the first count of a cost §15.3 says to *size early* |
| Exception ledger expiries and Tier 1/Tier 3 remediation deadlines | §14.5 | The remediation commitment. *"A ledger with no expiries is a way of never fixing anything"* |
| Gap register findings with Owner acknowledgement | §14.5 | The acknowledgement, and the remediation item where consequence warrants one |
| Sampling above O2 — *"without sampling, O3 and O4 are unfalsifiable"* | §12.2, §12.5 | The sampling schedule, its decay curve, and enforcement of the non-zero floor |
| Periodic audit of the meta-control, *"at a fixed cadence, regardless of reported outcomes"* | §12.5 | A recurring item that cannot be closed by the thing it audits |
| Re-verification of a descriptive specification on its interval | §14.4, PS3 §6.3 | The recurring commitment to re-derive. PS12 sets `expired`; PS14 is why someone tried not to let it |
| Custody obligations at intake — baseline, scoped credentials, rehearsed rollback | §14.6 | Intake deliverables as items, *"not first-incident discoveries"* |
| Supply-chain patch: detect at N0/N1, patch at N2, escalate below it | Technical design §7 | The patch item, under the same authority check as any other remediation |
| Decommission: export, revocation, notification, final conformance record | §13.4 | The retire checklist, closed against evidence |
| Substitution steps in reversibility order | §14.7 | Sequenced items with blocking edges — executing a plan the architect authored, never authoring one |
| Opportunity and backlog hygiene | §6 | *(Shared.* PS3 expires opportunities under S12; PS14 holds the follow-up work an unexpired one generates*)* |

### 2.1 Tested and excluded

Recorded because each looked like a fit and is not, and because an exclusion nobody wrote down is an exclusion that will not hold.

| Candidate | Rejected to | Argument |
|---|---|---|
| Resource allocation, capacity optimisation | AE2 | T15: constraint satisfaction over resources and time is not state transition. A second allocator inside a platform service is the failure T15 already names, one layer up |
| In-application workflow steps | AE1 | §16 — core carries zero domain knowledge. A werkvoorbereider's approval step is domain work |
| Message delivery, channels, acknowledgement | PS8 | PS14 decides there should be a message; PS8 delivers it. Folding delivery in repeats the inversion the technical design rejects for PS12 |
| Deciding *what* to re-evaluate | PS12 | Requires knowing which specifications a pack change affects — standards-domain knowledge, and it does not belong in a work service |
| Holding the conformance finding | PS12 | A finding is a conformance fact with a version and an interpreting authority. The commitment to clear it is not the same object |
| Granting the capability to act | PS9 | **Assignment is not authorisation.** An agent holding a work item has no more reach than its grants (P8, §11.2) |
| Sprints, estimates, velocity, story points | — | Not traceable to any obligation in §2. They would import a delivery methodology the governance model does not have |

---

## 3. Three rules that make the boundary testable

Stated before the model, because the model is unremarkable and the boundary is the whole design.

**W-rule 1 — PS14 holds commitments and computes their deterministic consequences in time. It does not decide what work should exist, and it does not optimise how work is distributed.** What work exists belongs to whoever owns the subject: PS12 for drift and expiry, PS5 for a failed standard, PS4 for a gate condition, the Operations seat for an incident, an Owner for a change. Optimising distribution is AE2's problem and is not the platform's.

**W-rule 2 — a clock belongs to whoever owns the subject it fires on.** PS12's clock fires on specifications and packs; PS14's fires on commitments. PS12 decides *what must be re-evaluated and when*, and where the outcome is §5.7's *non-conformant, manual*, it **raises a work item in PS14**. Neither service reads the other's store and there is no cycle. The tidier-looking alternative — PS14 becomes the platform's only scheduler and PS12 drops to a pure evaluator like PS5 — is rejected because it moves *which specifications does this pack change affect* into a work service.

**W-rule 3 — a work item is not a proposal.** P13 governs the chain of record: artifacts that assert something and therefore need accepting. A work item asserts nothing; it records that someone owes an act, and its state changes are facts. This is not a new exemption — it is PS2 §6.3's, applied to a second service: *"PS2 records that a proposal was made and that a gate decided — both are facts, and a fact is not a proposal."* Where a work item's **outcome** requires acceptance, the proposal is made in PS3 and accepted by PS4, and the item carries the link. **PS14 has no accept operation and no artifact versions** (W4).

---

## 4. The work item

### 4.1 Envelope

```yaml
work_item:
  # identity
  item_id:            wrk-8841
  tenant_id:          tnt-aannemer-x          # never null, never inferred from context
  class:              remediation             # §4.2 — derived, not invented
  subject_type:       application
  subject_id:         app-projectadmin
  parent:             wrk-8790                # one level of decomposition; no fixed hierarchy

  # why it exists — never authored here (W-rule 1)
  raised_by_service:  PS12
  raised_cause:       01J9F2K5…               # the PS2 event that caused it
  trigger:            policy                  # §10.4's four: intent | objective | policy | signal

  # accountability — the same four fields PS2 demands at append (R1)
  accountable:        usr-j-dekker            # a human principal, always (P12)
  assigned_to:        agt-remediation-2       # human or agent principal (T2)
  seat:               operations
  oversight_level:    O4                      # resolved by PS4 at assignment, re-resolved on reassignment

  # authority — resolved, never accepted from a caller (§5)
  onboarding_level:   n1                      # of the subject application (D26)
  remediation_class:  restore                 # §14.6's six
  reversible:         true
  evidence_plan:      [ deployment_event, telemetry_window ]

  # time — derived from PS11 policy, never entered (§6)
  severity:           s2
  opened_at:          2026-08-04T08:12:00Z
  respond_by:         2026-08-04T09:12:00Z
  resolve_by:         2026-08-05T08:12:00Z
  chase_schedule:     pol-nl-bouw-esc@2       # the escalation ladder in force
  recurrence:         null
  review_by:          2026-09-04              # expiry, per §14.5

  # state
  state:              in_progress
  blocked_by:         [ wrk-8792 ]
  produces:           null                    # e.g. ps3://specification/spec-4417@4
  outcome:            null                    # set once, at closure, always

  # detail — never inline (§4.4)
  payload_ref:        ps7://work-item/wrk-8841
  payload_digest:     sha256:6b90…
```

**Four envelope rules, enforced rather than documented:**

1. **`accountable` resolves to a human principal, and never moves.** Assignment moves work; it never moves accountability (P12, §12.4). An agent in this field is a rejected write, exactly as in PS2.
2. **The authority fields are resolved by PS14 from PS4 and PS13, never accepted from the caller.** An agent that could write its own `onboarding_level` could raise its own authority, which makes §5's checks decorative.
3. **`oversight_level` is the level in force at assignment, copied on**, not joined to current configuration — R2's rule, for the same reason: promotion and demotion change the level, and the record of what governed an act must not change with it.
4. **`outcome` is write-once and mandatory at closure.** P11 applies to work: an item that stops existing without a recorded outcome is the failure §14.5 describes.

### 4.2 Six classes, derived from §10.4 and §13.1

| Class | Derived from | Typical raiser | Closes on |
|---|---|---|---|
| `change` | §10.4 intent; §13.1 S4 | Owner, support triage | An accepted PS3 version, or a recorded decline |
| `objective` | §10.4 objective | Operations, architect | A deployment event in PS13; no new specification |
| `remediation` | §10.4 signal; §14.6's six classes | Operations, PS12, telemetry | Evidence per `evidence_plan`, or escalation out |
| `obligation` | §5.7, §5.3.2, §14.5 | PS12, PS11 | The deadline met, or breached and recorded |
| `support` | §13.1 S1–S5 | A named human in the tenant | Resolution, or a `change`/`remediation` child |
| `review` | §12.2, §12.5, §14.4, §14.6 | PS14 recurrence | The review performed and its finding recorded |

**Intent recovery is a `change` item on a brownfield application**, raised from a `support` item whose S4 has no target (§14.6). It is marked so, because §14.6 makes it billable discovery work and one of the more reliable arguments for N2 — and an argument nobody can count is not an argument.

### 4.3 States

```
open ──▶ assigned ──▶ in_progress ──▶ resolved ──▶ closed
            │              │  ▲
            │              ▼  │
            │           blocked
            ▼
        escalated ──────────────────────▶ closed
```

Plus `expired` (past `review_by` with no closure) and `withdrawn` (the raiser retracted). **Every path to `closed` carries one of five outcomes:** `done`, `superseded`, `escalated_out`, `refused`, `expired`.

**`escalated_out` is the one that earns its place.** D29 says remediation authority never exceeds the onboarding level and that the correct N1 output for an unreachable fix is an escalation to the Owner with a recommendation. That is not a failure and must not be recorded as one — and §14.6 makes the *pattern* of them the commercial argument for N2. A rate is a product input; a pile of closed tickets is not.

### 4.4 What is an event and what is a payload

PS2 §1 states that its affordability rests on tiny volume by construction, and warns that if its volume ever looks like PS7's, something has leaked. A work board is the most likely leak in the platform, because activity is chatty and commitment is not.

**Six event types on PS2, and no more:**

`WorkItemRaised` · `WorkItemAssigned` · `WorkItemStateChanged` · `WorkItemEscalated` · `WorkItemBreached` · `WorkItemClosed`

**Never events:** comments, working notes, diagnostic output, model reasoning, progress percentages, attachments. These are PS7 payloads under §2.4's classification envelope and T25's retention and erasure rule — which they need anyway, since a support case routinely names the person who raised it.

**The rule is mechanical: an event per commitment change, never per keystroke** (W9). Reassignment changes the commitment and is an event; a note about progress does not and is not. The test is PS2's own — if PS14's event rate tracks activity rather than obligations, the boundary has already been crossed.

**PS14 holds no system of record.** Its store is a rebuildable projection over PS2, archive-then-log, as S1 requires of PS3 and R8 of every read model. Dropping and rebuilding it is a build gate (§11), not an aspiration.

---

## 5. Authority: three checks, at claim, refused rather than warned

This is the section that makes PS14 a governance service rather than a task tracker. Each check enforces something the conceptual design currently states contractually and nothing enforces.

| # | Check | Source | On failure |
|---|---|---|---|
| 1 | `remediation_class` ≤ what `onboarding_level` permits | **D29**, §14.6's table | Refuse the claim. The item closes `escalated_out` to the Owner with the recommendation attached |
| 2 | A correctness-shaped commitment is not offered at N1 | **D30**, §13.2, §14.11 | Refuse at **raise**, not at claim. §14.11 calls this the way an ops business fails, and says it must be contractual rather than understood — this makes it mechanical, which is stronger |
| 3 | The claiming principal's seat may act at the item's oversight level, within its ceiling | §12.3, §12.5 | Refuse; the item returns to `open` and the refusal is recorded |

**PS14 resolves no ceiling itself; it asks PS4** (W8). Ceilings are pack content (§12.5, PS11) and PS4 already reads them for gate decisions. Two resolvers would be two answers, which is the argument that keeps acceptance in one place.

**Refusal is an outcome, never a warning.** A check that logs and proceeds is not a check. It is also the shape §14.5 uses for Tier 1 below N3: a recorded finding with an owner, not a block on something the platform does not control.

**Assignment grants no capability** (W7). An agent holding a `remediation` item can reach exactly what its grants allow at PS9, and nothing more. The item says *you owe this act*; the grant says *you may perform it*. Conflating them would put capability enforcement above the generated layer, which D41 places below it.

---

## 6. Time

### 6.1 Due dates are derived, never entered

`respond_by` and `resolve_by` come from PS11 policy keyed on severity × criticality tier × onboarding level (§13.2). §5.7's deadlines derive from `effective_from`, and §5.7 says so explicitly — *"a deadline derived from `effective_from` rather than entered."* A hand-typed date is a commitment nobody can audit against a service level.

**Until PS11 exists, PS14's targets have no home that survives a pack version** — the identical problem the technical design records for PS4's ceilings, with the identical answer: the fields exist from the first build, the registry arrives with PS11.

### 6.2 The chase ladder is pack content, not code

```
reminder ──▶ chase ──▶ escalate to accountable ──▶ escalate to Steward ──▶ breach recorded
```

Deterministic, versioned, effective-dated — and **domain knowledge**, because how hard and how fast you chase a Wkb deadline is not how you chase an internal tracker. It therefore lives in PS11 alongside ceilings (§12.5) and never in core (§16). **This is T-J's twin**: that question asks whether PS8's delivery channels are platform-provided or pack-supplied, and the answer to the two should be the same one.

**PS14 decides that a message is owed; PS8 delivers it and records that it did.** Both records are needed: PS8 answers *was it delivered*, PS14 answers *did anyone act*.

### 6.3 Recurrence carries the obligations nothing else holds

Sampling above O2 (§12.2) is a recurrence rule with a decay curve and a **permanent non-zero floor** (§12.5) — *"a seat with zero sampling is not supervised, it is merely believed."* PS14 is where the floor is enforced, because a floor implemented as a reminder is not a floor. The same machinery carries the meta-control audit at a fixed cadence *regardless of reported outcomes* (§12.5), descriptive-specification re-verification intervals (§14.4), and rollback rehearsal (§14.6).

**A recurring item cannot be closed by the subject it examines.** The §12.5 audit of the governance review agent is meaningless if the governance review agent can close it — that is the closed loop the section exists to break.

### 6.4 Expiry

Every item carries `review_by`. Expiry is a recorded outcome, never a disappearance — §14.5's ledger rule and §6's backlog hygiene, and the same shape as PS3's S12 for opportunities. A rising expired count is a signal about the operation, not a queue to be cleared quietly.

---

## 7. Assignment: claim and lease

Work is **offered to a seat** and **claimed by a principal**. First claim wins, subject to §5. There is no matching, scoring, or optimisation — W-rule 1, and if genuine allocation is ever required it is AE2's algorithm reused, never a second one grown here.

- **A claim is held under a lease with a heartbeat.** Lease expiry returns the item to `open` and records `WorkItemStateChanged` with the reason. A silent return is how work disappears.
- **The agent principal is distinct from the accountable human and from the service account it runs under** (T2). All three are separately resolvable on every item, which is §12.4's requirement applied to work rather than to decisions.
- **An agent-raised item inherits the raising seat's ceiling and may not exceed it.** The conservative default; the general question — whether an agent may decompose work for other agents at all, and under what supervision — is **W-E**, and it is the sharpest new governance question this service creates.

---

## 8. PS14 is the evidence base §12.2 currently lacks

§12.2 requires two things of the governance review agent and supplies neither with data:

- **Automatic demotion on adverse outcome.** *"An O4 seat that produces a bad result drops to O2 immediately, without discussion."* An adverse outcome is an observable: an item closed `refused`, a remediation reversed, a breach, a `resolved` item reopened. Today nothing records any of them against a seat.
- **Sampling above O2.** Sampling needs a population. PS4 supplies the decision population; **PS14 supplies the work population** — and above O2 most of what an agent does is work, not decisions.

This is why §12.5's rollout order survives contact with reality: *recording first, then demotion, then promotion.* PS14 is the recording, and it is first-wave for exactly that reason.

**One detector improves as a side effect.** §15.1 warns that Explore becomes theatre if users route around it by raising work as "small changes", and names the ratio of new opportunities to change requests as the detection. PS3 §11 records that PS3 holds the only data that detects it — with PS14 that is no longer true, and the detector becomes a join: opportunities in PS3, `change`-class items in PS14. PS3's failure-mode row should be updated accordingly.

---

## 9. Fleet work and tenancy

Work items are tenant runtime data, so T29 forbids a shared service from holding them: isolation is topological (T6) and per-tenant (T28) — schema per tenant at L1, own database at L2, exactly as PS3 and PS4.

**Fleet-wide work is a parent in the platform's own tenant with a child in each affected tenant.** Under D39 and §8 of the technical design the platform is its own first onboarded application, so it is a tenant like any other and needs no special case. Advisor re-solicitation after a material pack change (§5.3.2), a fleet-wide supply-chain patch (§7), and a re-attestation round (§5.7) all take this shape.

**This gives §15.3's sharpest risk a number for the first time.** That section calls advisor re-solicitation *"linear in tenants and outside your control"* and §5.3.2 says to *size it early*. A fan-out that materialises as one item per affected tenant per standard is countable **before** the materiality classification is signed, which turns D24's *"wrong in either direction is expensive"* into something the classifier can see at the moment of classifying.

---

## 10. Interfaces

Per T17: UI, API, MCP — with one qualification this service forces.

| Operation | Surface | Notes |
|---|---|---|
| `raise(item)` | UI, API, MCP | Open to anyone authorised in the tenant, and to platform services. Authority fields are **resolved, not accepted** |
| `claim(item)` · `release(item)` | UI, API, MCP | Subject to §5's three checks; refusal is recorded |
| `transition(item, state, outcome?)` | UI, API, MCP | The only mutation. `outcome` mandatory on closure |
| `annotate(item, note)` | UI, API, MCP | Goes to PS7 as a classified payload; never an event (§4.4) |
| `get`, `list`, `query` | UI, API, MCP | Broad reads, including the `escalated_out` rate and the sampling-floor report |
| `export(tenant)` | API | P9. Items, outcomes, and the evidence references |
| *accept anything* | — | **Not exposed.** PS14 has no acceptance operation (W-rule 3) |
| *set an authority field* | — | **Not exposed.** PS4 and PS13 resolve them |

**T17 needs a qualifying clause and this document records it rather than making it.** T17 reads *every write proposes and only PS4 accepts*. PS14's writes neither propose nor accept — they record facts about an obligation, on PS2 §6.3's ground. The clause should say so explicitly, because the alternative reading is that PS14 violates T17, and a decision that a service quietly excepts itself from is worse than a decision with a stated boundary.

**MCP is where the "board for agents" actually is.** An agent reads its queue, claims an item, transitions it, and annotates it — through the same interface an auditor reads and under the same three checks. That is D13's payoff applied to work: no bespoke agent plane, and no path by which an agent acquires authority the interface did not resolve for it.

---

## 11. Build order and gates

| # | Step | Gate |
|---|---|---|
| 1 | Envelope, six event types, PS2 append, PS7 payload split | An item is raised, assigned, and closed with an outcome — and read back identically after PS14's store is dropped and rebuilt from archive-then-log |
| 2 | The three authority checks (§5) | A `patch`-class item on an N1 application is **refused at claim**, closes `escalated_out`, and the escalated-out rate for that application is queryable in one call |
| 3 | Derived due dates, chase ladder, breach, delivery through PS8 | A deadline-bearing item chases, escalates, and breaches on schedule, with every step delivered by PS8 and recorded here |
| 4 | Claim, lease, heartbeat, agent assignment | An agent claims an item, its lease expires, the item returns to `open` with a recorded reason — and `accountable` is unchanged throughout |
| 5 | Recurrence, expiry, sampling schedules | A sampling schedule decays toward its floor and is mechanically prevented from reaching zero; an item past `review_by` closes `expired` |
| 6 | Fleet fan-out in the platform tenant | A material pack change produces one item per affected tenant, and the count is available *before* the classification is signed |

**Steps 1–3 are first wave.** §17 puts onboarding at N0–N1 and support in **Phase 0**, which is where S1–S5, D29 and D30 all land — before the composition plane exists, exactly as PS13's first-wave scope arrives before anything is generated. Steps 4–6 follow with agent assignment and PS11's second pack version.

**Dependencies: PS1, PS2, PS8, PS4** *(authority and ceiling resolution)*, **PS11** *(policy)*. PS12 depends on PS14, not the reverse.

---

## 12. Failure modes

| Failure | Detection | Response |
|---|---|---|
| **It becomes a Jira** | A field or a class with no row in §2 | Reject at design review. §2's derivation is the admission test, and it is the only one |
| **The board becomes the record** | A `change` item closed `done` with no linked accepted PS3 version | Mechanically impossible: that closure path requires the link. Otherwise specification changes get tracked here and never proposed, and the chain of record silently forks |
| **Event volume tracks activity** | PS14 events per tenant per day against PS2 §1's budget | Notes and diagnostics are PS7 payloads. If the rate climbs, something is emitting per keystroke (§4.4) |
| **SLA clock gaming** | Reopen rate; close-then-reopen inside the window | Breach computes from `opened_at` and the original severity, never from current state |
| **Work executed above authority** | The check at claim | Refuse and record. A check that warns is not a check |
| **Orphan escalation** | Items past `review_by` | `expired` with a recorded outcome. §14.5: a ledger with no expiries is a way of never fixing anything |
| **Assignment read as authorisation** | An agent acts on an external system holding only an item | PS9 refuses it. PS14 grants nothing (W7), and the refused attempt is recorded there |
| **The audit closes its own audit** | Subject identity equals closer identity on a `review` item | Rejected transition (§6.3) |

---

## 13. Decisions

| # | Decision | Rationale |
|---|---|---|
| W1 | **PS14 holds no system of record; every write appends to PS2 and its store is a rebuildable projection** | The same rule as S1 and R8. A second home for governance facts makes the spine's guarantees a convention |
| W2 | **PS14 holds commitments and computes their consequences in time; it authors no work and optimises no distribution** | The seam test. Authorship belongs to whoever owns the subject; optimisation is AE2's, and T15 already explains why a second one is expensive |
| W3 | **A clock belongs to whoever owns the subject it fires on: PS12's fires on specifications and packs, PS14's on commitments** | Avoids both a cycle and a general scheduler. The alternative moves standards-domain knowledge into a work service |
| W4 | **A work item is not a proposal; PS14 has no acceptance operation and holds no artifact versions** | PS2 §6.3's ground — a fact is not a proposal. Where an outcome needs acceptance, PS3 proposes and PS4 accepts, and the item links to it. Qualifies T17 |
| W5 | **Six classes derived from §10.4's four triggers and §13.1's five tiers, not invented** | The same discipline as D40 and T20. A class with no source is how a governance service becomes a work tracker |
| W6 | **Every closure carries a write-once outcome, and `escalated_out` is one of them** | P11 applied to work. D29 makes escalation the *correct* N1 output and §14.6 makes the pattern the argument for N2 — which requires a rate, not a pile |
| W7 | **Authority is checked at claim and refused, never warned; assignment grants no capability** | D29 and D30 are contractual today. §14.11 names D30's failure as how an ops business dies, and mechanical beats contractual. Capability stays at PS9 (D41) |
| W8 | **PS14 resolves no ceiling; PS4 does** | Ceilings are pack content (§12.5). Two resolvers are two answers, and the whole of P13's defence is that such logic exists in one place |
| W9 | **An event per commitment change, never per keystroke; notes and diagnostics are classified PS7 payloads** | PS2 §1's volume argument, applied to the service most likely to break it. It also puts the personal data a support case carries where T25 already requires it |
| W10 | **Response and resolution targets and the chase ladder are pack content in PS11, never code** | How hard you chase a Wkb deadline is domain knowledge (§16). **T-J's twin** — PS8's channels and PS14's ladder should be answered together |
| W11 | **Assignment is claim-and-lease with an authority check; a lease expiry returns the item with a recorded reason** | First-claim-wins is sufficient and keeps W2 honest. A silent return is how work disappears from a board that is supposed to be evidence |
| W12 | **Fleet work is a parent item in the platform tenant with a child per affected tenant; nothing is stored cross-tenant** | T29 — a shared service may hold no tenant runtime data. D39 makes the platform a tenant, so this needs no special case, and it makes §15.3's cost countable before it is committed |
| W13 | **PS14 is the evidence base for §12.2's sampling and automatic demotion, and it is first wave for that reason** | §12.5's order is recording, then demotion, then promotion. Recording is the part that cannot be retrofitted |

---

## 14. Open

- **W-A.** Whether PS14 and PS12 are one service — the same shape as T-D (PS3/PS4) and T-M (PS5/PS11). Provisionally separate under W3. **PS14 is deliberately built not to depend on PS12's internal shape**: it depends only on *some service raises an item*, so a later consolidation of PS12 with its neighbours changes nothing here.
- **W-B.** Whether the SLA clock is a *binding* calculation under P3 once service credits attach to a breach. If it is, it moves behind AE3's interface rather than living in PS14 — and it would be the first binding calculation the platform performs **on itself**.
- **W-C.** Whether S1 conversational support is a PS14 surface or a client of it. §13.1 assigns S1 to "platform conversational support", which is AE5-shaped, and AE5 is deferred.
- **W-D.** Whether the exception and finding ledger (§14.5) is PS12's or PS14's. Provisional split: PS12 owns the finding as a conformance fact; PS14 owns the remediation commitment that clears it. **This is the boundary most likely to produce two stores for one ledger**, and it should be closed with W-A, not separately.
- **W-E.** Whether an agent may decompose work for other agents, and at what ceiling. Default recorded in §7 — inherits the raising seat's ceiling, may not exceed it. The general question is the sharpest new governance question this service creates, and it is the one that decides how far "a board for agents" can actually go.
- **W-F.** Effort and estimation. Nothing in §2 requires it, and conceptual open question **J** (condition assessment flowing into pricing and offerable SLOs) cannot close without something like it. Deferred, but named as J's likely home.
- **W-G.** Business-hours calendars and clock pause/resume for *waiting on client*. Unglamorous, and it decides whether §13.2's numbers mean anything in practice or only on paper.

*Inherited:* **T-J** (pack-supplied versus platform-provided — W10 is its twin), conceptual open question **O** (the user interface; PS14's board is a second partial answer after PS3's four screens), and the T-D/T-M shape question carried as W-A.

---

## 15. Change log

| Version | Date | Change |
|---|---|---|
| 0.2 | 2026-08-06 | **Repository placement corrected to the maestro monorepo** (**T53**, technical design §3.4). The `Repo:` line read `mstr-work` and an empty `mstr-work` directory was created against it; T53's rule — *a repository boundary is earned by a consumer, never by a service boundary* — places this service inside, since it has one consumer and the platform builds rather than consumes it. **The directory on disk is the reversed plan, not a repository**, and is recorded here rather than silently ignored because an empty directory next to fifteen real ones is what someone `git init`s later. Companion versions corrected. No obligation, class, check, clock, or boundary changed |
| 0.1 | 2026-08-04 | Initial design. PS14 established as the platform's work and obligation custody — the service holding *did anyone do it*, against PS8's *was anyone told*. §2 derives twenty-one obligations from the conceptual design, each with a source, and §2.1 records seven candidates tested and excluded to AE1, AE2, PS8, PS9 and PS12. **Three boundary rules** (§3): commitments in, authorship and optimisation out (W2); a clock belongs to whoever owns the subject it fires on, which is the PS12 boundary (W3); a work item is not a proposal, on PS2 §6.3's ground, which qualifies T17 (W4). Six classes derived from §10.4's triggers and §13.1's tiers (W5); five closure outcomes with `escalated_out` first-class so D29's correct N1 output is countable (W6). **The three authority checks** (§5) make D29 and D30 mechanical rather than contractual (W7), with ceilings resolved by PS4 alone (W8). Due dates derived from PS11 policy and the chase ladder placed in the pack as T-J's twin (W10). Recurrence made the home for §12.2's sampling floor and §12.5's meta-control audit. PS2 volume protected by an event-per-commitment rule (W9). Fleet fan-out as a parent in the platform tenant (W12), which makes §15.3's advisor re-solicitation cost countable before a materiality classification is signed. §8 records PS14 as the evidence base §12.2 lacks (W13). W-A to W-G opened |
