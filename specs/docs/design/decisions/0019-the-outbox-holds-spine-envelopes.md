---
title: "0019: the outbox holds spine envelopes; seat occupancy names the answerable human"
summary: "The record sink's events become maestro's spine envelope at emit time, inside the transaction, validated by the spine's own rules — not translated later by a relay. Four things the old event lacked are decided here: who is accountable when an agent acts (the human named in the agent's seat occupancy — no occupancy, no act), what seat and oversight level an event carries (the seat the operation was authorised under; its level from the occupancy), how free text leaves the body (a digest now, a payload reference when the object store exists), and the principal id format (maestro's, with the kind in it). The relay carries; it never decides."
status: proposed
last_updated: 2026-09-20
date: 2026-09-20
related:
  - ./0005-agents-may-author-never-decide.md
  - ./0002-identity-service-is-the-only-dependency.md
  - ../architecture.md
  - https://github.com/fps4/maestro/blob/main/docs/components/spine.md
  - https://github.com/fps4/maestro/blob/main/docs/decisions/0003-the-spine-is-an-archive-and-a-queue.md
---

## Context

The record sink (architecture §5) is a transactional outbox: every state change emits an event in the
same transaction, with a per-workspace sequence assigned there. Its event is
`{sequence, workspace, kind, subject, actor, payload, occurred_at}` — enough to prove the stream
exists and is ordered, which is what the local default had to prove.

maestro's spine is now in code (`fps4/maestro`, `spine/`) and its relay refuses anything that is not
its envelope: `event_id` (UUIDv7), `workspace_id`, `seq`, `subject_type` / `subject_id` /
`subject_seq`, `type` / `type_version`, `occurred_at` / `recorded_at`, four attribution fields
(`accountable` — a human, always; `acting`; `seat`; `oversight_level`), `consequence_class`,
`causation_id` / `correlation_id`, a `body` of tokens only, and an optional `payload_ref` +
`payload_digest`. Six rules are enforced at append; a refused event stops its workspace's relay where
it stands, by design.

Our event has an actor and a payload. It does not say who is answerable when the actor is an agent,
under which seat or oversight level the act happened, or what the consequence class is; two of its
payloads carry free text (`VersionWithdrawn.reason`, `DecisionRefused`'s reasons and messages); and
our principal ids (`prn-<12 chars>`) do not carry the kind maestro's do (`prn-h-…`, `prn-a-…`,
`prn-w-…`), which is how the spine tells a human from an agent without a registry call.

Somebody has to fill the gap. Either the relay does, by joining outbox rows to whatever the registry
and the definition say *at relay time*, or the service does, at the moment of the act. The spine's
third rule — `oversight_level` is copied on at the act, never joined to current configuration — has
already answered that.

## Decision

### 1. The outbox row is the envelope

`emit()` builds a spine envelope inside the caller's transaction and validates it with the spine's
own `assertEvent` before insert. What the relay reads is what the archive will hold; the relay carries
and never translates. The row keeps its bookkeeping (`delivered`, `delivered_at`, `attempts`) beside
the envelope. `sequence` becomes `seq`, still from the per-workspace counter in the same transaction
(the database is the workspace, so the counter already is). `event_id` is minted at emit;
`recorded_at` is the emit time; `occurred_at` stays the act's time.

The service depends on `@fps4/maestro-spine` for the envelope, the rules and the relay handler. The
dependency is one package and it is the one whose rules we must not paraphrase.

### 2. Who is accountable: the seat occupancy

Every act happens under a **seat** — the role the operation was authorised by: `author` (propose,
withdraw), `reviewer` (raise, answer a question), `decider` (decide, resolve a question),
`workspace_admin`. Every seat in a workspace has an **occupancy** per principal that may act in it,
and the occupancy carries what the token never does (maestro, identity-service: *oversight level is
never a token claim*):

```yaml
seats:
  author:    { oversight_level: O1 }        # an agent may propose; a human acts on it
  reviewer:  { oversight_level: O1 }
  decider:   { oversight_level: O0 }        # human only (ADR-0005); an agent occupancy is refused
  workspace_admin: { oversight_level: O0 }
occupancy:
  - { seat: author, principal: prn-a-drafter-1, accountable: prn-h-jdekker }
```

- A **human** acting in a seat is answerable for the act: `accountable = acting`.
- An **agent** acting in a seat is answerable to the human its occupancy names: `accountable` is that
  human, resolved at the act and copied on. **An agent with no occupancy in the seat cannot act** —
  the request is refused and the refusal recorded, the same line as a decision naming an agent
  (ADR-0005). The occupancy's `accountable` must resolve to a human; the definition validator refuses
  otherwise.
