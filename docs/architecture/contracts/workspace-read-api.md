---
title: "Contract: the workspace read API (S1 — read-only specs)"
status: current
last_updated: 2026-05-29
owners: [architect]
maestro:
  feature: workspace-read-api
  kind: technical_design
  task: US-0030
related:
  - docs/architecture/components/workspace-backend.md
  - docs/architecture/decisions/0018-workspace-read-api-and-frontmatter-index.md
  - docs/architecture/decisions/0019-workspace-identity-component-auth-google-sso.md
  - docs/architecture/decisions/0017-github-app-and-webhook-ingestion.md
  - docs/architecture/decisions/0010-public-engine-private-instance-data.md
  - docs/architecture/data-model.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0030-reviewer-webapp-and-wiki.md
---

## Purpose

The concrete HTTP/JSON contract between the **workspace** (the Next.js webapp) and the **orchestrator**,
for **S1 — Read** ([webapp concept](../webapp-concept.md)): render functional specs and technical
designs **read-only, across branches, annotated with live status**. This is the contract
[ADR-0018](../decisions/0018-workspace-read-api-and-frontmatter-index.md) decided in principle and
[`workspace-backend.md`](../components/workspace-backend.md) shaped into components; this doc pins the
endpoints, JSON, identity handshake, and error model so the build slice has a fixed target.

It is a **reference** doc (Diátaxis). It defines *the wire*, not the implementation (framework is an
engineering detail — likely FastAPI, `CODEBASE.md`).

## Scope

| In (S1) | Out (later) |
|---|---|
| `GET` of the product list, the specs index, and one rendered spec/design | Any write path — comments (S2), gate decisions (S3) extend the **same** base, additively |
| Status from the event-log projection, joined with content as-committed | Editing content (always via the crew + PRs — ADR-0015 invariant) |
| Per-product isolation enforced server-side | Cross-product or org-wide views |
| A caller identity supplied by the auth edge (stub in dev) | The auth handshake itself (ADR-0019; wired in the auth slice) |

The webapp holds **no GitHub token and no authoritative state** — it calls this API only (ADR-0015/0018).

## Identity & authorization

Per [ADR-0019](../decisions/0019-workspace-identity-component-auth-google-sso.md), three concerns stay
separate and this API sits at the boundary of the last two:

- **Identity arrives already established.** The API trusts an authenticated identity injected by the
  edge — Cloudflare Access → `component-auth` (Google SSO) — as a signed/trusted header
  (`X-Maestro-Identity: {email, sub}`), **never** read from the client body or a client-set cookie. The
  webapp forwards the session; it does not assert identity itself.
- **Dev/stub identity (S1).** Locally, with no edge, `MAESTRO_DEV_IDENTITY=you@example.com` supplies a
  stub so render + isolation can be built first (ADR-0019 §5). Production rejects the stub path.
- **Authorization is the register, not the IdP.** The identity is mapped to a `Participant` by `email`
  (and/or Google `sub`); the caller's product set is its register membership (ADR-0008/0010/0011). The
  IdP says *who you are*; the register says *what you may see*.
- **Isolation is server-side and non-revealing.** A caller never receives another product's specs,
  branches, or status. A product the caller does not participate in returns **`404`** (existence is not
  disclosed), not `403`.

