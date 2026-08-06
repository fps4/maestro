# PS15 — Agent Execution and Composition — Service Design

**Status:** Draft v0.2 — for refinement
**Companions:** `conceptual-design.md` (v1.0) is authoritative for *what* and *why*; `technical-design.md` (v1.1) for build order and substrate; `ps14-work-service.md` (v0.1) owns the commitments this service discharges; `ps7-data-service.md` (v0.4) holds everything this service produces that is not a governance fact; `ps1-identity-service.md` (v0.1) for the agent principal it runs as. Precedence runs in that order and this document is wrong where it conflicts.
**Realised as:** `agent-service`, in `maestro/agent/` — **placed by T53 and not settled by it** (§1.2, upstream **T-X**). It is the only tree that does not hand over, so its boundary is import rule 5 rather than a repository, and whether that is sufficient is a commercial judgement still open.
**Scope:** The deterministic machinery around a model — the run and its steps, the tool surface, the mediation of every proposed action, the constructs at a version, and the transcript. **Not the model's judgement** (§6, the only non-deterministic thing in the service), **not the commitment the run discharges** (PS14), **not the artifact it proposes** (PS3), **not the decision that accepts it** (PS4), **not the capability it acts under** (PS9), and **no domain knowledge whatsoever** (§16).
**Why this one:** four commitments in the conceptual design have no enforcement point and no store. §9 puts the **determinism boundary** in the provided-never-generated layer — *"the agent may propose a rule, never be the rule at runtime"* — and T14 says it must be an enforced interface rather than a convention, without naming what enforces it. §14 applies **§11.1's A0–A4 ladder** to the platform's own remediation agents and nothing checks it at the moment of action. **§4.4's composition plane** has been in the design since v0.2 and has never had a service. And **§13.5/D20** names *"prompts, workflows, orchestration, and the composition logic"* as the IP that does not transfer, while every service that would otherwise hold it hands over as open code.

---

## 1. What PS15 is, in one paragraph

PS15 is everything around the model that is deterministic. It starts a **run** against a **construct** at a version, resolves the ceilings and the tool set the run may see, and then does one thing repeatedly: takes a **proposed action** from the model and either admits it or refuses it, deterministically, before any effect exists. What the model produces is a proposal; what reaches a service is a mediated call under a resolved authority. **PS15 authors no artifact, accepts nothing, and grants nothing** — it is the enforcement point for §9's determinism boundary and §11.1's autonomy ladder, and it is where the platform's non-transferring IP is concentrated so that D20 is a repository you do not ship rather than a carve-out you negotiate.

### 1.1 What PS15 is not

| Not | Owner | Why the confusion arises |
|---|---|---|
| The commitment an agent is working on | **PS14** | Both are "agent work". **PS14 holds *that an act is owed*; PS15 holds *the attempt to perform it*.** PS14's board is claimed *by* a PS15 run; the two are not one store (E8) |
| The capability to reach an external system | **PS9** | Assignment is not authorisation and neither is admission. PS15 decides an action is *well-formed and within autonomy*; PS9 decides the platform may *make the call* (D41, W7) |
| The artifact a run proposes | **PS3** | §5.7's *non-conformant, auto-remediable* says the composition plane **proposes a change for owner approval**. It proposes into PS3; it does not hold a version |
| The decision that accepts it | **PS4** | P13 is undiminished: a run's write proposes, exactly like any other interface (§4.5 of the technical design) |
| Binding calculation | **AE3** | T14's seam. The agent may propose a rule, never *be* the rule. Anything with legal or financial consequence is AE3's, and P3 is decorative if this boundary is a convention |
| The agent runtime inside a generated application | **AE5** | Both run models. **PS15 is platform-plane and runs against the platform's own constructs; AE5 is application-plane and is composed into a client's application.** Same engine class, different plane — the PS2/PS7 shape. See **E-H**, which is the sharpest open question here |
| A tool implementation plane | — | A tool is an existing service operation (E3). A tool with no owning service operation is the defect T20 was strengthened to catch |
| A general workflow engine | **AE1** | AE1 runs a client's business process. PS15 runs the platform's own constructs. §16 — core carries zero domain knowledge, and a prompt is code that carries it easily |
| Prompt authoring for a client's domain | **PS11** | Constructs that encode domain knowledge are pack content (E5). A prompt naming a Wkb concept is a pack artifact that happens to be prose |

### 1.2 Where it lives

**Deferred, deliberately.** Whether `agent-service` is its own repository or a deployable in the maestro repository is not decided here, and this document does not depend on the answer: nothing below changes shape under either.

Two things do bear on the eventual decision and are recorded now.

- **The split-out trigger PS7 §1.3 states — *a consumer that is not maestro* — resolves differently here, and in the opposite direction.** PS7 co-locates because it has one consumer. PS15 has one consumer too, so the same test says co-locate. But PS15 is the **only** component that does not hand over (§9, E11), and every other thing in the maestro repository does. Co-location means the exit boundary runs *through* a repository rather than *between* repositories, and it becomes an import rule rather than a shipping decision.
- **If it co-locates, the exit boundary becomes CI.** One rule: nothing under the handed-over tree imports from the agent tree, and the export bundle is built from an explicit include list rather than an exclude list. That is enforceable, and it is strictly weaker than a repository boundary. Whether "strictly weaker" is "too weak" is a commercial judgement, not an architectural one.

