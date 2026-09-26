# work-service

**Repository:** `fps4/maestro`, [`work/`](../../work/) (until 2026-09-26 `fps4/maestro-work`, now archived) · **Status:** building · **Decisions:** [ADR-0009](../decisions/0009-one-severity-scale.md), [ADR-0012](../decisions/0012-the-application-owns-detection-maestro-owns-response.md), [ADR-0019](../decisions/0019-work-services-table.md) (the table)

Who owes what, by when, under whose authority — and whether it happened. The component that turns signals into commitments, checks authority when work is claimed, derives every clock from policy, and records every outcome. Its MCP server is the board agents work from.

## Three rules

1. **It holds commitments and computes their consequences in time. It does not decide what work should exist** — a signal, a person, a gate, or a recurrence raises an item — **and it does not optimise distribution.** First claim wins.
2. **A work item is not a proposal.** It asserts nothing; it records that someone owes an act, and its state changes are facts. Where an item's outcome needs acceptance, the proposal is made in specs-service and the item links to the accepted version. work-service has no accept operation and no versions.
3. **Authority is checked at claim and refused, never warned.** [governance-model.md](../governance-model.md#authority-at-claim).

## The work item

```yaml
work_item:
  item_id:            wrk-8841
  workspace_id:       ws-aannemer-x
  class:              remediation          # change | objective | remediation | obligation | support | review
  subject_type:       instance
  subject_id:         ins-app1-prod
  parent:             wrk-8790             # a milestone, a fleet parent, or null
  milestone:          wrk-8700             # an objective with a date; the board groups by it

  raised_by:          signal               # signal | human | gate | recurrence | run
  raised_cause:       sig-01J9F2K5…        # the signal, decision, or run
  consequence_class:  c2                   # carried; read only by ceilings in the MVP

  accountable:        prn-h-jdekker        # a human, always; never moves
  assigned_to:        prn-a-remed-2        # human or agent
  seat:               operations
  oversight_level:    O2                   # resolved at assignment, copied on

  onboarding_level:   n2                   # of the subject application — resolved from runtime-service, never accepted
  remediation_class:  patch                # restore | configure | data_correction | patch | code_change
  reversible:         true
  evidence_plan:      [ merged_change, deploy_event, signal_ok ]

  severity:           sev2                 # resolved from policy, never entered
  opened_at:          2026-09-18T08:12:00Z
  respond_by:         2026-09-18T09:12:00Z
  resolve_by:         2026-09-19T08:12:00Z
  chase_ladder:       standard@3
  recurrence:         null
  review_by:          2026-10-18

  state:              in_progress
  blocked_by:         []
  links:              { pr: "https://github.com/…/pull/412", analysis: "spec://cause_analysis/ca-118@2" }
  outcome:            null                 # done | superseded | escalated_out | refused | expired — write-once at closure

  payload_ref:        s3://…/work-item/wrk-8841
  payload_digest:     sha256:6b90…
```

Envelope rules: `accountable` is a human and never moves; the authority fields are resolved by the service from runtime-service and policy, never accepted from the caller; `oversight_level` is copied on; `outcome` is write-once and mandatory at closure.

Every person and agent on an item — `accountable`, `assigned_to`, the `acting` of each event — is an identity-service principal id, the `prn` claim its tokens carry (`prn-h-…` a human, `prn-a-…` an agent, `prn-w-…` a workload). work-service mints no ids for principals; it keeps a registry of the ones it has seen so the relay can check `accountable` is a human.

## Six classes

| Class | Raised by | Closes on |
|---|---|---|
| `change` | a person, a gate, the intake agent later | an accepted version in specs-service, or a recorded decline |
| `objective` | a person; drift signals | a deploy event; a dated milestone with children |
| `remediation` | signals; a person | the evidence plan satisfied, or escalated out |
| `obligation` | recurrence; policy (the weekly advisory fold) | the deadline met, or breached and recorded |
| `support` | a named person in the tenant | resolution, or a `change` / `remediation` child |
| `review` | recurrence; every SEV ≤ 2 closure | the review performed and its finding recorded |

## States and outcomes

```
open ──▶ assigned ──▶ in_progress ──▶ resolved ──▶ closed
            │              │ ▲
            │              ▼ │
            │           blocked
            ▼
        escalated ─────────────────────────────▶ closed
```

Plus `expired` (past `review_by`) and `withdrawn` (the raiser retracted). Every path to `closed` carries one outcome. **`escalated_out` is the correct N1 output** for a fix the engine may not take, and its rate per application is a first-class number.

## Signals intake

`POST /signals` accepts the [envelope](../signals.md#the-envelope); adapters behind the intake port produce it from SNS (via SQS), EventBridge, GitHub webhooks, and the application's own monitor. Intake:

1. **dedups** by `fingerprint` within a policy window and **correlates** a storm into one item;
2. **resolves severity** from policy: signal kind × application tier, with the application's hint as input;
3. **raises** the item per the policy's signal → class mapping, or **satisfies** an evidence-plan entry on an open item (`state: ok`, a deploy, a re-scan);
4. records the signal as the item's `raised_cause`.

A signal that matches no policy row raises a low-severity `review` item, never nothing.

## Policy

Configuration in the workspace definition, supplied from the tenant's `policy.yaml`:

```yaml
policy:
  severity_map: { P1: sev1, P2: sev2, P3: sev3, P4: sev4 }
  clocks:                       # severity × tier → respond_by, resolve_by
    sev1: { tier1: [PT15M, PT4H], tier2: [PT30M, PT8H], tier3: [PT1H, P1D] }
    sev2: { tier1: [PT1H, P1D],  tier2: [PT2H, P2D],  tier3: [PT4H, P5D] }
  advisories:
    critical: { class: remediation, resolve_within: P2D }
    high:     { class: remediation, resolve_within: P7D }
    medium:   { fold_into: weekly_dependency_hygiene }
    low:      { fold_into: weekly_dependency_hygiene }
  ceilings:                     # per seat, per remediation class, by onboarding level
    agent_remediation: { n1: [restore], n2: [restore, configure, patch] }
    merge: { n2: { patch_level_bump_when_green: agent } }
  chase_ladders:
    standard: [reminder, chase, escalate_accountable, escalate_steward, breach]
  alerts: { slack_on_raise_at_or_above: sev2 }
```

Fields exist from the first build so a registry can take them over later.

## Time

- Due dates derived, never entered. Breach from `opened_at` and the original severity.
- The chase ladder is policy; each step is delivered through the notifier and **both** the delivery and the act (or its absence) are recorded.
- Recurrence carries what nothing else holds: sampling schedules with a floor that cannot reach zero, rollback rehearsals, access reviews. **A recurring item cannot be closed by the subject it examines.**
- Expiry is a recorded outcome, never a disappearance.

## Assignment

Work is offered to a seat and claimed by a principal. A claim is held under a lease with a heartbeat; expiry returns the item to `open` with a recorded reason. The agent principal, the accountable human and the service account are three separately resolvable principals on every item. An agent-raised item inherits the raising seat's ceiling.

A claim runs the [three checks](../governance-model.md#authority-at-claim), and a refusal is a result, recorded and counted, never an error the caller can retry past:

| Check that failed | What happens to the item | Counted as |
|---|---|---|
| the remediation class is above what the application's onboarding level permits — a patch on N1 | escalated to the accountable human and closed `escalated_out`: maestro's commitment ends, the owner takes the act in their own process | `escalated_out` for the application, and a refusal by check and class |
| the principal's seat may not act at this oversight level, or the class is above the agent's ceiling | stays `open` for a principal who may | a refusal against the seat |

The rate acceptance scenario W2 asks for — `escalated_out` per application — is one read of the workspace's tallies ([ADR-0019](../decisions/0019-work-services-table.md#3-access-patterns)).

## Evidence

Each `evidence_plan` entry names a fact and the event that satisfies it: `merged_change` (GitHub), `deploy_event` (runtime-service), `signal_ok` / `rescan_clear` (signals intake), `decision_accepted` (specs-service). An item closes `done` when all are satisfied; a person may close `refused` with a reason (the VEX case) or `escalated_out`.

## The board

The frontier (what is owed now, by whom, with the next human touchpoint) and a kanban over the state machine, filtered by **milestone** and **application**. Two views of one query. "Today" for a person: decisions waiting on them in specs-service, questions, items they owe, runs they are accountable for.

## Interfaces

| Operation | Surface |
|---|---|
| `raise`, `claim`, `release`, `transition(state, outcome?)`, `annotate` | console, API, MCP |
| `signals` | API (adapters) |
| `get`, `list`, `query`, `frontier`, `board`, `blocking`, `rates` | console, API, MCP |
| `export(workspace)` | API |
| *accept anything*, *set an authority field* | **not exposed** |

MCP implements the **tracker contract** — publish / fetch / claim / resolve / frontier / blocking — as the acceptance test; a skill written against that contract works unchanged. The contract, per workspace:

| Operation | Input | Returns | Refuses |
|---|---|---|---|
| `publish` | `class`, `title`; what it is about (an application and environment, or a subject); optionally `parent`, `milestone`, `blocked_by`, `remediation_class`, `severity_hint`, an `evidence_plan` from the fixed vocabulary; a caller's `key` that makes a retry return the same item | the item as raised — id, severity, clocks, accountable, evidence plan | an authority field in the input (`severity`, a clock, `onboarding_level`, `accountable`, `oversight_level`) — those are resolved, never accepted; a correctness-shaped commitment on an N1 application |
| `fetch` | `item` | the item, each evidence entry with the fact that satisfied it, its clocks, its edges, the next human touchpoint | — |
| `claim` | `item` | `claimed`: the item and the lease's expiry — or `refused`: the check, the sentence, and the item as the refusal left it | nothing: a refusal is an answer |
| `resolve` | `item`, `outcome` — `done`, or `refused` · `escalated_out` · `superseded` with a `reason` | the item. `done` marks the act performed: the item is `resolved`, and closes `done` when its evidence plan is satisfied — at once if it already is | `done` from anyone but the holder; any outcome on a closed item |
| `frontier` | optionally `for` (`me`, or a principal), `application`, `milestone`, `limit` | rows soonest-due first: id, class, about, accountable, acting, state, severity, due, next human touchpoint | — |
| `blocking` | `item` | `blocked_by` — the open items it waits on — and `blocks` — the items waiting on it | — |

Outside the contract, for the principal holding an item: `heartbeat` (renew the lease), `release`, `link` (a pull request or a specs-service artifact — what arms `merged_change` and `decision_accepted`), `block`. Against the acceptance scenarios: the advisory lane (W5) runs through intake and evidence with no agent, and so needs none of these; the refused claim is `claim`'s `refused`; the rate is the tallies. A run that opens a pull request needs `link`, which is the one addition the contract is likely to want.

## Ports

| Port | Local default | AWS |
|---|---|---|
| record sink | outbox in DynamoDB | relay → spine |
| notifier | log line | SES; Slack webhook |
| signals intake | HTTP | SQS from SNS / EventBridge / GitHub |
| authority resolver | policy in the definition | + runtime-service for the instance's level and tier |
| object storage | MinIO | S3 |

## Acceptance

The MVP's acceptance scenarios W1–W6 ([roadmap](../roadmap.md#acceptance)).

1. An item is raised, assigned, closed with an outcome, and read back identically after the workspace is dropped and rebuilt from the archive.
2. A patch-class claim on an N1 application is refused at claim, closes `escalated_out`, and the rate is queryable in one call.
3. A deadline-bearing item chases, escalates and breaches on schedule; every step's delivery is recorded.
4. An agent claims an item; its lease expires; the item returns to `open` with a reason; `accountable` unchanged throughout.
5. The advisory lane end to end without an agent: advisory → item → Dependabot's PR → a person's merge → deploy event → re-scan → `done` on evidence; medium and low findings fold into one weekly obligation.
6. A skill written against the tracker contract runs its acceptance suite green against the MCP server.

## Failure modes

| Failure | Detection | Response |
|---|---|---|
| it becomes a ticket tracker | a field or class with no rule above | reject at review |
| the board becomes the record | a `change` closed `done` with no linked accepted version | impossible by construction |
| event volume tracks activity | events per workspace per day | notes are payloads; find what emits per keystroke |
| clock gaming | reopen rate inside the window | breach from the original severity |
| assignment read as authorisation | an agent acts holding only an item | the act is refused where it lands; recorded |
| the audit closes its own audit | closer equals subject on a `review` | rejected transition |
