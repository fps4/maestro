---
title: "0022: the principal id is identity-service's `prn`"
summary: "A verified token's `prn` claim — the maestro principal id identity-service mints (its ADR-0022) — is the id this service writes on every record; it mints none of its own for a real identity, and a token without one is refused. An identity first seen before this, under an id minted here, is refused until an operator runs `principal:adopt`, which moves the grants to the new id and records the old→new mapping forward on the registry; the record that names the old id — the archive, sealed by day, and the projection held equal to it — is not rewritten, and the rules that ask 'the same person?' read the mapping."
status: accepted
last_updated: 2026-09-25
date: 2026-09-25
amends:
  - ./0019-the-outbox-holds-spine-envelopes.md
related:
  - ./0002-identity-service-is-the-only-dependency.md
  - ./0020-the-payload-store-and-the-rebuild.md
  - ../architecture.md
  - https://github.com/fps4/maestro/blob/main/docs/components/identity-service.md
---

## Context

ADR-0019 §5 gave this service's principal ids maestro's form (`prn-h-…`, `prn-a-…`, `prn-w-…`) and
said they were minted here "only until identity-service's registry mints them". identity-service now
does: its ADR-0022 mints the maestro principal id for every user and credential and signs it into
every token as `prn` (with `principal_kind`), and its own record names people by it.

This service still minted its own id on first sight of `(issuer, subject)`. So one human had two
ids — maestro's first deployment found it at its M1 gate: the architect's token carried one `prn-h-…`,
and this service had registered the same person under another, which is the id its gate-1 events
carry in the archive. Two components' records that cannot be joined on the person is the thing a
principal id exists to prevent.

## Decision

### 1. The token's `prn` is the principal id

The `jwks` verifier reads `prn`, checks it against the spine's grammar
(`^prn-[haw]-[a-z0-9][a-z0-9._-]{0,62}$`), and takes the principal's kind from its letter — `w`, a
workload, is our `service`. A `principal_kind` claim that contradicts the letter is a token that
contradicts itself, and is refused. **A token without `prn` is refused** (401) rather than given a
locally minted id: minting one is exactly how the second id came about. That makes identity-service
with its record wired a requirement of a `jwks` deployment, which it already is of maestro.

The registry keeps its shape: `(issuer, subject) → principal`, the subject stored only on the mapping
item, never on a record. What changes is who chooses the id — on first sight the principal is
registered **under the `prn`**. A `prn` already registered for another identity is refused, and an
operator looks.

The development verifier (`AUTH_MODE=dev`) accepts an optional fifth part, `dev:<name>:<kind>:<roles>:<prn>`,
and without it still mints on first sight — a laptop has no identity-service to ask.

### 2. The operator's grant names the `prn`

`workspace:member` takes `--prn`, and requires it for an identity the registry has not seen, except
the development issuer's. The grant is still resolved exactly as the first request would resolve it.

### 3. An identity registered under an old id: refused, then adopted

When a token's `prn` differs from the id the registry already holds for its `(issuer, subject)`, the
request is refused (403), and the refusal names the command that aligns them:

```
npm run principal:adopt -- --issuer <iss> --subject <sub> --prn <prn-…> [--dry-run]
```

Re-pointing silently at request time was the alternative. It was not taken because moving who holds
a grant is an operator's act, and a refusal until the one-off command has run costs one deployment's
one human a minute.

`principal:adopt` changes what is **not** record, and nothing that is:

- **The registry**, in one transaction, each write conditioned on what was read: the principal under
  the `prn`, with `supersedes: [<old id>]`; the old principal item **kept**, marked `superseded_by`
  (records name it, and a reader still resolves it to a name); the `(issuer, subject)` mapping
  re-pointed.
- **Memberships**, in every workspace: a grant held by the old id moves to the new one (refused if
  the new id already holds one there); a membership naming the old id as an agent's answerable
  human is re-pointed, and so is an agent principal's `operated_by`. Memberships are grants, not
  record (ADR-0020), so nothing is emitted.
- **Not the record.** Versions, decisions, evaluations, questions and the outbox name the old id, as
  the archive does. The archive is append-only and sealed by day, and the projection is held equal
  to it by the rebuild gate (ADR-0020); rewriting either would break both. The old→new mapping is
  recorded **forward**, on the registry.

It is idempotent — a second run finds the registry aligned and moves any grant left behind — and
`--dry-run` prints the plan and writes nothing, so it can be read against a live table first.

### 4. "The same person" reads the mapping

A principal carries the ids it `supersedes`, and the rules that ask whether two ids are one person
ask it of those too: separation of duties (`exclude_proposer`, `exclude_creator`), a routing table or
an assignment naming the old id, and the proposer's withdrawal. Without this, a person could decide
on what they created under their old id.

## Consequences

- One human is one id across identity-service's record and this one from the first act after the
  adoption; the acts before it name the old id, and the registry says whose it is.
- The mapping lives on this service's registry, not on the spine. An auditor reading the archive
  with the service off sees the old id on those early events and no statement joining it to the
  `prn`. That was already so — no event ever registered the old id either — and it is bounded to the
  acts before the adoption. Putting the alias on the record is a spine event type of its own; see
  below.
- A rebuild (ADR-0020) is unaffected: principals are control items, not projection, and survive it.
- `jwks` deployments need identity-service with its record wired (its `MAESTRO_*` configuration);
  without it every token is refused, loudly.
- ADR-0019 §5's "minted here only until" is discharged; its format stands.

## When to revisit

When an auditor needs the alias on the record — then a principal-alias event (subject a principal,
not a version), emitted by `principal:adopt`, is a spine type and a new `subject_type`, as ADR-0019's
revisit clause foresees. When identity-service exposes the enumeration endpoint the maestro
component page lists for M2 — the registry can then reconcile against it instead of learning a
principal only on first sight.