**✅ The numbering conflict is resolved and the topology is written: technical design v1.1, §3.4 and T53.** The decision took the next free number rather than renumbering T35, and it **places this service in the monorepo without settling it** — the rule is that a repository is earned by a consumer, PS15 has one, and so the architectural answer is *in*. What T53 does not decide is the second bullet above, because that argument is not architectural: **the exit boundary becomes import rule 5** — nothing under the exported tree imports from `agent/*`, and the export bundle is built from an **include** list rather than an exclude list. Whether that is too weak for the one tree that never leaves is carried upstream as **T-X**, and it should be decided **before the first export bundle is built**, since an include list assembled around an existing leak is not a fix.

---

## 2. The obligations it discharges

*Derived the way §3.0 of the technical design derives the service set and §2 of the PS14 design derives its scope: walked from the source, not enumerated from experience. **A row with no source is not admissible.** For this service that discipline matters more than for any other, because "what an agent platform should have" is an unbounded list and every item on it sounds reasonable.*

| Obligation | Source | What PS15 holds |
|---|---|---|
| The determinism boundary as an **enforced interface** | **§9**, **T14** | The mediator (§6). The single place a model's output stops being a proposal and becomes an effect |
| A0–A4 checked at the moment of action, for the platform's own remediation agents | **§11.1**, §14 | The autonomy level in force, the check per action, and the refusal. §14 applies the ladder and nothing enforces it |
| The composition plane | **§4.4**, §9 | Generation from an accepted specification, run on the same machinery as every other construct — no second orchestrator |
| *Non-conformant, auto-remediable* — "the composition plane proposes a change for owner approval" | **§5.7** | The run that produces the proposal, and the link to the PS3 version it proposed |
| Prompts, workflows, orchestration, composition logic as **non-transferring IP** | **§13.5**, **D20** | Their single physical home, which makes the exit promise mechanical rather than negotiated |
| "Keep the composition plane behind a stable internal interface" | **§15.6** | The model port. Provider and model version recorded on every proposed action, so the exposure is measurable rather than asserted |
| Capability enforcement stays **below** the generated layer | **§9**, **D41** | Nothing. Explicitly: PS15 holds no credential and performs no outbound call itself (E4) |
| Oversight ceilings honoured by an acting agent | §12.3, §12.5 | The ceiling resolved by PS4 at run start, copied on, and checked per action — not per run |
| The sampling and demotion population §12.2 needs for *actions*, not decisions or work | §12.2, §12.5 | The **refused-proposal** record. PS4 supplies decisions, PS14 supplies work, PS15 supplies what an agent *tried* and could not do |
| Periodic audit of the meta-control, by something that is not the meta-control | §12.5, PS14 §6.3 | The rule that a run may not resolve a tool that closes its own audit item (§13) |
| Personal data in model transcripts | **T25**, PS7 §4 | Nothing — by construction. Transcripts are PS7 classified payloads, and PS7 rejects an unclassified write (E7) |
| Core carries zero domain knowledge | **§16** | A construct set with no domain term in it. Domain-bearing constructs are PS11 pack content (E5) |
| Adopt managed open source, never a proprietary primitive | **T21** | The durable execution engine, adopted; the contract, built (§11). The model provider is the one place this rule cannot hold, and §11.1 states why that is survivable here and nowhere else |

### 2.1 Tested and excluded

Recorded because each looked like a fit, and because an exclusion nobody wrote down is an exclusion that will not hold.

| Candidate | Rejected to | Argument |
|---|---|---|
| Assignment, queues, deadlines, escalation, outcomes | **PS14** | Already built and already correct. A run *claims* a work item through PS14's interface under its three checks; a second board is the failure W-D describes, one plane over |
| Holding a tool implementation | The owning service | E3. Every tool is a service operation already exposed at MCP under T17. A tool that is not one has no authority model, no audit trail, and no owner |
| Outbound calls and capability grants | **PS9**, AE6 | P8's ceilings, limits, and reversal path. D41 places enforcement below the generated layer; putting it in the orchestrator puts it above (W7's argument, restated for actions) |
| Prompt and construct **content** for a domain | **PS11** | §16. A prompt is the easiest possible place for domain knowledge to enter core, precisely because it does not look like code |
| Versioning, diff, and lineage of constructs | **PS11** (see **E-E**) | The machinery exists. Constructs are versioned, effective-dated, materiality-classified and transfer-restricted — which is the pack shape item for item (D21, D24) |
| Transcripts, traces, tool-call logs, model reasoning | **PS7** | PS14 §4.4 already names *model reasoning* as never-an-event. T25 requires the classification envelope these carry personal data under |
| Binding calculation, "just this once, in the loop" | **AE3** | P3. The seam T14 exists to protect, and the one that would erode first under schedule pressure |
| Human task steps, approvals, forms | **AE1** | §16 again. A construct that models a client's approval chain is a business process in a platform service |
| Model fine-tuning, evaluation harnesses, prompt experimentation | — | No obligation in §2 requires them. They are a development practice, not a platform service, and the first thing that would grow this service into an ML platform nobody approved |

---

## 3. Three rules that make the boundary testable

Stated before the model, because the model is unremarkable and the boundary is the whole design. They are the direct analogue of PS14's W-rules and are meant to be read against them.

**E-rule 1 — the model proposes; a deterministic mediator admits or refuses; nothing else touches an effect.** There is exactly one code path from model output to a call, and it validates the schema, resolves the tool against the catalogue, checks autonomy, checks oversight, checks capability, and checks budget — in that order, refusing at the first failure. This is §9's determinism boundary made into a function with a name. If a second path exists, P3 and §11.1 are both decorative, and T14's warning has already come true.

**E-rule 2 — a tool is an existing service operation, exposed at MCP under the same checks as its human surface. The catalogue is a projection, never an authoring surface.** Adding a tool means adding an operation to a service, which means a recorded decision in that service's design. This is the admission test that stops the tool surface becoming a shadow API with its own authority model — T19's connector argument, one plane up. It also means PS15 ships with an empty tool implementation directory, permanently.

