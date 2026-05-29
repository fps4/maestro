---
title: "Contract: the workspace write API (S2 — discuss, S3 — decide, plus M1 dispatch)"
status: current
last_updated: 2026-05-29
owners: [architect]
maestro:
  feature: workspace-write-api
  kind: technical_design
  task: US-0032
related:
  - docs/architecture/contracts/workspace-read-api.md
  - docs/architecture/components/workspace-backend.md
  - docs/architecture/decisions/0008-system-of-record-and-persistence.md
  - docs/architecture/decisions/0009-attribution-of-decisions.md
  - docs/architecture/decisions/0011-multi-surface-human-control.md
  - docs/architecture/decisions/0014-orchestration-runtime-langgraph.md
  - docs/architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - docs/architecture/decisions/0018-workspace-read-api-and-frontmatter-index.md
  - docs/architecture/decisions/0019-workspace-identity-component-auth-google-sso.md
  - docs/architecture/webapp-concept.md
  - docs/architecture/workspace-ux-design.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0010-draft-functional-spec.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0032-workspace-discuss-and-decide-m1.md
  - docs/roadmap/m1-spec-to-design.md
---

## Purpose

The concrete HTTP/JSON contract for the **write paths** from the workspace into the orchestrator — the
S2/S3 extension to [`workspace-read-api.md`](workspace-read-api.md) that the M1 scoping doc resolved
("**extend the existing contract additively**", Q3, 2026-05-28). Three endpoint families ship in M1:

1. **Dispatch** a new delivery task from the workspace "new task" form (US-0010 Q2 resolution).
2. **Post a comment** on a task or gate (S2 — Discuss).
3. **Decide a gate** — approve / request-changes / reject (S3 — Decide).

Each request becomes **exactly one attributed event** in the engine spine's log
([ADR-0008](../decisions/0008-system-of-record-and-persistence.md) /
[ADR-0009](../decisions/0009-attribution-of-decisions.md)); the workspace holds no authoritative state
([ADR-0015](../decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md)). Read-after-write is
served through the existing `GET` endpoints; this contract does not duplicate query shapes.

This is a **reference** doc (Diátaxis). It defines *the wire*, not the implementation.

## Scope

| In (S2/S3 + M1 dispatch) | Out (later) |
|---|---|
| `POST` of a task dispatch, a comment, a gate decision | Editing/deleting comments (append-only by design — events are immutable, ADR-0008) |
| Idempotency keys + optimistic concurrency on gates | Multi-role-holder quorum semantics (US-0017) |
| Role-authorized writes (architect, functional_reviewer) | Slack/Telegram-originated decisions (EP-04 is notification-only) |
| Anchored comments → `request_changes` triggers a server-bundled feedback hand-off to the spec/design agent | The **feedback-bundle internal shape** — surfaced by [US-0031](../../product/user-stories/EP-03-reviewer-surface/US-0031-workspace-ux-design.md) as an ADR candidate; this contract commits *to* bundling, not to its payload shape |
| The webapp identity handshake (delegated to the auth edge, ADR-0019) | The auth edge itself; production rejects the dev stub path (same rule as the read API) |

Everything not in this table is **out of scope** for M1 and will be added when the relevant story
opens. The webapp holds **no GitHub token and no authoritative state** — it calls this API only.

## Shared with the read API (no duplication)

These concerns are defined in [`workspace-read-api.md`](workspace-read-api.md) and apply unchanged:

- **Base path** `/api` (unversioned for S2/S3; same scope as the read API).
- **Identity** arrives at the boundary as a signed/trusted `X-Maestro-Identity: {email, sub}` header from
  the edge — `MAESTRO_DEV_IDENTITY` is the M1 dev stub; production rejects the stub.
- **Authorization is the register, not the IdP.** The identity maps to a `Participant` by `email`; the
  caller's product set is its register membership ([ADR-0011](../decisions/0011-multi-surface-human-control.md)).
- **Isolation is server-side and non-revealing.** A product the caller does not participate in returns
  **`404`** (existence not disclosed), never `403`.
- **Content type** `application/json; charset=utf-8` for both request and response bodies.

The write contract **adds two cross-cutting concerns** on top of the above: idempotency and optimistic
concurrency.

## Idempotency

Every write accepts a client-supplied `Idempotency-Key: <opaque>` header. The server records the key
per `(participant, endpoint)` and **returns the original response** on a retry with the same key (same
status, same body, same `event_seq`). Keys are remembered for **24 hours** (long enough to survive any
realistic client retry window; shorter than any natural request-tree).

