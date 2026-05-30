# Idempotency & ordering — the end-to-end contract

**Status:** engineering note (US-0024 cross-cutting). Names one contract that three mechanisms each
implement a slice of, so a change to any one is checked against the whole.

## Why this note exists

The event log is the universe: it is the system of record (ADR-0008), the audit tier (ADR-0009), the
merge authority (ADR-0016), the webhook sink (ADR-0017), and the substrate the bundle/response
projections read (ADR-0020/0022). **Three different idempotency mechanisms** sit on top of it, each
born in its own ADR:

1. **Workspace writes** — client-supplied `Idempotency-Key` (workspace-write-api.md).
2. **Orchestration runtime** — the LangGraph checkpointer (ADR-0014).
3. **GitHub ingestion** — webhook redelivery dedup on `X-GitHub-Delivery` (ADR-0017).

They were specified separately. A bug in any one corrupts everything downstream, and nobody had
written down how they compose. This note is that single description. (US-0024 found only #1 and #2
were actually contracted; #3 was the missing layer, now added to ADR-0017.)

## The one invariant

**Every external stimulus produces its intended event(s) exactly once, in a total order, and the
event log is the sole authority for "did this happen."** Each mechanism is a *guard at one entry
point* that upholds this invariant; none of them is the authority — the log is.

## The three layers

| Layer | Entry point | Dedup key | What a retry returns / does | Authority |
|---|---|---|---|---|
| **Workspace write** | `POST /api/.../{dispatch,comments,decisions}` | `(participant, endpoint, Idempotency-Key)` | the **original response**, verbatim; a same-key/different-body retry → `409` | the `idempotency_keys` table → event already appended |
| **Runtime** | `dispatch` / `resume_for_*` re-invoked on the same `thread_id` | `thread_id == task_id` (the checkpointer) | resumes from the **checkpoint**, does not re-run completed nodes | a **rebuildable cache** (ADR-0014) — the log is truth, not the checkpointer |
| **Webhook** | the single receiver | `X-GitHub-Delivery` | a redelivery is a **no-op** (fact already appended) | the event log → fact recorded once |

## Ordering

- **The event log's `seq` is the one total order.** Everything reconciles to it: the projection folds
  events in `seq` order (projection.py); gate optimistic-concurrency uses the opener's `seq` as the
  `If-Match` token (workspace-write-api.md); the merge boundary checks an approval event's `seq` is
  unconsumed (ADR-0016).
- **Appends are serialized** by the single writer (SQLite single-writer today; the SQLite→Postgres
  cutover, ADR-0008, must preserve a single logical append order).
- **The checkpointer never reorders the log.** It can lag or be rebuilt from the log; it is never read
  as the source of "what happened."

## How they compose (worked cases)

- **Double-clicked approval** → same `Idempotency-Key` → layer 1 returns the original response; the
  `gate.decided` event exists once; the runtime resumes once.
- **Network retry of a merge decision after the event landed** → layer 1 short-circuits *before* the
  gate-state precondition, so the retry succeeds idempotently even though the gate has since closed.
- **GitHub redelivers `pull_request.closed(merged)`** → layer 3 sees a known `X-GitHub-Delivery` → no
  second `pr.merged`; the projection's `merged` stays true; no duplicate `done`.
- **Process restart mid-task** → layer 2 rebuilds the projection from the log, re-attaches the graph at
  its checkpoint; no node re-runs its side effects, because the producer events are already in the log
  and the harness keys on them.

## Invariants any change must keep

1. A guard **upholds** the once-only invariant; it is never the **authority** for it — the log is.
2. A dedup key is stable for "the same stimulus" and distinct for a different one (layer 1's
   same-key/different-body → `409` is the canonical enforcement of this).
3. New write entry points declare which layer guards them **before** they ship — no fourth, undocumented
   idempotency model.

## Related

ADR-0008 (system of record), ADR-0009 (audit/WORM + hash-chain), ADR-0014 (LangGraph checkpointer),
ADR-0016 (merge authority), ADR-0017 (webhook ingestion + redelivery dedup),
ADR-0020/0022 (bundle/response projections), workspace-write-api.md (`Idempotency-Key`),
[US-0024](../product/user-stories/EP-02-engine-foundation/US-0024-engine-hardening-review-gaps.md).