**E-rule 3 — an admitted action is recorded by the service that executed it; PS15 records only what has no other home.** A run that proposes a PS3 version is recorded by PS3. A run that transitions a work item is recorded by PS14. What no other service sees is the **refusal** — the action that never happened — and the run's own start and close. That is the whole of PS15's governance record, and it is why this service does not repeat the volume mistake PS14 §4.4 warns about. It is also why **PS15's run state is not a PS2 projection**, which is a deliberate departure from S1, R8 and W1 and is argued in §4.4.

---

## 4. The run

### 4.1 Envelope

```yaml
run:
  # identity
  run_id:             run-01J9F2K5…
  tenant_id:          tnt-aannemer-x
  construct:          ps11://construct/remediation-triage@7   # §7 — at a version, always
  construct_digest:   sha256:1f0c…

  # why it exists — never self-authored (E-rule 1, E8)
  raised_by:          work-service
  work_item:          wrk-8841              # the commitment this run discharges; null for read-only runs
  trigger:            policy                # §10.4's four

  # accountability — the same four fields PS2 demands at append (R1), plus the third principal
  accountable:        usr-j-dekker          # a human principal, always (P12). Never an agent
  acting:             agt-remediation-2     # the agent principal
  service_account:    svc-orchestrator-3    # separately resolvable (T2, PS14 §7)
  seat:               operations

  # authority — resolved at start, copied on, never accepted from a caller (§8)
  oversight_level:    O4                    # resolved by PS4
  autonomy_level:     a2                    # §11.1, resolved from the subject's grant
  onboarding_level:   n1                    # of the subject application (D26)
  tool_set:           tools-remediation-n1  # the resolved catalogue slice (§5.3)

  # ceilings — derived from policy, never entered (§8.2)
  ceiling:
    steps:            40
    wall_clock:       PT30M
    tokens:           2_000_000
    cost_eur:         12.00

  # state
  state:              running               # §4.3
  outcome:            null                  # write-once, mandatory at close

  # detail — never inline (§4.4)
  transcript_ref:     ps7://transcript/run-01J9F2K5…
  transcript_digest:  sha256:6b90…
```

**Four envelope rules, enforced rather than documented:**

1. **`accountable` resolves to a human principal and never moves.** P12, and PS14's identical rule. An agent in this field is a rejected write. A run is the most tempting place in the platform to lose this, because nothing about a run looks like it has a person in it.
2. **All four authority fields are resolved by PS15 from PS4, PS13 and PS11 — never accepted from the caller.** A run that could declare its own `autonomy_level` could raise it, which makes §6's checks decorative. This is PS14's second envelope rule, and it is load-bearing for the same reason.
3. **`autonomy_level` and `oversight_level` are the levels in force at start, copied on** — R2's rule. Promotion and demotion change the level; the record of what governed an action must not change with it.
4. **`outcome` is write-once and mandatory at close.** P11 applied to execution. A run that stops existing without a recorded outcome is indistinguishable from one that was never started, which is the failure §12.2's demotion evidence cannot survive.

### 4.2 The proposed action

The unit of the service. One per model turn that wants an effect.

```yaml
proposed_action:
  run_id:             run-01J9F2K5…
  step:               12
  proposed_by:        <provider>/<model>@<version>     # recorded always, §15.6
  tool:               specs-service.propose_version
  arguments_digest:   sha256:c41a…                     # arguments are transcript, not record

  # resolution — by the mediator, never by the model
  resolution:         refused                          # admitted | refused
  refused_at:         autonomy                         # schema | catalogue | autonomy | oversight
                                                       # | capability | budget | self_audit
  effect_ref:         null                             # e.g. ps3://specification/spec-4417@5
```

**`refused_at` is the field that earns this service its place.** It names which of the six checks stopped the action, which turns *"the agent tried something it was not allowed to do"* from an anecdote into a distribution over runs, constructs, seats, and autonomy levels. §12.2 needs exactly that and has no source for it today.

**A refusal is not a failure.** This is W6's argument for `escalated_out`, transposed. An A1 agent proposing an external write and being refused is the ladder working. A *rate* of such refusals rising against a construct is a signal about the construct; against a seat, a signal about the seat. Whether it counts as an adverse outcome for automatic demotion is **E-F**, and it should be answered with W6, not separately.

### 4.3 States

```
pending ──▶ running ──▶ completed
              │  ▲
              ▼  │
           waiting                     (on a human, a gate, or a lease)
              │
              ├──────▶ refused         (a check stopped the run, not merely an action)
              ├──────▶ failed          (substrate, provider, or construct error)
              └──────▶ expired         (ceiling reached, §8.2)
```

**Every terminal state carries one of five outcomes:** `done`, `proposed`, `refused`, `exhausted`, `failed`. `proposed` is separate from `done` on purpose — a run whose entire product is a PS3 version awaiting PS4 has not done anything yet, and conflating the two is how a board starts reporting acceptance it does not have.

### 4.4 What is an event, what is a payload, and why the store is not a projection

**Four event types on PS2, and no more:**

`RunStarted` · `ActionRefused` · `RunEscalated` · `RunClosed`

**Never events:** admitted actions, model reasoning, tool arguments, tool results, retries, token counts, step transitions, intermediate drafts. Under E-rule 3 an admitted action is already recorded by the service that executed it, so emitting it here is double-recording — and PS14 §4.4 already classifies model reasoning as a PS7 payload under T25's retention and erasure rule, which it needs anyway because a transcript routinely names people.

