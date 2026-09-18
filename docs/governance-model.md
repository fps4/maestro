# Governance model

Who may do what, how far an agent may go alone, and where the ceilings are. This is what [work-service](components/work-service.md) reads at claim and what every record carries.

## Oversight levels — who occupies a seat

A **seat** is a role in a process: operations, owner, reviewer, decider. Its **oversight level** says how far an agent occupying it may act alone.

| Level | Who acts | Who decides | Human posture |
|---|---|---|---|
| **O0** | human | human | full involvement |
| **O1** | agent proposes, human acts | human | in the loop |
| **O2** | agent | human, before effect | in the loop |
| **O3** | agent | agent; human may intervene before effect | on the loop |
| **O4** | agent | agent; human reviews after | out of the loop, alerted |

Rules:

- The level in force is **recorded on every act**, copied on, never joined to current configuration.
- **Demotion is immediate** on an adverse outcome: a refused act, a reversed remediation, a breach, a reopened item. Demotion is faster and cheaper than promotion, and it takes effect on the next act, not the next token refresh — the level is read from seat occupancy, never carried in a token.
- **Sampling above O2** starts at 100% and decays to a floor that is never zero. A seat with zero sampling is not supervised; it is believed.
- **Promote in order of error visibility**, not frequency: triage classification and restore-class remediation first; anything invisible until an audit last or never.
- The MVP ships at **O0–O2**. Recording exists from the first build; promotion machinery does not.

## Ceilings

Some seats never rise above a ceiling, regardless of performance:

| Seat | Ceiling | Why |
|---|---|---|
| Accepting a cause analysis | O2 | what the fix is built on |
| Merging a change to a production application | O2 (patch-level bumps on N2: O3 under policy) | irreversible past the deploy |
| Deciding an onboarding level | O2 | commits maestro's liability and the tenant's money |
| Confirming a severity reclassification | O2 | resets every clock |
| Triage classification, restore-class remediation | O4 | cheap, immediately visible errors |

**Consequence class sets the ceiling.** The same seat carries a different ceiling on an internal tool and on a system that files to a government endpoint. The MVP carries `consequence_class` on every item and instance and reads it only here; the regulated branch reads it everywhere.

## Accountability

- **`accountable` is a human and never moves.** Assignment moves work; it never moves accountability. An agent in the field is a rejected write.
- **`acting` is whoever performed the act** — a human, an agent, or a workload — and is recorded separately.
- An agent principal, the human accountable for it, and the service account it runs under are three separately resolvable principals on every act.

## Onboarding levels — what maestro may do to an application

| Level | Name | maestro holds | The tenant keeps |
|---|---|---|---|
| **N0** | observed | telemetry, inventory, a gap register; read-only | everything |
| **N1** | operated | + triage, incident response, reversible remediation within the application's shape | change control, source, architecture |
| **N2** | governed | + change control: every change gated, evidence produced; agents may merge under ceilings | source and architecture |
| N3, N4 | integrated, regenerated | not in the MVP | |

Levels are per application, not per tenant. N1 forever is a legitimate end state. The level lives on the instance in [runtime-service](components/runtime-service.md) and is what the authority check reads.

## Remediation classes and the authority rule

| Class | Examples | Reversible | Minimum level |
|---|---|---|---|
| **restore** | restart, failover, re-run, scale, roll back | yes | N1 |
| **configure** | flag, threshold, credential rotation | usually | N1 (owner approval where behaviour changes) |
| **data correction** | fix or replay records | sometimes | N2; never autonomous where the value is binding |
| **patch** | dependency and security updates, no behaviour change | via rollback | N2 |
| **code change** | a behavioural fix | no | N2 |
| **structural** | substitute a platform service | no | N3 — out of MVP |

Two rules:

1. **Remediation authority never exceeds the onboarding level.** The correct N1 output for a fix the engine may not take is an escalation to the owner with a recommendation — recorded, because the pattern of them is the argument for N2.
2. **maestro takes no remediation it cannot both reverse and evidence.**

## Authority at claim

Three checks, when a principal claims an item, refused rather than warned:

1. the item's remediation class ≤ what the application's onboarding level permits;
2. a correctness-shaped commitment is not offered on an N1 application (checked at raise);
3. the claiming principal's seat may act at the item's oversight level, within its ceiling for this class.

**Refusal is an outcome, never a warning.** The item closes `escalated_out` or returns to `open`, and the refusal is recorded against the seat. **Assignment grants no capability**: holding an item says *you owe this act*; what the principal may reach is a separate grant, checked where the act lands.

## Capability

An application maestro observes already has capability maestro did not grant and cannot revoke. Two kinds, distinguishable on sight:

- **attested** — declared at intake, verified by observation where possible, not enforceable: everything an application already has;
- **granted** — issued by maestro for something it controls (a GitHub App token scoped to draft PRs; a runner's role): bounded, limited, revocable.

The MVP inventories the first and issues very little of the second.

## Change control

| Kind | Approval |
|---|---|
| cosmetic | owner |
| behavioural | owner + regression pass |
| assumption-breaking (the purpose no longer holds) | back to the owner as a `review` item |

Regulatory-affecting change and exception handling against standards belong to [branch R](beyond-mvp.md#branch-r--the-regulated-domain).
