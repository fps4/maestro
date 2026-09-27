# work-service

**Repository:** `fps4/maestro`, [`work/`](../../work/) (until 2026-09-26 `fps4/maestro-work`, now archived) · **Status:** building · **Decisions:** [ADR-0009](../decisions/0009-one-severity-scale.md), [ADR-0012](../decisions/0012-the-application-owns-detection-maestro-owns-response.md), [ADR-0019](../decisions/0019-work-services-table.md) (the table)

Who owes what, by when, under whose authority — and whether it happened. The component that turns signals into commitments, checks authority when work is claimed, derives every clock from policy, and records every outcome. Its MCP server is the board agents work from.

## Three rules

1. **It holds commitments and computes their consequences in time. It does not decide what work should exist** — a signal, a person, a gate, or a recurrence raises an item — **and it does not optimise distribution.** First claim wins.
2. **A work item is not a proposal.** It asserts nothing; it records that someone owes an act, and its state changes are facts. Where an item's outcome needs acceptance, the proposal is made in specs-service and the item links to the accepted version. work-service has no accept operation and no versions.
3. **Authority is checked at claim and refused, never warned.** [governance-model.md](../governance-model.md#authority-at-claim).

## The work item

The head, as `fetch` returns it: a fold of the item's events ([ADR-0019](../decisions/0019-work-services-table.md) §4).

```yaml
item_id:            wrk-12                  # from the workspace's counter, so a person can say it aloud
class:              remediation             # change | objective | remediation | obligation | support | review
title:              Advisory GHSA-… (high) on app1/prod
about:              { application: app1, environment: prod }   # or { subject_type, subject_id }
parent:             wrk-3                   # optional
milestone:          wrk-2                   # optional: an objective with a date; the board groups by it
blocked_by:         [wrk-9]                 # given at publish; whether each still blocks is read from its head

raised_by:          signal                  # human | signal | gate | recurrence | run
raised_cause:       dependabot_alert        # the signal kind, decision or run
raised_by_principal: prn-w-…                # who recorded the raise (the intake workload, a person, a run)
fingerprint:        GHSA-…:acme/app1:semver # the signal's; dedup and correlation key
signals:            2                       # further signals attached inside the window
fold:               weekly_dependency_hygiene#2026-W39   # on a weekly obligation only
links:              { pull_request: "acme/app1#412", artifact: art-… }   # what arms merged_change / decision_accepted
consequence_class:  c2
definition_version: 3                       # the policy version everything below was resolved under

accountable:        prn-h-…                 # a human, always; never moves
assigned_to:        prn-a-…                 # the holder, while held
seat:               operations
oversight_level:    O2                      # the seat's, copied on

tier:               tier2                   # the application's, resolved at raise
onboarding_level:   n2
remediation_class:  patch                   # restore | configure | data_correction | patch | code_change
reversible:         true
evidence_plan:                              # each entry met by a fact, named to it
  - { kind: merged_change, satisfied_at: …, satisfied_by: "acme/app1#412" }
  - { kind: rescan_clear,  fingerprint: GHSA-…:acme/app1:semver }
  - { kind: deploy_event }

severity:           sev2                    # resolved from policy, never entered
opened_at:          2026-09-26T12:00:00Z
respond_by:         2026-09-26T14:00:00Z    # met by the first claim (responded_at)
resolve_by:         2026-10-03T12:00:00Z
review_by:          2026-10-26T12:00:00Z    # past it, the item closes `expired`
lease_expires_at:   …                       # while held
chase:              { ladder: standard, steps: [reminder, chase, escalate_accountable, escalate_steward], next: 2, to: prn-h-… }
breached:           [respond_by]            # recorded; never a closure

state:              in_progress
outcome:            null                    # done | superseded | escalated_out | refused | expired — write-once at closure
closed_at:          null
reason:             null                    # the words a closure gave, from its payload
revision:           5                       # the item's event count: the envelope's subject_seq
```

Envelope rules: `accountable` is a human and never moves; the authority fields (`severity`, the clocks, `tier`, `onboarding_level`, `accountable`, `oversight_level`) are resolved by the service from the workspace's definition, never accepted from the caller, and a publish naming one is refused with the field's name; `outcome` is write-once and mandatory at closure. Words (a title, a reason) are payloads, written before the transaction and named on the event by reference and digest ([ADR-0019](../decisions/0019-work-services-table.md) §4).

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
open ──▶ assigned ──▶ in_progress ──▶ resolved ──▶ closed (done, on evidence)
  ▲         │  ▲           │ ▲
  │         │  └── blocked ◀┘ │        a release or an expired lease returns a held item to open
  └─────────┴──────────────────┘
open ──▶ escalated ──▶ closed (escalated_out)     a claim refused at the onboarding check
any open state ──▶ closed (superseded · refused · escalated_out, with a reason; expired, past review_by)
```

`resolved` means the holder's act is done and the evidence is owed: the item closes `done` when the last fact of its plan is recorded, at once if the plan is already met or empty. `expired` is an outcome, recorded by the sweep past `review_by`, never a disappearance. There is no withdrawal: a raiser who retracts closes the item `superseded` with a reason. **`escalated_out` is the correct N1 output** for a fix maestro may not take, and its rate per application is a first-class number.

## Signals intake

`POST /signals` accepts the [envelope](../signals.md#the-envelope); adapters behind the intake port produce it from SNS (via SQS), EventBridge, GitHub webhooks, and the application's own monitor. Intake:

1. **dedups** by `fingerprint` within a policy window and **correlates** a storm into one item;
2. **resolves severity** from policy: signal kind × application tier, with the application's hint as input;
3. **raises** the item per the policy's signal → class mapping, or **satisfies** an evidence-plan entry on an open item (`state: ok`, a deploy, a re-scan);
4. records the signal as the item's `raised_cause`.

A signal that matches no policy row raises a low-severity `review` item, never nothing.

## Policy

The workspace's definition: seats, the steward, applications and policy, applied from the tenant's configuration repository (`workspaces/<workspace>.work.yaml`) by its pipeline; the demo's is [`work/config/workspaces/aannemer-x.yaml`](../../work/config/workspaces/aannemer-x.yaml), the schema `work/api/src/domain/definition.ts`. Each apply is a new `definition_version`, and every item records the version it was resolved under.

```yaml
seats:
  operations: { oversight_level: O2 }
  owner:      { oversight_level: O0 }
steward: prn-h-…                      # the ladder's escalate_steward reaches them; answers for items about nothing declared

applications:                         # tier and onboarding level move to runtime-service's register later
  - id: app1
    tier: tier2
    onboarding_level: n2
    accountable: prn-h-…
    environments: [staging, prod]
    repositories:                     # what the GitHub adapter reads; the environment a fix must reach
      - { repository: acme/app1, environment: prod, path: services/app1/ }   # path: when one repository builds several

policy:
  severity_map: { P1: sev1, P2: sev2, P3: sev3, P4: sev4 }
  default_severity: sev4
  clocks:                             # severity × tier → [respond_by, resolve_by]
    sev1: { tier1: [PT15M, PT4H], tier2: [PT30M, PT8H], tier3: [PT1H, P1D] }
  review_within: P30D
  lease: PT30M
  offered_to: { change: owner, objective: owner }
  default_seat: operations
  onboarding:                         # what the level permits anyone, by remediation class
    n1: [restore]
    n2: [restore, configure, data_correction, patch, code_change]
  ceilings:                           # an agent's, per seat, by level: at most what the level permits
    operations: { n1: [restore], n2: [restore, configure, patch] }
  advisories:
    critical: { class: remediation, resolve_within: P2D }
    high:     { class: remediation, resolve_within: P7D }
    medium:   { fold_into: weekly_dependency_hygiene }
    low:      { fold_into: weekly_dependency_hygiene }
  dedup_window: PT10M
  signal_classes: { alarm_state: remediation, dlq: remediation, drift: objective }   # and the rest of the defaults
  chase_ladders:
    standard: [reminder, chase, escalate_accountable, escalate_steward, breach]
  chase_ladder: standard              # the ladder every item with a resolve_by is chased on
```

`onboarding` is the application's limit for anyone and is checked first; `ceilings` is an agent's, per seat. A person in the seat may act up to the onboarding level; an agent only up to its ceiling. `alerts` is declared and read by nothing: maestro alerts on Today only ([ADR-0023](../decisions/0023-maestro-alerts-in-its-one-console.md)).

## Time

- Due dates derived, never entered: `respond_by` and `resolve_by` from severity × tier at raise, `review_by` from `review_within`. Breach from `opened_at` and the original severity. The first claim meets `respond_by`, which then never breaches.
- The chase ladder is policy. **Its steps before `breach` fire evenly across the window from `opened_at` to `resolve_by`**, step *i* of *k* at (*i* + 1) / (*k* + 1) of it, and the breach is `resolve_by` itself. None fire once the item is `resolved`: the act is done and evidence is owed. A step reaches the human holder, else the accountable human; `escalate_accountable` the accountable human; `escalate_steward` the workspace's `steward`. Each step is delivered through the notifier and recorded as `WorkItemChased` with whom it reached and what the delivery did; a missed step fires late, in order.
- The sweep (a scheduled function acting as the service's workload) reads what is due each minute: expired leases, breaches, ladder steps, and items past `review_by`, which close `expired`.
- Recurrence carries what nothing else holds: sampling schedules with a floor that cannot reach zero, rollback rehearsals, access reviews. **A recurring item cannot be closed by the subject it examines.** Not built in the MVP beyond the weekly fold.

## Assignment

Work is offered to a seat and claimed by a principal. A claim is held under a lease with a heartbeat; expiry returns the item to `open` with a recorded reason. The agent principal, the accountable human and the service account are three separately resolvable principals on every item. An agent-raised item inherits the raising seat's ceiling.

A claim runs the [three checks](../governance-model.md#authority-at-claim), and a refusal is a result, recorded and counted, never an error the caller can retry past:

| Check that failed | What happens to the item | Counted as |
|---|---|---|
| the remediation class is above what the application's onboarding level permits — a patch on N1 | escalated to the accountable human and closed `escalated_out`: maestro's commitment ends, the owner takes the act in their own process | `escalated_out` for the application, and a refusal by check and class |
| the principal does not hold the item's seat (`seat`), the seat's oversight level is O0 and the principal is an agent (`oversight`), or the class is above the agent's ceiling for the seat and level (`ceiling`) | stays `open` for a principal who may | a refusal by check and class |

The rate acceptance scenario W2 asks for — `escalated_out` per application — is one read of the workspace's tallies ([ADR-0019](../decisions/0019-work-services-table.md#3-access-patterns)).

## Evidence

Each `evidence_plan` entry names a fact and the event that satisfies it: `merged_change` (GitHub, for the linked pull request), `deploy_event` (the application's own pipeline, for the item's application and environment; runtime-service's register matches by digest later), `signal_ok` / `rescan_clear` (signals intake, for the item's fingerprint), `decision_accepted` (specs-service, for the linked artifact). An item closes `done` when all are satisfied; a person may close `refused` with a reason (the VEX case) or `escalated_out`.

An entry is **armed** — written as an expectation under the key its fact will carry — when every earlier entry of another kind is satisfied and its own key is known ([ADR-0019](../decisions/0019-work-services-table.md) §5). Plan order is the world's order: the deploy counts only after the merge. The one exception is [ADR-0024](../decisions/0024-a-repositorys-rescan-follows-the-merge.md): a re-scan and the deploy both follow the merge and not each other. A fact that arrives for an entry not yet armed matches nothing and is dropped, so an alarm that flaps back to OK before the fix is deployed does not close the item. A weekly fold's findings are one entry each, armed together, and clear in any order; a closed fold is not reopened.

## The board

The frontier (what is owed now, soonest first, with the next human touchpoint) and a board over the state machine, filtered by **milestone** and **application**: two views of one query. The board's last column is what closed since midnight UTC, with its outcome. `blocking` reads what an item waits on and what waits on it: `blocked_by` is given at publish only, and a blocker that closed — with any outcome — no longer blocks.

**Today** for a person: from specs-service, the decisions only they can take and the questions on what they wrote; from work-service, what they **owe** (they hold it, or answer for it with no person holding it), what they **oversee** (they answer for it while an agent holds it), and what a chase step **brought** them though they neither hold nor answer for it (a steward's). Every row carries its **marks**: the ladder step last fired (its name, its place — step 3 of 5 — and whom it reached) and the clocks breached. They are how maestro alerts in the MVP ([ADR-0023](../decisions/0023-maestro-alerts-in-its-one-console.md)).

## The record

Every event is the spine's envelope, staged in the same transaction as the head it moves and relayed from the outbox to the spine's archive and events topic. work-service relays under its own prefix, `work/`, beside specs-service's stream: a workspace slug may be shared by both (`fps4-ops`), and the spine's sequence is per workspace and per writer. The sealer seals `work/` with the rest. A rebuild replays a verified archive — every day holding events must be sealed — through the same fold the live path uses, and the heads, edges, tallies, expectations, fingerprints, folds and outbox read identically; memberships are grants and are re-applied.

## Interfaces

| Operation | Surface |
|---|---|
| `raise` (publish), `claim`, `release`, `heartbeat`, `transition` (the holder's moves between working states), `resolve`, `link` | console, API, MCP |
| `signals`, `facts`; the GitHub webhook; the SQS intake function for SNS and EventBridge | API (adapters), the `intake` seat |
| `get`, `list`, `query`, `frontier`, `board`, `blocking`, `rates`, `history` (an item's events on the record, oldest first: the timeline; read from the workspace's outbox rows, which a rebuild restores; an index by subject waits for the next projection version) | console, API, MCP |
| `list`, `query`, `annotate`, `export(workspace)` | not built in the MVP |
| *accept anything*, *set an authority field* | **not exposed** |

MCP (`/v1/workspaces/<ws>/mcp`, where `MCP_RESOURCE_URL` is set) implements the **tracker contract** — publish / fetch / claim / resolve / frontier / blocking — as the acceptance test; a skill written against that contract works unchanged. The contract, per workspace:

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
| notifier | log line | the step on the item, shown on Today ([ADR-0023](../decisions/0023-maestro-alerts-in-its-one-console.md)) |
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