**PS15's run store is not a rebuildable projection over PS2, and this is a deliberate departure.** S1, R8 and W1 all require a service's store to be a projection over the spine. PS15 cannot satisfy that without emitting per-step events, which is precisely the volume failure PS2 §1 warns about and the one PS14 §4.4 is built to avoid. The resolution is a split, not an exception:

| | Home | Rebuildable from |
|---|---|---|
| Governance record — that a run happened, what it was refused, how it closed | **PS2** | Itself. This *is* a projection, and it satisfies R8 |
| Execution state — steps, retries, checkpoints, in-flight position | The durable execution engine (§11) | Nothing. It is operational state and it is allowed to be lost |
| Transcript — reasoning, arguments, results, drafts | **PS7**, classified | PS7's own guarantees |

The test is mechanical and belongs in the build gate: **drop the execution engine's state entirely, and every governance question about every historical run must still be answerable from PS2 and PS7 alone.** In-flight runs die; that is correct, and it is what makes the engine substitutable under §14.7.

---

## 5. The toolset

### 5.1 A tool is a service operation

T17 already puts UI, API and MCP on every service and engine. The platform's toolset is therefore **already built** — it is the union of those MCP surfaces — and PS15 contributes no tool of its own.

The consequences are worth stating because they are the whole point of E-rule 2:

- **A tool inherits its owning service's authority model.** `specs-service.propose_version` proposes under P13 because that is what the operation does for a human; there is no agent-specific variant with different semantics. PS14 §10 already established this posture — *"through the same interface an auditor reads and under the same three checks"* — and this generalises it from one service to all of them.
- **A tool an agent may call that a human may not call is a defect**, not a feature. It means an operation exists outside the interface the design says every service has.
- **Adding a tool is a service design change.** It goes through that service's document and gates. This is slow on purpose: an agent platform's failure mode is a tool surface that grows faster than anyone's ability to reason about what the agents can do.

### 5.2 The catalogue is a projection

PS15 holds a catalogue of tools — name, schema, owning service, the authority the operation asserts — and it is **derived from the services' declared MCP surfaces**, never authored. It is rebuilt on service registration and on version change. An entry with no live owning operation is dropped; a live operation with no entry is a registration failure, reported, not silently absent.

This is the same shape as PS14's store being a projection over PS2 and PS7's lineage being one graph: the thing that would rot is generated rather than maintained.

### 5.3 Resolution — what this run can see

A run's `tool_set` is resolved once, at start, from four inputs: the construct's declared requirement, the seat, the autonomy level, and the subject's onboarding level. **A tool outside the resolved set is not merely refused — it is not presented to the model at all.**

Both halves matter. Not presenting it is what keeps the model from spending steps proposing things it can never do. Refusing it anyway, if it is somehow proposed, is what makes the boundary a check rather than a presentation choice — a model that infers a tool name from context must hit the same wall as one that was told about it.

---

## 6. The mediator, and the determinism boundary

The six checks, in order, refused at the first failure:

| # | Check | Source | Refuses when |
|---|---|---|---|
| 1 | **Schema** | — | Arguments do not validate against the tool's declared schema |
| 2 | **Catalogue** | E-rule 2 | The tool is not in the run's resolved set (§5.3) |
| 3 | **Autonomy** | **§11.1**, §14 | The action's class exceeds `autonomy_level` — a write at A0, an outbound artifact at A1, an external effect at A2 |
| 4 | **Oversight** | §12.3, §12.5 | The seat may not act at this oversight level, or the action requires review the run has not obtained |
| 5 | **Capability** | **P8**, §11.2, **D41** | PS9 refuses. PS15 does not evaluate the grant; it makes the call and is refused, exactly as any other caller would be |
| 6 | **Budget** | §8.2 | The ceiling is reached. The run closes `exhausted`, not `failed` |

Plus one that is not a ladder: **self-audit** — a run may not resolve a tool that closes a work item whose subject is the run's own construct or seat. §12.5's audit of the governance review agent is meaningless if the governance review agent can close it, and PS14 §6.3 already rejects the transition at its end. Checking it here too is deliberate duplication: the check that matters is the one nearest the act.

**Three properties of the mediator, all of which are testable and none of which are conventions:**

1. **It is deterministic.** Same proposed action, same resolved authority, same result — no model involved in the decision to admit. This is what §9 asks for and what T14 says must be an interface.
2. **It is the only path.** The model-facing half of the service holds no client to any service, no credential, and no network egress except the model port. Enforced by process boundary and by network policy, not by review (§13).
3. **Refusal is an outcome, never a warning.** PS14 §5's rule, and the same argument: a check that logs and proceeds is not a check.

**What the model is allowed to be non-deterministic about is exactly one thing: which action to propose next.** Everything else in this service — what tools exist, what they mean, whether this one is allowed, what it costs, what gets recorded — is code.

---

## 7. Constructs are pack content

A **construct** is a workflow definition, a prompt, a tool binding, or a composition template. Constructs are versioned, effective-dated, carry a materiality classification, and transfer only as a dated snapshot if at all.

**That is the pack shape, item for item** (PS11, D21, D24), which is why constructs are a **pack kind** rather than a new artifact type in a new store. The machinery for versioning, supersession, effective dating, and materiality already exists and has already been argued. Building a second registry for prompts is the "two stores for one ledger" failure W-D names, arriving through a different door.

Three rules follow:

