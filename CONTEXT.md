# Context — the vocabulary

One meaning per word, across every component and document. If a component needs a word not here, it is added here first.

## Who

| Term | Meaning |
|---|---|
| **Principal** | Anyone or anything that acts and is recorded: a **human**, an **agent** (an AI process acting under a human's accountability), or a **workload** (a deployed service acting for itself). Every principal has a maestro id; no record ever stores an identity provider's subject. |
| **Accountable** | The named human answerable for a decision, a work item or a run. Always a human; never moves when work is reassigned. |
| **Acting** | The principal that performed an act. May be an agent. Recorded separately from the accountable human. |
| **Seat** | A role in a process that a principal occupies — operations, owner, reviewer, decider. Which kind of principal may occupy a seat, and how far it may act alone, is the seat's **oversight level**. |
| **Oversight level** | O0 human only · O1 agent proposes, human acts · O2 agent acts, human approves before effect · O3 agent acts, human may intervene · O4 agent acts, human notified. A seat's level is recorded on every act; some seats have a **ceiling** nothing can raise. |
| **Tenant** | The party whose applications and records these are. By default a tenant is one deployment of maestro. |
| **Workspace** | The isolation boundary inside a component — its own database, its own configuration. A tenant has one or more. |

## What is agreed

| Term | Meaning |
|---|---|
| **Artifact** | A thing specs-service holds: a specification, a business case, an intake assessment, a cause analysis. Its **type** is configuration, not code. |
| **Draft** | The mutable working copy of an artifact. Edited by anyone authorised, agents included. |
| **Version** | An immutable snapshot of a draft, proposed to a gate. Versions are the record. |
| **Facet** | A structured, evaluable field of an artifact (a status, a list, a table). Facets are evaluated; the **body** is read. |
| **Gate** | A named point where a version is decided: accepted, changes requested, rejected. Gates are configuration. |
| **Decision** | A human's recorded outcome at a gate, with the version's digest. Agents never decide. |
| **Question** | A doubt raised on a version; a gate may require all questions resolved before acceptance. |
| **Pinned link** | A link from one version to a specific version of another artifact, frozen at acceptance. |

## What is owed

| Term | Meaning |
|---|---|
| **Work item** | A commitment: someone owes an act, by when, under whose authority. Six **classes**: change, objective, remediation, obligation, support, review. |
| **Signal** | A fact from outside that may raise a work item: an alarm, an advisory, a deploy, a finding, silence. Normalised into one envelope. |
| **Severity** | SEV1–4, resolved from policy (signal kind × application tier), never typed in. |
| **Policy** | The tenant's rules: severity × tier → clocks; agent ceilings by class; chase ladders; SEV↔P mapping. Configuration in work-service. |
| **Claim** | A principal taking a work item. Authority is checked at claim and refused, never warned. |
| **Evidence plan** | The facts that must exist for an item to close `done` — a merged change, a deploy event, an alarm back to OK. Satisfied by events, not by typing "done". |
| **Outcome** | Write-once at closure: done, superseded, escalated_out, refused, expired. |
| **Milestone** | A dated objective several items roll up to; the board groups by it. |

## What runs

| Term | Meaning |
|---|---|
| **Application** | A system a tenant runs and maestro observes. Has a **criticality tier** and an **onboarding level**. |
| **Onboarding level** | N0 observed · N1 operated · N2 governed · N3 integrated · N4 regenerated. What maestro may do *to* an application; the ceiling for remediation. The MVP uses N0–N2. |
| **Artifact (deployed)** | What was built: an image or bundle with a digest, a version, an SBOM, and a known-good rollback target. Held in the ledger. |
| **Instance** | One artifact digest running in one environment of one application. Held in the register. A running digest the ledger does not know is a hard stop. |
| **Deploy event** | The fact that an artifact became an instance — from the tenant's pipeline via EventBridge. |
| **Consequence class** | How much a thing matters if wrong. Carried on every item and instance from the first build; read in full only by the regulated branch. |

## What agents do

| Term | Meaning |
|---|---|
| **Run** | One agent execution against one subject (an item or a draft): principal, ceiling, plan, steps, next human touchpoint, outcome. |
| **Runner** | What executes a run — GitHub Actions with Claude Code, under an agent principal. agent-service records; it does not run. |
| **Transcript** | The full reasoning and tool traffic of a run. A classified payload in S3, never an event; readers are a role. |
| **Ceiling** | What a run may do at most: steps, time, cost, and the classes of act it may take on an application at its onboarding level. |
| **Sampling** | A person reads one run in N. The floor is never zero. |

## The record

| Term | Meaning |
|---|---|
| **Event** | An attributed fact a component emitted: who, under whose accountability, at what oversight level, about what. Structural body only; anything personal is a payload reference with a digest. |
| **Outbox** | The component's transactional queue of events, drained by the relay. |
| **Archive** | The S3 store every event lands in, sealed into daily segments with a hash chain computed in code. The system of record. |
| **Projection** | Any component's database. Rebuildable from the archive; dropped and rebuilt as a build gate. |
| **Export** | The archive, its manifests, and the verifier — readable with every service off. The exit. |
| **Classification** | A label on every payload and transcript saying what it may contain and how long it is kept. |