A retry with a different body but the same key gets **`409 conflict` (`code: "idempotency_mismatch"`)** —
the client SHALL generate a fresh key for a substantively different request.

Why: every write is event-sourced; without idempotency a stuttering network can append duplicate
`comment.posted` or (worse) `gate.decided` events. The key collapses that to one event per intended
action.

## Optimistic concurrency (gate decisions only)

Gate-decision writes accept an `If-Match: <gate_seq>` precondition where `gate_seq` is the
`status.gate.seq` returned by the corresponding `GET` (a monotonic projection counter for that gate).
If the gate has advanced since the client last read it (e.g. another role-holder already decided in the
US-0017 multi-reviewer case, or the agent re-drafted past the client's view), the server returns
**`409 conflict` (`code: "gate_state_moved"`)** and the client re-reads.

Comments and dispatches do **not** require `If-Match` (comments are append-only; dispatch creates a new
aggregate).

## Endpoints

### `POST /api/products/{product_id}/tasks` — dispatch a new delivery task

The M1 intake. Backed by the workspace "new task" form per US-0010 Q2 (resolved 2026-05-28). A
`maestro` CLI seed is an alternate client of this same endpoint and SHALL produce indistinguishable
events.

```jsonc
// request
{
  "intent": "Add a CSV export endpoint on /reports; paged, RFC-4180 quoting, max 50k rows.",
  "repo": "fps4/maestro"          // OPTIONAL — when omitted, falls back to the product's default repo (ADR-0005)
}
```

```jsonc
// 201 Created
{
  "task_id": "run-9c2e…",
  "product_id": "maestro",
  "stage": "intake",                       // initial stage per data-model.md
  "ref": {
    "repo": "fps4/maestro",
    "branch": null,                        // assigned when the spec/design crew opens one (US-0010/US-0013)
    "commit": null
  },
  "event_seq": 248,
  "href": "/api/products/maestro/tasks/run-9c2e..."   // GET for the task (ships when the read API gains task detail)
}
```

- Authorization: the caller MUST be a **participant** in `{product_id}` with the **`architect`** role
  (M1 — architect-only dispatch; commercial-product PO dispatch is a later story).
- Validation: `intent` MUST be non-empty and ≤ **8 000 characters** (the LLM context still has room for
  context; truncate at the agent boundary if needed). Empty/oversize → `422`.
- Event emitted: `task.dispatched` — `{task_id, product_id, repo, intent, attributed_to}`.
  The agent stream picks up from this event; the orchestrator opens the `spec` stage
  ([LangGraph stage-wiring](../decisions/0014-orchestration-runtime-langgraph.md), US-0010).

> **The "new task" form is the only intake UI in M1.** A `maestro` CLI seed remains valid for ops
> scripts but hits the same endpoint with the same auth — there is one dispatch surface, not two.

### `POST /api/products/{product_id}/tasks/{task_id}/comments` — post a comment (S2)

A comment is **anchored** to an artefact location where possible (a spec criterion id, a design section
heading) — the discipline that makes the refinement loop tractable
([`workspace-ux-design.md`](../workspace-ux-design.md) §interaction-pattern, principle P4). A
free-text comment with no anchor is allowed as a fallback.

```jsonc
// request
{
  "body": "Criterion AC-3 is missing the empty-result case — what does the export return for 0 rows?",
  "anchor": {                              // OPTIONAL — server-validated if present
    "artefact": {
      "kind": "functional_spec",           // functional_spec | technical_design | pull_request_diff
      "ref": { "repo": "fps4/maestro", "branch": "maestro/run-9c2e", "commit": "abc1234", "path": "docs/.../spec.md" }
    },
    "locator": { "criterion_id": "AC-3" }  // shape varies by artefact kind — see "Anchor locators"
  },
  "in_reply_to": "cmt-72a…"                // OPTIONAL — thread reply
}
```

```jsonc
// 201 Created
{
  "comment_id": "cmt-83b…",
  "task_id": "run-9c2e…",
  "attributed_to": { "email": "you@example.com", "role": "architect" },
  "created_at": "2026-05-28T10:14:22Z",
  "event_seq": 251
}
```

- Authorization: the caller MUST be a **participant** in the product (any role). The role attribution
  on the event is the caller's role for that product (ADR-0009).
- Anchor validation: if `anchor.artefact.ref` does not match a known artefact for the task (the spec/
  design currently in flight, or the PR's diff in later milestones), the server returns
  **`422` (`code: "anchor_unresolved"`)**. Locator shape is artefact-kind-specific (see below).
- Event emitted: `comment.posted` — `{comment_id, task_id, anchor, body, in_reply_to, attributed_to}`.
- **No edit/delete.** A subsequent comment can supersede earlier text; the event log is append-only.

#### Anchor locators (per artefact kind)

| `artefact.kind` | `locator` shape | Notes |
|---|---|---|
| `functional_spec` | `{ criterion_id: "AC-N" }` or `{ heading: "<slug>" }` | EARS criterion id preferred; heading slug fallback for non-AC anchors (Notes, Out of scope) |
| `technical_design` | `{ heading: "<slug>" }` | Markdown heading slug — the M1 locator ([`workspace-ux-design.md`](../workspace-ux-design.md) §open-questions, resolved 2026-05-28). Renderer-assigned `{ block_id: "<id>" }` is a deferred refinement; see §known-limitations |
| `pull_request_diff` | `{ path, side: "old"\|"new", line: <int> }` | M2+ (not used by S2 comments on the spec/design gates) |

### `POST /api/products/{product_id}/tasks/{task_id}/gates/{gate_id}/decisions` — decide a gate (S3)

The decision surface for the **functional gate** (US-0010) and the **design gate** (US-0013) in M1.
The merge gate (US-0011, M2) uses this same endpoint with `gate.type = "merge"`.

```jsonc
// request
{
  "decision": "approve",                   // approve | request_changes | reject
  "rationale": "AC-1..AC-5 cover the export shape; the empty-result case from AC-3 is in.",
  // request_changes: rationale is required; server bundles the open anchored comments (see below)
  // reject: rationale is required and final — stage moves to blocked
}
```

```jsonc
// 200 OK
{
  "task_id": "run-9c2e…",
  "gate_id": "gate-1f0…",
  "gate": { "type": "functional", "decision": "approve", "seq": 12 },
  "attributed_to": { "email": "you@example.com", "role": "architect" },
  "decided_at": "2026-05-28T10:21:09Z",
  "event_seq": 263,
  "feedback_bundle_id": null               // present (non-null) only when decision == request_changes
}
```

- Authorization: the caller MUST hold the **resolved role for the gate's `(product_type, gate_type)`**
  per US-0012 + `config/reviewers.yaml`. Decisions from a non-eligible participant return **`403`**
  (this is the one place we *do* surface a permission error rather than 404, because the *task* exists
  and is visible to the caller — only the *decision authority* is denied).
- **Optimistic concurrency:** the client MUST send `If-Match: <gate.seq>` from the latest `GET`. A stale
  `seq` → `409 (gate_state_moved)`; the client re-reads and retries.
- Idempotency: `Idempotency-Key` is REQUIRED on decisions (the most consequential write).
- Event emitted: `gate.decided` — `{gate_id, task_id, type, decision, rationale, attributed_to, feedback_bundle_id?}`.
  The orchestrator resumes the LangGraph stage (ADR-0014) from this event.

#### `request_changes` — the feedback-bundle hand-off

When `decision == "request_changes"`:

1. The server **collects the task's open anchored comments** (anchored to the artefact under review,
   not previously addressed) into a **feedback bundle** identified by `feedback_bundle_id`. The bundle's
   payload shape is pinned in [ADR-0020](../decisions/0020-feedback-bundle-payload-shape.md)
   (structured anchored list + top-level rationale; unanchored comments roll into rationale with
   provenance).
2. The bundle is delivered to the responsible agent (spec / design) through the orchestrator. This
   contract commits to *bundling at decision time* and the `feedback_bundle_id` in the response; the
   bundle's payload shape and the agent's response event (`agent_response.posted`,
   [ADR-0022](../decisions/0022-agent-response-event.md)) live in their own ADRs.
3. The agent re-drafts and publishes a new revision, then emits `agent_response.posted` with per-anchor
   replies (`addressed` / `deferred` / `rejected` + a one-sentence note each) and a `summary_of_changes`
   (ADR-0022). The next reviewer visit defaults to the **diff-of-artefact since their last review**
   (US-0031, US-0032).

`reject` is final for M1 (moves the task to `blocked`, US-0020); `approve` advances the stage.

## Event emission summary

| Endpoint | Event(s) appended | Stage effect |
|---|---|---|
| `POST .../tasks` | `task.dispatched` | new task → `intake` (then `spec` once the agent picks it up) |
| `POST .../comments` | `comment.posted` | none (comments do not advance state) |
| `POST .../gates/.../decisions` (approve) | `gate.decided` (decision=approve) | stage advances (`spec`→`design`, `design`→`build`, `build`→`done`) |
| `POST .../gates/.../decisions` (request_changes) | `gate.decided` (decision=request_changes) + `feedback_bundle.created` | stage stays; agent re-draft cycle |
| `POST .../gates/.../decisions` (reject) | `gate.decided` (decision=reject) | stage → `blocked` |

Every event carries `attributed_to: {email, role, product_id}` per ADR-0009. The projection
([`orchestrator/projection.py`](../../../orchestrator/projection.py)) is the single reader; the read
API surfaces the result.

## Error model (write-specific additions)

The shared error envelope and codes from [`workspace-read-api.md`](workspace-read-api.md#error-model)
apply. Write-specific codes:

| HTTP | `code` | When |
|---|---|---|
| 201 / 200 | — | write succeeded; body carries the new resource id and `event_seq` |
| 400 | `bad_request` | malformed JSON / missing required fields |
| 403 | `forbidden_role` | the caller is a participant of the product but lacks the role required to decide this gate |
| 404 | `not_found` | the product / task / gate is not visible to the caller (or doesn't exist — never disclosed) |
| 409 | `idempotency_mismatch` | same `Idempotency-Key`, different body |
| 409 | `gate_state_moved` | gate decision with a stale `If-Match: <gate.seq>` |
| 409 | `gate_already_resolved` | the gate is no longer `pending` (e.g. another role-holder approved it) |
| 422 | `validation_failed` | `intent` empty/oversize; comment body empty; rationale missing on request_changes/reject |
| 422 | `anchor_unresolved` | the anchor's `ref` does not match a known artefact for the task |

`401 (unauthenticated)` and `502/503 (degraded)` carry over from the read contract unchanged.

## Engine-spine changes M1 needs for this contract

These ride under [US-0032](../../product/user-stories/EP-03-reviewer-surface/US-0032-workspace-discuss-and-decide-m1.md)
(write-path endpoints) and [US-0010](../../product/user-stories/EP-01-delivery-loop/US-0010-draft-functional-spec.md)
(dispatch). They are **not** a separate card.

1. **Three new event kinds** in the event log: `task.dispatched`, `comment.posted`, `gate.decided`
   (with `request_changes` carrying `feedback_bundle_id`), plus `feedback_bundle.created`.
   The projection (`TaskState`) gains a `gates[]` block with per-gate `seq` for the `If-Match` rule.
2. **An idempotency table** in the SQLite store: `(participant, endpoint, idempotency_key) → (response_status, response_body, event_seq, created_at)`, TTL-purged after 24h.
3. **A LangGraph `interrupt()` resumer** ([ADR-0014](../decisions/0014-orchestration-runtime-langgraph.md))
   that wakes a stage's `interrupt()` from the projection observing the `gate.decided` event — the join
   point of the engine and surface streams.
4. **Role-resolution server-side** — the workspace-write-api calls `RoutingResolver`
   ([`config/reviewers.yaml`](../../../config/reviewers.yaml)) to check the caller's role against the
   gate before accepting. The same resolver US-0012 uses; one resolver, not two.

The HTTP binding stays stdlib `http.server` for consistency with the read API
([`workspace-read-api.md` §engine-spine-changes](workspace-read-api.md#engine-spine-changes-in-this-slice));
FastAPI remains a drop-in if the surface grows.

## Known limitations (M1)

- **Single role-holder per decision.** M1 assumes the architect (or a single functional reviewer)
  decides; the multi-role-holder quorum semantics (US-0017) layer on top of `If-Match` later.
- **No live updates / WebSocket push.** The workspace polls or revisits the read endpoints; a live
  channel is a later concern.
- **No comment edit / delete.** Events are immutable; supersession is by a new comment, not an edit.
- **Anchor locators are spec-centric in M1.** PR-diff locators (line-anchored review) belong to M2
  (US-0011 / merge gate); the table above already names the M2 shape so the contract is forward-
  compatible.
- **`technical_design` anchoring is heading-slug-only in M1.** Renaming a heading on a design breaks
  any anchored comment that targeted it ([`workspace-ux-design.md`](../workspace-ux-design.md)
  §open-questions, resolved 2026-05-28). Acceptable at dogfood scale; a renderer-assigned `block_id`
  locator that survives heading renames is the deferred refinement when designs grow more elaborate.
- **Feedback-bundle payload shape** is pinned in [ADR-0020](../decisions/0020-feedback-bundle-payload-shape.md);
  the **agent's response** in [ADR-0022](../decisions/0022-agent-response-event.md). This contract owns
  the trigger and the id (`feedback_bundle_id` on `gate.decided`); the bundle's contents and the
  response's contents live in those ADRs.
- **No batch writes.** One event per request; clients SHALL NOT compose multi-event writes. If batching
  becomes needed, it lands as `POST .../batch` rather than overloading these endpoints.