- **A run names a construct at a version, and the version is recorded on every proposed action.** Changing a prompt is a new version, not an edit. Without this, no run is reproducible and no refusal rate means anything, because the thing being measured changed underneath the measurement.
- **A construct carrying a domain term is pack content and lives in the tenant's pack** (§16). A construct that is domain-free — decomposition, retry shaping, evidence gathering — is platform content and lives in the platform's own pack. The test is the same one §16 always applies, and a prompt is where it will be violated first because prose does not look like code.
- **Constructs are the non-transferring half of PS11**, which the pack registry must be able to express. D21 already snapshots packs at exit; constructs need a `transfers: false` marking and an export path that omits them. This is a PS11 change and §15 records it.

**E-E is open**: PS3 is the other candidate, and it is not a weak one — it gives diff, lineage, and a gate on every change to a prompt, which is attractive for exactly the artifact most likely to be changed casually. The argument for PS11 is effective dating, materiality classification, and the exit snapshot, all of which PS3 lacks and all of which constructs need. It should be settled before build step 4, not after.

---

## 8. Authority, capability, and budget

### 8.1 PS15 resolves nothing itself

Oversight ceilings are PS4's (W8's rule, and for the same reason — two resolvers are two answers). Capability is PS9's. Autonomy grants are governed state on the subject application (D26's shape). Pack content is PS11's. **PS15 asks, copies the answer onto the run, and enforces it per action.**

The one thing PS15 adds that no other service can: **it checks at the act, not at the claim.** PS14 checks authority when a principal claims a work item, which is correct and is not sufficient — a run that claims legitimately can still propose, forty steps later, something the claim never contemplated. Two checks at two moments is not duplication; it is the difference between authorising a person and authorising an action.

### 8.2 Ceilings are derived, never entered

`steps`, `wall_clock`, `tokens` and `cost_eur` come from PS11 policy keyed on construct class × autonomy level × onboarding level — the same construction as PS14 §6.1's due dates, and for the same reason: a hand-entered ceiling is a limit nobody can audit against a policy.

**Until PS11 exists, these have no home that survives a pack version** — the identical problem PS14 records for its targets and the technical design records for PS4's ceilings, with the identical answer: the fields exist from the first build, the registry arrives with PS11.

**Ceiling exhaustion is a first-class outcome, not an error.** A run that stops because it hit its step budget has told you something about the construct. A run that stops because the provider timed out has told you something about the provider. Collapsing both into `failed` loses the only signal §15.6 asks for.

---

## 9. Tenancy, and the boundary that does not transfer

**Runs are tenant runtime data**, so T29 forbids a shared service from holding them: isolation is topological (T6) and per-tenant (T28) — schema per tenant at L1, own database at L2, exactly as PS3, PS4 and PS14. Transcripts inherit PS7's tenancy rather than defining their own.

**Fleet-wide constructs run as a parent in the platform tenant with a child run per affected tenant**, which is W12's shape and needs no special case under D39.

**PS15 is the only component that does not hand over, and that is its second reason to exist.** §13.5 commits that platform services are open-code and transfer; D20 promises continuity of *operation*, not of *generation*. Those two are consistent only if the generation machinery has somewhere to be. Today it does not, and the practical consequence is that orchestration would accrete into `specs-service` and `work-service` — both of which ship to the client.

| At exit | What the client gets |
|---|---|
| Every platform service, PS1–PS14 | Open code, running, with their data (P9) |
| Application repositories | Handed over (§13.5) |
| Standards packs | A dated snapshot; drift detection ends on that date (D21) |
| **Constructs and PS15** | **Nothing.** The applications keep running; nothing regenerates them (D20) |

That table is the whole of D20, and it becomes checkable rather than contractual the moment the last row has a single named home.

---

## 10. Interfaces

Per T17: UI, API, MCP — with one qualification, and one deliberate absence.

| Operation | Surface | Notes |
|---|---|---|
| `start(construct, subject, work_item?)` | UI, API, MCP | Authority and ceilings are **resolved, not accepted** |
| `get`, `list`, `query` | UI, API, MCP | Including the refusal distribution by `refused_at`, construct, seat, and autonomy level |
| `transcript(run)` | UI, API | Through PS7, under its classification and erasure rules. **Not MCP** — PS7 H14's posture, and a transcript is the densest personal data in the platform |
| `cancel(run, reason)` | UI, API | Closes `refused` with the reason recorded. A silent cancel is how a run disappears |
| `export(tenant)` | API | P9. Runs, refusals, outcomes — **never constructs** (§9) |
| *register a tool* | — | **Not exposed.** The catalogue is a projection (E-rule 2) |
| *set an authority field or a ceiling* | — | **Not exposed.** PS4, PS9 and PS11 resolve them |
| *author or edit a construct* | — | **Not exposed here.** PS11 (E-E) |

**P13 does not bind PS15's own writes, and this needs saying** — the same clause PS7 §9.1 needed and PS14 §10 needed. A run record asserts nothing about the world; it records that an attempt was made and how it was resolved. PS2 §6.3's ground, applied a third time. What a run *proposes through a tool* is bound by P13 exactly as any other write, and that is where the boundary sits.

