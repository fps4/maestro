---
title: "0017: GitHub integration — a GitHub App with webhook ingestion (closes PAT-or-App)"
status: proposed
date: 2026-05-27
related:
  - 0008-system-of-record-and-persistence.md
  - 0016-merge-after-workspace-approval.md
  - 0010-public-engine-private-instance-data.md
  - 0011-multi-surface-human-control.md
  - 0005-product-domain-model.md
  - 0009-audit-logging-and-observability.md
  - ../components/orchestrator.md
  - ../components/workspace-backend.md
  - ../../product/roadmap.md
---

## Context

[ADR-0008](0008-system-of-record-and-persistence.md) decided maestro **ingests facts from GitHub
(PR opened, checks passed, merged) via webhooks, not polling** — a polling orchestrator hits GitHub's
~5k req/hr limit and has no transactional gate state. It left *how maestro authenticates* to GitHub
open; the [roadmap](../../product/roadmap.md) recorded the choice as "fine-grained **PAT (or App)** with
merge" and deferred it. The engine spine shipped with a fine-grained-PAT HTTP client behind a
`GitHubClient` protocol.

Two needs now force the choice:

1. **The workspace must show specs/designs across many branches with live status** (which branch, which
   delivery task, which gate, draft/approved/merged) — see [`workspace-backend.md`](../components/workspace-backend.md).
   The status is maestro's (the event-log projection, ADR-0008); the GitHub-origin facts that keep it
   fresh (a human pushed, CI went green, a PR merged) must arrive as **webhooks**, per ADR-0008.
2. **Multi-repo, multi-product** operation (ADR-0005/0010/0011): a product spans repos; products are
   isolated. One user's PAT is a blunt instrument for this.

A PAT cannot *receive* webhooks (you configure them per repo, by hand, with your own secret), is a
single long-lived secret, and is capped at 5k req/hr. A **GitHub App** delivers webhooks natively to
one endpoint for every installed repo, authenticates with short-lived per-installation tokens, installs
per-product on just that product's repos, and gets 15k req/hr per installation. The webhook requirement
from ADR-0008 effectively decides this.

## Decision

maestro integrates with GitHub as a **GitHub App**, not a PAT.

1. **App identity, per-product installation.** A single maestro GitHub App is **installed per product**
   on that product's repos (ADR-0005/0010). Branches, PRs, and merges are attributed to `maestro[bot]`.
   The App's permissions are the minimum for the loop: contents (read/write for `maestro/*` branches),
   pull requests (read/write), and the merge it performs only against a recorded approval ([ADR-0016](0016-merge-after-workspace-approval.md)).

2. **API calls use short-lived installation tokens, behind the existing boundary.** The adapter mints
   and refreshes an installation token (App JWT → installation token, ~1h TTL) and uses it as the bearer
   token. This drops in **behind the `GitHubClient` protocol the engine spine already defines** as an
   `AppInstallationClient` — the merge boundary, event log, and adapter logic are unchanged; only how
   the client authenticates changes.

3. **GitHub-origin facts arrive by webhook and become events — never direct state mutation.** The App
   delivers `push`, `pull_request`, `check_suite`/`check_run`, and merge events to a **single webhook
   receiver**. The receiver **verifies the HMAC signature** against the App's webhook secret, resolves
   `repo → product` from the register (ADR-0005/0008), and **appends events to the log** (ADR-0008/0009).
   Current state is the projection of those events, exactly as for maestro-authored facts. **Polling is
   not used** (ADR-0008).

4. **Per-product isolation by construction.** A repo maps to exactly the product(s) that own it
   (ADR-0010/0011); a webhook for an unrecognised repo is rejected and logged. Installation tokens are
   scoped to one installation's repos.

5. **Secrets are runtime-injected, never in source.** The App **private key** and **webhook secret**
   are secrets (env / secret manager), never committed (ADR-0010, `standards/security.yaml`). They join
   the setup contract (`docs/guides/setup.md`) alongside `GITHUB` credentials, replacing the raw PAT.

## Consequences

- **Closes the roadmap's open "PAT or App" choice** in favour of the App, and **concretises ADR-0008's
  webhook ingestion** with a specific mechanism.
- **The merge boundary is unaffected in logic.** ADR-0016's event-gated refusal still holds; the
  credential is now a per-installation token scoped to the product's repos — a *tighter* blast radius
  than a user PAT, while the security boundary remains the WORM event log + the adapter check.
- **The webhook receiver becomes security-critical** — signature verification and `repo → product`
  resolution are load-bearing and must be covered by tests (a forged or misrouted webhook must be
  rejected and logged), mirroring the merge-boundary discipline.
- **More operational setup** — register the App, hold its private key + webhook secret, run the
  per-product installation flow, expose the webhook endpoint over the **Cloudflare Tunnel** already in
  use (ADR-0012). Heavier than a PAT for the single dogfood repo; correct for multi-repo/product.
- **Token rotation is now maestro's job** — installation tokens expire (~1h); the adapter refreshes
  them. A transient mint failure is a `degraded` dependency (`standards/reliability.yaml`), retried.
- **The engine spine accommodates it cleanly** — the `GitHubClient` protocol means no change to the
  merge boundary or the event log; the new code is the `AppInstallationClient` and the webhook receiver.

## Open questions

- **Single instance-wide App vs. one App per product.** Leaning **single App, installed per product** —
  simplest to operate, isolation comes from per-installation tokens + `repo → product`. Revisit if a
  commercial product needs a separately-owned App.
- **Receiver → projector coupling.** Start with a **synchronous append** on the receiver (SQLite,
  single instance); introduce a queue/buffer when concurrency or delivery bursts demand it — the same
  SQLite→Postgres staging as ADR-0008. The webhook is the source of the fact; the queue is an internal
  reliability detail.
- **Exact event subscription set** and how `check_suite`/`check_run` map onto the DoD gates (ADR-0006) —
  an engineering detail for the build slice.
- **GitHub App vs. Actions for DoD.** Unchanged here; DoD quality gates may run in Actions and report
  via `check_*` webhooks — addressed when DoD lands (M2/M3).