- `oversight_level` is the seat's level in force at the act, copied on. A `decider` seat is `O0` and
  admits no agent occupancy; the validator enforces both.
- For a **decision**, the attribution profile's `accountable`, `acting`, `seat` and `oversight_level`
  are the envelope's — the profile already requires the first two and may require the rest — and
  they must agree with the occupancy (the decider is a human occupying `decider`).

Until identity-service's registry carries seat occupancy (maestro M1: `SeatOccupancyChanged`), the
workspace definition declares it, as above. Configuration is the domain model (ADR-0001); when the
registry takes over, the definition's `occupancy` block becomes a validation error rather than a
source, and the events do not change shape.

### 3. Consequence class

The workspace definition declares `consequence_class` for the workspace and may override it per
artifact type. Every event about a version carries its type's class; events not about a version
(none today) carry the workspace's. The service reads it nowhere else — as maestro's MVP intends.

### 4. Subjects, types, bodies

- **Subject** is the version, always: `subject_type: version`, `subject_id: <artifact>@<ordinal>`,
  `subject_seq` a per-subject counter kept in the outbox transaction — so one version's timeline
  (proposed, questioned, decided, superseded) is one subject stream, and a reader replaying it has
  optimistic concurrency for free.
- **Type** is the kind as emitted today, `type_version: 1`: `VersionProposed`, `VersionWithdrawn`,
  `VersionSuperseded`, `DecisionRecorded`, `DecisionRefused`, `LinkPinned`, `QuestionRaised`,
  `QuestionAnswered`, `QuestionResolved`. maestro's first-wave table in `spine.md` used draft names
  for three of these; it follows this record. `PayloadErased` is declared and not yet emitted.
- **Body** is the payload with free text removed, narrowed by a per-type schema registered with the
  spine (`TypeSchemas`, keyed `Type@1`):
  - `VersionWithdrawn.reason` → `reason_digest`. The text stays in the version document and moves to
    a `payload_ref` when the object-storage adapter exists (M1); nothing free-text enters a body,
    ever.
  - `DecisionRefused` → `{ gate, outcome, refused_for: [may_not_decide | gate_closed | attribution],
    unmet: [requirement ids], attribution_fields: [field names] }`. The sentences go to the response
    and the log, not the record.
  - Everything else already passes the floor: ids, digests, enums, ordinals, principal ids.
- **Causation and correlation.** One `correlation_id` per request, minted at the edge (HTTP, MCP,
  CLI). Events emitted together in one transaction chain by `causation_id` to the first of them —
  `VersionSuperseded` and `LinkPinned` are caused by the `DecisionRecorded` they follow.

### 5. Principal ids carry the kind

Ids minted by this service take maestro's form: `prn-h-…` human, `prn-a-…` agent, `prn-w-…`
workload — our `service` kind is maestro's `workload`. Lower-case Crockford after the kind letter.
Ids are minted here only until identity-service's registry mints them (ADR-0002 already says the
registry is theirs); the format is decided now so nothing minted meanwhile needs rewriting.

### 6. The relay

`OutboxSource` over every workspace database: `pending(limit)` reads undelivered rows across
workspaces oldest-first, `ack` marks them delivered. The relay is the spine's `relayHandler` on a
scheduled Lambda in this repository's Terraform module (M1), attaching the spine module's
`relay_policy_json` and reading its `relay_environment`. A refused event stops that workspace — the
report names it, and relay lag is the alarm; nothing here retries past it or drops it.

## Consequences

- The record and the projection can never disagree on attribution, because attribution is fixed in
  the transaction that made the change. There is no relay-time lookup to drift.
- The **rebuild gate** (maestro M1: drop a workspace database, rebuild from the archive) becomes
  meaningful: everything the projection needs is in the envelope or referenced from it.
- Agents need an occupancy before they can propose. That is a configuration line per agent per
  workspace today, and a registry row later. An agent that shows up with a valid token and no
  occupancy is refused — loudly, on the record.
- The `decider` seat cannot be occupied by an agent, which is ADR-0005 restated as a validator rule.
- Existing outbox rows and principal ids are development data; there is nothing to migrate. Workspace
  definitions gain `seats`, `occupancy` and `consequence_class`; the validator (`workspace:validate`,
  a DoD gate) refuses a definition without them.
- The refusal event loses its prose. An operator reads the response or the log for the sentence; the
  record holds what was unmet, by id.

## When to revisit

When identity-service's registry carries seat occupancy — the `occupancy` block leaves the definition
and nothing else changes. When an event needs a subject that is not a version (a workspace-level act,
a lineage-level act) — add the `subject_type`, not a second stream. When a body needs a sentence —
it does not; it needs a `payload_ref`.