**The UI is the refusal board, not a chat window.** The primary human surface for this service is the distribution of refusals and outcomes over constructs and seats — the thing §12.2 needs and cannot currently see. A conversational surface is S1 support (PS14's W-C) or AE5, not this.

---

## 11. Substrate

**Adopt the engine, build the contract** — T19's rule for PS7, applied here.

| Layer | Position |
|---|---|
| Durable execution — runs, steps, retries, timers, resumption | **Adopt** managed open source (T21). Temporal, Restate, or DBOS class. Behind the §4.4 contract, and substitutable under §14.7 |
| Mediator, catalogue, resolution, ceilings | **Build.** This is the service |
| Transcript storage | **PS7**, classified. Not a substrate choice |
| Governance record | **PS2** |
| Model access | **Port.** §11.1 below |

**The engine must not become the record.** Its state is operational (§4.4) and its own audit trail is not PS2's. A build gate proves this by deleting it.

### 11.1 The model port, and the one place T21 cannot hold

T21 says adopt managed open source, never a proprietary primitive, because §13.5 hands the platform services over. **A frontier model provider is a proprietary primitive with no open-source equivalent at the same capability**, so the rule cannot be satisfied here.

It is survivable in exactly this service and nowhere else, for a reason worth writing down: **PS15 does not hand over.** T21's justification is the exit promise; the one component exempt from the exit promise is the one component where the rule has no purchase. That is a narrow exemption with a stated ground rather than a convenience.

What still binds:

- **Provider and model version are recorded on every proposed action** (§4.2). §15.6's exposure becomes a number — how many constructs depend on which provider, at what version — rather than a paragraph.
- **The port is the interface §15.6 asks for.** *"Keep the composition plane behind a stable internal interface"* is a design instruction with no owner today; this is the owner.
- **No construct may depend on a provider-specific feature without a recorded decision.** Enforced at construct publication in PS11, not at runtime.

---

## 12. Build order and gates

| # | Step | Gate |
|---|---|---|
| 1 | The mediator and the catalogue projection | A proposed action naming an unregistered tool is **refused** and recorded with `refused_at: catalogue`. The catalogue is rebuilt from service registration alone, with no authored entry anywhere in the tree |
| 2 | Run envelope, four event types, PS7 transcript split | A run starts, refuses an action, and closes with an outcome — and every governance question about it is answerable **after the execution engine's state is deleted** |
| 3 | Autonomy, oversight and self-audit checks | An A1 agent proposing an external effect is refused with `refused_at: autonomy`; the refusal rate for that construct is queryable in one call; a governance-review run cannot resolve the tool that closes its own audit item |
| 4 | Constructs as pack content, at a version | Editing a prompt produces a new construct version; a run pins one; two runs of different versions are distinguishable in the refusal distribution |
| 5 | Ceilings, budget refusal, the model port | A run reaches its step ceiling and closes `exhausted` rather than `failed`; provider and model version are on every proposed action; swapping the provider changes no construct |
| 6 | PS14 integration | A run claims a work item through PS14 under its three checks, transitions it, and closes it with an outcome — and `accountable` is unchanged throughout, on both records |
| 7 | Composition plane on the same machinery | A specification generates through a construct, with every effect mediated — no second orchestrator, and the generated output proposes into PS3 rather than committing |

**Steps 1–3 are the ones that must not be reordered.** The mediator before anything that could bypass it; the record before anything worth recording; the checks before any agent has authority to exceed. §12.5's rollout order — *recording first, then demotion, then promotion* — applies here exactly as it does to PS14, and for the same reason: recording is the part that cannot be retrofitted.

**Placement in the platform build order.** PS15 is not first wave. It needs PS14 (step 6), PS11 (steps 4–5) and PS4 (step 3), and the technical design puts the composition plane in Phase 1. But **step 1 has no dependency beyond T17's MCP surfaces**, and building the mediator early is cheap insurance against the alternative — agents reaching services directly during Phase 0, which establishes exactly the second path E-rule 1 forbids.

**Dependencies: PS1** *(agent principals, T2)*, **PS2**, **PS7** *(transcripts)*, **PS4** *(oversight)*, **PS9** *(capability)*, **PS11** *(constructs, ceilings)*, **PS14** *(commitments)*. Nothing depends on PS15 except the composition plane and the platform's own agents.

---

## 13. Failure modes

| Failure | Detection | Response |
|---|---|---|
| **The mediator is bypassed** | An outbound call from the model-facing process; any effect with no `proposed_action` id | Network policy and process boundary, not review. This is the one failure that makes every other control in the service decorative |
| **The catalogue becomes an authoring surface** | A catalogue entry with no live owning operation; any tool implementation in the tree | CI: the tool implementation directory is empty, permanently (E-rule 2) |
| **Run state becomes the record** | PS2 event rate per run rising above four | Admitted actions are recorded by the executing service (E-rule 3). If the rate climbs, something is emitting per step |
| **Prompts become code** | A domain term in a platform construct; a construct in the repository rather than in a pack | §16, enforced at construct publication. This one will be violated first, because prose does not look like code |
| **A second orchestrator** | AE5 or the composition plane growing its own run loop | **E-H.** One mediator or the boundary is per-plane and therefore not a boundary |
| **The agent closes its own audit** | Subject identity equals acting identity on a `review` item | Refused at check 7 here and at the transition in PS14 §6.3. Deliberately checked twice |
| **Refusal logged and proceeded** | Any admitted action whose resolution was refused | Structurally impossible: refusal returns before the call exists. Asserted by test, not by review |
| **Transcript holds unclassified personal data** | PS7 rejects the write | Already handled by PS7 H4. Named here because a transcript is the densest personal data in the platform and the easiest to forget |
| **Provider lock-in arrives through a construct** | A construct depending on a provider-specific feature | Recorded decision at publication (§11.1). §15.6's risk becomes visible at authoring rather than at migration |
| **Ceilings collapse into "failed"** | `exhausted` count of zero across a fleet that is clearly hitting limits | Five distinct outcomes (§4.3). A single failure bucket destroys the only construct-quality signal the service produces |

---

## 14. Decisions

| # | Decision | Rationale |
|---|---|---|
| E1 | **PS15 holds runs and proposed actions; it authors no artifact, accepts nothing, and grants nothing** | The seam test. Authorship is PS3's, acceptance PS4's, capability PS9's, commitment PS14's. Everything left is the machinery around a model, and that is a service |
| E2 | **The model proposes; a deterministic mediator admits or refuses; there is exactly one path from proposal to effect** | §9 places the determinism boundary in the provided-never-generated layer and T14 says it must be an enforced interface. This is what enforces it. A second path makes P3 and §11.1 both decorative |
| E3 | **A tool is an existing service operation exposed at MCP; the catalogue is a projection, never an authoring surface** | T17 already built the toolset. A tool with no owning operation has no authority model and no owner — the defect T20 was strengthened to catch, on a surface that grows faster than any other |
| E4 | **PS15 holds no credential and performs no outbound call; capability is PS9's and is refused there** | D41 places capability enforcement below the generated layer. An orchestrator that also enforces puts it above, which is W7's conflation restated for actions rather than assignments |
| E5 | **Constructs — prompts, workflows, tool bindings, composition templates — are pack content at a version, and a run pins one** | §16: a prompt is where domain knowledge enters core first. Versioning makes runs reproducible and refusal rates meaningful, which they are not if the construct can change underneath the measurement |
| E6 | **A0–A4 is checked per action, not per run; PS14's check at claim is necessary and not sufficient** | §14 applies §11.1's ladder to the platform's own agents and nothing enforces it. A legitimate claim does not authorise every action forty steps later — authorising a principal and authorising an act are different operations |
| E7 | **Four event types on PS2; transcripts, arguments, results and reasoning are PS7 classified payloads** | PS2 §1's volume argument, applied to the service that would break it worst. PS14 §4.4 already classifies model reasoning this way, and T25 requires the envelope regardless |
| E8 | **An admitted action is recorded by the service that executed it; PS15 records only refusals, starts and closes** | The volume rule with a reason rather than a budget. It also means the refusal — the thing with no other home — is the service's distinctive output rather than a by-product |
| E9 | **PS15's run store is not a PS2 projection; the governance record is, the execution state is not, and the transcript is PS7's** | A deliberate departure from S1, R8 and W1, stated rather than taken. Satisfying them would require per-step events, which is the failure the rule exists to prevent. Proven by a build gate that deletes the engine's state |
| E10 | **The durable execution engine is adopted; the contract is built; the engine is substitutable and its state is disposable** | T19 and T21's pattern from PS7. §14.7 puts substitution in reversibility order, and an engine holding the only copy of a governance fact is not substitutable at any position |
| E11 | **PS15 is the only component that does not hand over; every other platform service stays open-code** | §13.5 and D20 are consistent only if the generation machinery has a home. Give it one and exit becomes a repository you do not ship; leave it homeless and it accretes into services that do ship |
| E12 | **The model provider is a proprietary primitive, exempted from T21 on the narrow ground that this service does not transfer; provider and version are recorded on every proposed action** | T21's justification is the exit promise, and this is the one component the exit promise does not cover. Recording the version turns §15.6 from a paragraph into a number |
| E13 | **Ceilings are derived from PS11 policy, never entered, and exhaustion is an outcome rather than an error** | PS14 §6.1's construction. Collapsing exhaustion into failure destroys the only signal about construct quality the service produces |
| E14 | **PS15 supplies the refused-proposal population §12.2 needs, alongside PS4's decisions and PS14's work** | Three populations, three services, one sampling frame. Above O2 an agent's refusals say more about it than its completions do, and nothing records them today |
| E15 | **Runs are tenant runtime data and are isolated per tenant; constructs are platform content and are never exported** | T29 and T28, and the §9 exit table. The two halves of this service have opposite tenancy and opposite transfer rules, which is worth stating once rather than discovering per feature |

---

## 15. Changes required elsewhere

*Recorded here, made upstream. This document does not edit its companions.*

**15.1 `technical-design.md` — PS15 as the fifteenth service.** §3's table, §3.1's build-or-adopt row (*build the contract, adopt the engine, and the one T21 exemption*), §3.3.2's tenancy map, §5.1's build order, and §5.2's engine order all need a PS15 row. New T-decisions for E2 (the determinism boundary has an enforcement point), E3 (the toolset is the MCP surfaces, not a plane), E11 (one non-transferring component), and E12 (the T21 exemption and its ground).

**15.2 ✅ Made in technical design v1.1 as §3.4 and T53.** The collision is resolved by the decision taking a free number rather than by renumbering T35. **§1.2 is unblocked and half-answered**: the rule places this service in the monorepo, and the part it does not decide — whether an import rule is sufficient for the one tree that does not hand over — is carried upstream as **T-X** and is a commercial judgement, exactly as §1.2 said. Import rule 5 is the mechanism, and it is stated as an **include** list by construction. *Still outstanding from this item: `R-C` open and `ES-1` stale in `eip-refactoring-requirements.md`.*

**15.3 `conceptual-design.md` §4.4 — the composition plane gains a service.** It has been described since v0.2 with no owner. §9's *"provided, never generated"* row should name what enforces the determinism boundary, since T14 requires an interface and an interface with no service is a convention.

**15.4 `conceptual-design.md` §11.1 — A0–A4 gains an enforcement point, and needs one sentence about which one.** The ladder is applied in two places: to *applications at runtime*, where enforcement is PS9 and the generated layer, and to *the platform's own remediation agents* (§14), where enforcement is PS15. The section currently reads as one ladder with one meaning.

**15.5 `conceptual-design.md` §13.5 — state that the non-transferring IP has a single home.** D20's promise is checkable once it does, and unfalsifiable while it does not.

**15.6 `ps11` (unwritten) — constructs as a pack kind.** Needs `transfers: false`, an export path that omits them, and the provider-dependency decision at publication (§11.1). Blocks build step 4. **E-E** must close first.

**15.7 `ps14-work-service.md` — W-E gains a counterpart.** W-E asks whether an agent may decompose work for other agents. PS15 distinguishes two decompositions that W-E currently reads as one: **commitments** (parent/child work items, PS14 §4.1's single level) and **execution steps** (within a run, PS15's). The second is not governed by W-E and never should be; the first is exactly what W-E is about. PS14 §7 should say which it means.

**15.8 `ps7-data-service.md` — the transcript payload class.** Transcripts are a new payload class with a retention rule, a `personal_data` default of `true`, and an erasure path. Nothing new is required of PS7 beyond an entry in its classification vocabulary, but it should be an entry rather than an assumption.

---

## 16. Open

- **E-A.** Repository placement — deferred (§1.2), and the exit boundary is the argument that decides it, not the code size.
- **E-B.** Whether budget ceilings are PS15's or PS9's. They look like capability grants (P8's *volume ceiling*) and are enforced per action like the rest of §6. Provisionally PS15's, because a token budget is not a reach and PS9 has no view of a run.
- **E-C.** Whether **A0–A4 and O0–O4 collapse into one ladder**. Two ladders govern the same agent at the same moment — autonomy over what it may do, oversight over how closely it is watched — and §11.1's own footnote records they were renamed to avoid *collision*, which is not the same as being independent. Probably right to keep them separate and definitely worth an explicit argument.
- **E-D.** Whether the mediator is one service-side component or also a client-side library for AE5. One component is cleaner; a library is what makes the boundary hold inside a generated application. Bears directly on E-H.
- **E-E.** **PS11 or PS3 for constructs.** PS11 for effective dating, materiality and the exit snapshot; PS3 for diff, lineage and a gate on every prompt change. Must close before build step 4.
- **E-F.** Whether a refused proposal is an adverse outcome for §12.2's automatic demotion. It is the ladder working, exactly as `escalated_out` is the correct N1 output — so the answer should be W6's and should be settled with it.
- **E-G.** Whether a run may start another run, and at what ceiling. The conservative default, unrecorded until this closes: it may not; it raises a work item and something else claims it. Inherits **W-E**.
- **E-H.** **Whether PS15 and AE5 are one deployable.** The platform's own orchestration and the agent runtime composed into a client's application share an engine, a mediator, and a determinism boundary — and have opposite tenancy, opposite transfer rules, and opposite planes. This is the PS2/PS7 shape and it is **the sharpest question this service raises**: one deployable risks a client's application depending on non-transferring IP, and two risks the determinism boundary being enforced twice and therefore differently.

*Inherited:* **W-E** (agent decomposition, carried as E-G), **T-J** (pack-supplied versus platform-provided — constructs are its third instance after PS8's channels and PS14's ladder), conceptual open question **O** (the user interface; §10's refusal board is a third partial answer), and **T14** as a standing constraint rather than an open question.

---

## 17. Change log

| Version | Date | Change |
|---|---|---|
| 0.2 | 2026-08-06 | **§1.2 unblocked and §15.2 closed** — the repository topology is written upstream as technical design §3.4 and **T53**, taking a free number rather than renumbering T35, so the collision this document reported no longer blocks anything. **The rule places this service in the monorepo and deliberately does not settle it**: a repository is earned by a consumer and PS15 has one, but it is also the only tree that never leaves (D20), so the exit boundary becomes **import rule 5** — nothing under the exported tree imports from `agent/*`, and the bundle is built from an **include** list rather than an exclude list. §1.2's own framing survives intact: whether *strictly weaker* is *too weak* is commercial rather than architectural, and it is carried upstream as **T-X** with one addition — **decide it before the first export bundle is built**, since an include list assembled around an existing leak is not a fix. Companion versions corrected; the `Realised as` line now states the placement and its open half. No obligation, check, rule, or boundary changed |
| 0.1 | 2026-08-05 | Initial design. PS15 established as the deterministic machinery around a model — the run, the mediator, the tool catalogue, the constructs, and the transcript — against four commitments with no enforcement point: §9's determinism boundary (which T14 requires to be an interface and which nothing implemented), §11.1's A0–A4 ladder as §14 applies it to the platform's own agents, §4.4's composition plane which has had no service since v0.2, and §13.5/D20's non-transferring IP which had no physical home. §2 derives thirteen obligations with sources and §2.1 records nine candidates tested and excluded to PS14, PS9, PS11, PS7, PS3, AE1 and AE3. **Three boundary rules** (§3): the model proposes and a deterministic mediator admits or refuses, with exactly one path to an effect (E2); a tool is an existing service operation and the catalogue is a projection, never an authoring surface (E3); an admitted action is recorded by the service that executed it, so PS15 records only refusals, starts and closes (E8). **Six checks at the act** (§6), with autonomy checked per action rather than per run because PS14's check at claim is necessary and not sufficient (E6). `refused_at` named as the field that earns the service its place, supplying the action-level population §12.2 lacks alongside PS4's decisions and PS14's work (E14). Constructs placed as pack content at a version (E5), with **E-E** open on PS11 versus PS3. **The run store is deliberately not a PS2 projection** (E9) — a stated departure from S1, R8 and W1, split three ways and proven by a build gate that deletes the execution engine's state. Engine adopted, contract built (E10); the model provider exempted from T21 on the narrow ground that this is the one component that does not transfer (E12), which is also E11 — PS15 as the single non-transferring home that makes D20 checkable. §15 records eight upstream changes including the **T35 numbering collision** between the PS7 design and the technical design, which blocks the repository decision. E-A to E-H opened, with **E-H** (whether PS15 and AE5 are one deployable) named as the sharpest |