> Two engine-spine changes this depends on are listed under [Dependencies](#dependencies--required-engine-spine-changes).

## Interface / API

Base path `/api` (unversioned for S1; see [Known limitations](#known-limitations)). All responses
`application/json; charset=utf-8`. All routes are **caller-scoped** — results reflect only the caller's
products.

### `GET /api/products` — the caller's products

```jsonc
// 200
[
  { "id": "maestro", "name": "maestro", "product_type": "technical", "role": "architect" }
]
```
`role` is the caller's role in that product (register membership). Empty array if the caller
participates in nothing.

### `GET /api/products/{product_id}/specs` — the Specs index (the S1 view)

Lists every indexed spec/design for the product, across branches, joined with status. Cheap: it returns
**summaries** (title + status from the index/projection), **not** full bodies — content is the detail
call. Optional filters: `?branch=`, `?kind=`, `?feature=`.

```jsonc
// 200
{
  "product": { "id": "maestro", "name": "maestro" },
  "specs": [
    {
      "feature": "workspace-read-api",
      "task": "US-0030",                       // nullable — null when no DeliveryTask owns it (e.g. on main)
      "kind": "functional_spec",               // functional_spec | technical_design
      "title": "Workspace read API",           // from the doc's H1/frontmatter (cached at index time)
      "ref": {
        "repo": "fps4/maestro",
        "branch": "maestro/us-0030",
        "path": "docs/product/.../spec.md",
        "commit": "abc1234"
      },
      "status": {                              // see "Status projection mapping" — null block if no owning task
        "task_id": "run-7f3a…",
        "stage": "functional_gate",
        "gate": { "type": "functional", "decision": "pending" },
        "branch": "maestro/us-0030",
        "merged": false
      },
      "availability": "indexed",               // indexed | unavailable
      "href": "/api/products/maestro/specs/workspace-read-api/functional_spec?branch=maestro%2Fus-0030"
    }
  ],
  "unindexed": [                               // docs/** that look like specs but failed the frontmatter contract
    { "ref": { "repo": "fps4/maestro", "branch": "main", "path": "docs/foo.md", "commit": "def5678" },
      "reason": "missing maestro: frontmatter" }
  ]
}
```

- `href` is the ready-to-use detail link — the client does **not** construct URLs (branch names contain
  `/`, so `branch` is always a **query param**, never a path segment).
- A partial content/index failure for one entry does not fail the list: that entry carries
  `availability: "unavailable"` and the rest still serve (no all-or-nothing — `workspace-backend.md`).

### `GET /api/products/{product_id}/specs/{feature}/{kind}` — one rendered doc

Returns the markdown **as-committed** (rendered in-app, ADR-0018 §5) plus its status. `?branch=` selects
the branch; omitted ⇒ the product repo's **default branch**.

```jsonc
// 200
{
  "feature": "workspace-read-api",
  "task": "US-0030",
  "kind": "functional_spec",
  "title": "Workspace read API",
  "ref": { "repo": "fps4/maestro", "branch": "maestro/us-0030", "path": "docs/…/spec.md", "commit": "abc1234" },
  "frontmatter": { "title": "…", "status": "draft", "maestro": { "feature": "workspace-read-api", "task": "US-0030", "kind": "functional_spec" } },
  "content": "# Workspace read API\n\n…raw markdown, rendered client-side…",
  "status": { "task_id": "run-7f3a…", "stage": "functional_gate", "gate": { "type": "functional", "decision": "pending" }, "branch": "maestro/us-0030", "merged": false }
}
```

Responds `404` if no `(feature, kind)` doc exists on that branch for this product; `502/503`
(`code: "degraded"`) if the content fetch upstream fails (retryable — see the error model).

## The frontmatter index contract

The index ([ADR-0018](../decisions/0018-workspace-read-api-and-frontmatter-index.md)) is built by reading
a `maestro:` block in each spec/design's YAML frontmatter — **no separate manifest**. The schema:

```yaml
maestro:
  feature: <slug>          # REQUIRED — the Feature this belongs to (ADR-0005). [a-z0-9-]+
  kind: functional_spec    # REQUIRED — functional_spec | technical_design
  task: US-0030            # OPTIONAL — the DeliveryTask, when one owns it (US-NNNN)
```

Validation (the `SpecIndex`):

| Condition | Result |
|---|---|
| `feature` + `kind` present, `kind` in enum, `feature` a slug, `task` (if any) `US-NNNN` | **indexed** — mapped `feature/task → {repo, branch, path, commit, kind}` |
| a `docs/**` markdown with **no `maestro:` block** | **ignored** — a plain doc (guide/README/ADR), not a spec. So the scan is signal, not noise |
| `maestro:` present but malformed (`kind` not in the enum, `feature`/`task` bad shape) | `unindexed`, `reason: "malformed maestro: frontmatter (<field>)"` — the doc *opted in* but we won't guess |
| two docs claim the same `(feature, kind)` on a branch | `unindexed` for the colliding pair, `reason: "duplicate (feature, kind) on branch"` |
| a **known** spec ref (from a crew event) whose file later lacks the block | `reason: "missing maestro: frontmatter"` — the reconciler path (ADR-0017), not the S1 scan |

Only docs that opt in via a `maestro:` block participate — the no-block case is *skipped*, not flagged,
so the scan over a repo full of ordinary docs stays quiet. The schema should be co-documented in
`standards/` as a docs frontmatter contract so the crew emits it consistently (ADR-0018 open question) —
a follow-up, not part of this read contract.

## Status projection mapping

The `status` block is a projection of the engine spine's event log
([`orchestrator/projection.py`](../../../orchestrator/projection.py) → `TaskState`). When no task owns a
doc (e.g. a spec sitting on `main`), `status` is `null`.

> **S1 join key — `(repo, branch)`.** The slice links a spec to its task by **matching the spec's
> `(repo, branch)` to a delivery task with an open PR on that ref** (the projection's `pr.repo` +
> `branch`). It is honest and isolated, but means a spec on a branch with no PR yet carries `null`
> status. The precise `feature → run_id` link (from the crew event that produced the spec, recording the
> ref — ADR-0018) lands with the crew slice and layers on without changing this contract.

| API field | Source (`TaskState`) | Notes |
|---|---|---|
| `status.task_id` | `task_id` (== `run_id`) | the correlation id |
| `status.stage` | `stage` | `intake \| functional_gate \| design \| technical_gate \| build \| merge_gate \| done \| blocked` (data-model.md) |
| `status.branch` | `branch` | the `maestro/*` branch in flight |
| `status.merged` | `merged` | true once `merge.executed` observed (ADR-0016) |
| `status.gate.type` | the latest relevant `GateDecision.gate` | `functional \| technical \| pending` for the doc's `kind` |
| `status.gate.decision` | latest `GateDecision.decision` for that gate, else `"pending"` | `approve \| request_changes \| reject \| pending` |

The API reads the projection; it never advances state.

## Error model

Every error returns a typed body and an honest status:

```jsonc
{ "error": { "code": "…", "message": "human-readable", "ref": { /* present for ref-scoped failures */ } } }
```

| HTTP | `code` | When |
|---|---|---|
| 401 | `unauthenticated` | no/invalid edge identity (and no dev stub) |
| 404 | `not_found` | unknown product **to this caller** (isolation: existence not revealed), or no such spec |
| 200 | — (`availability: "unavailable"`) | one entry's content/index failed in a **list** — the rest still serve |
| 502 / 503 | `degraded` | upstream GitHub content fetch or installation-token mint failed on a **detail** call; retryable with backoff (`standards/reliability.yaml`) |

Note: per-product isolation **excludes** rather than `403`s — a caller simply never sees what isn't
theirs (ADR-0010/0011). Webhook-side failures (signature/unknown-repo) are the ingestion path's concern
([ADR-0017](../decisions/0017-github-app-and-webhook-ingestion.md)), not this read API.

## Caching & freshness

- Detail responses are **commit-keyed**: `ETag: "<commit>:<path>"`, honour `If-None-Match` → `304`. Safe
  because the webhook `push` reconciler keeps the index fresh (ADR-0017/0018), so a commit-keyed cache
  never goes stale silently.
- The list reflects the index, which the reconciler updates on `docs/**` pushes; no client polling
  contract in S1 (live updates are a later concern).

## Engine-spine changes in this slice

S1 added three things to what PR #13 (the M0 spine) shipped, plus the read API itself:

1. **A read-only content capability — `RepoContentReader`.** A narrow protocol
   ([`orchestrator/specindex.py`](../../../orchestrator/specindex.py)) — `get_contents(repo, path, ref)`
   and `list_tree(repo, ref, path_prefix)` — implemented by the existing
   [`HttpGitHubClient`](../../../adapters/github/http_client.py) (stdlib only), and the same surface the
   App-installation client (ADR-0017) will implement. It is **separate from** the write `GitHubClient`,
   so the merge boundary's protocol is untouched: merge stays the only write into a default branch.
2. **`Participant.email`.** The dataclass + YAML loader
   ([`orchestrator/register.py`](../../../orchestrator/register.py)) now carry `email`, and
   `Participant.matches()` matches on it — the one place identity is matched, shared by the merge
   boundary and this API. `email` is how an edge identity maps to a participant (ADR-0019).
3. **The `SpecIndex`** ([`orchestrator/specindex.py`](../../../orchestrator/specindex.py)) — parses
   frontmatter, validates the `maestro:` block, and bootstraps a branch's index by scanning `docs/**`
   (the S1 path). The webhook `push` reconciler (ADR-0017) and crew-event seeding reuse `classify()`.

The read API core ([`orchestrator/readapi.py`](../../../orchestrator/readapi.py)) is **framework-
agnostic** (tested with no sockets); its HTTP binding ([`orchestrator/httpserver.py`](../../../orchestrator/httpserver.py))
is **stdlib `http.server`** — no web-framework dependency, matching the github client's no-HTTP-dep
stance. FastAPI (the "likely" choice) stays a drop-in for that one thin file.

## Known limitations

- **Unversioned base (`/api`).** S1 is a single consumer (our webapp), co-deployed. A `/api/v1` prefix
  (or header negotiation) lands when an external/independent consumer appears.
- **No pagination in S1.** `specs[]` returns in full; `?limit=`/`?cursor=` is the forward extension when
  a product's spec count warrants it (ADR-0018 open question).
- **Index caching is head-commit-keyed (Phase 1), not yet incremental.** A branch's index is rebuilt
  only when its head commit changes (one cheap `head_sha` check revalidates per request); frontmatter is
  content-addressed by blob SHA, so a rebuild only fetches changed files, in parallel. The **incremental**
  path — the webhook `push` reconciler updating only changed files + crew-event seeding, so the list
  makes *zero* GitHub calls — is Phase 2 (ADR-0017). A persisted (cross-restart) index lands with it.
- **Concurrency is light.** Served via `ThreadingHTTPServer` over a dedicated read-only SQLite
  connection with event reads serialised by a lock; the Postgres cutover is the real concurrency story
  (ADR-0008).
- **Rendering specifics deferred** — Mermaid in technical designs and ADR cross-links resolve in the
  webapp render slice, not the wire contract.
- **Write paths (S2/S3 + M1 dispatch) extend this base, additively** — `POST …/tasks`,
  `POST …/comments`, `POST …/gates/.../decisions` — pinned in
  [`workspace-write-api.md`](workspace-write-api.md). Shared concerns (identity, isolation, error
  envelope, base path) carry over unchanged; the write contract adds idempotency + optimistic
  concurrency. S1 here is strictly `GET`.
