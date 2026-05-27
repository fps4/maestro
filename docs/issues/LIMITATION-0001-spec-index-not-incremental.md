---
title: "LIMITATION-0001: the spec index is head-commit-cached, not incremental"
status: current
last_updated: 2026-05-27
owners: [architect]
severity: low
related:
  - docs/architecture/components/workspace-backend.md
  - docs/architecture/contracts/workspace-read-api.md
  - docs/architecture/decisions/0017-github-app-and-webhook-ingestion.md
  - docs/architecture/decisions/0018-workspace-read-api-and-frontmatter-index.md
  - docs/product/roadmap.md
---

# LIMITATION-0001 — the spec index is head-commit-cached, not incremental

## The constraint

The workspace read API builds a product's spec index by reading frontmatter from the repo
(ADR-0018). Today (**Phase 1**, shipped with S1) it is **cache-on-read**, not maintained:

- A branch's index is rebuilt only when its **head commit** changes (one cheap `head_sha` check
  revalidates per request), and frontmatter is **content-addressed by blob SHA**, so a rebuild fetches
  only changed/new files, in parallel.
- So steady-state reads are sub-second, but a **new commit or a cold start triggers a rebuild** that
  fetches every changed markdown file under `docs/**` — and a first build on a large tree is O(files).

It is also **in-process** (not persisted): a restart re-warms from cold.

## Why we live with it

At dogfood / single-product scale (~50 docs) the cold build is ~1–3s and rebuilds are rare, so Phase 1
is adequate through the MVP (M0–M2). Building the incremental path requires the GitHub App + webhook
ingestion ([ADR-0017](../architecture/decisions/0017-github-app-and-webhook-ingestion.md)), which is its
own slice — not worth blocking the MVP on.

## Impact

- A product with a large `docs/` tree pays a noticeable cold-build cost on first view after a commit or
  a restart.
- No correctness impact: the head-SHA check means the index is never stale, only occasionally rebuilt.

## The fix (planned: M3)

**Phase 2** makes the index **incremental and persisted** ([roadmap](../product/roadmap.md) M3):

- the webhook `push` reconciler (ADR-0017) re-reads frontmatter for **only the files a push changed**;
- crew events that produce a spec seed the index directly (they carry the ref);
- the index is persisted, so the list path makes **zero** GitHub calls and survives restarts.

Until then, the head-commit cache + blob-SHA content-addressing (Phase 1) is the mitigation.
