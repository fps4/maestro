---
title: "0019: Workspace identity — component-auth (Google SSO) at the edge, authorization from the register"
status: accepted
date: 2026-05-27
related:
  - 0018-workspace-read-api-and-frontmatter-index.md
  - 0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - 0011-multi-surface-human-control.md
  - 0012-artifact-storage-and-sharing.md
  - 0010-public-engine-private-instance-data.md
  - 0009-audit-logging-and-observability.md
  - ../components/workspace-backend.md
---

## Context

[ADR-0018](0018-workspace-read-api-and-frontmatter-index.md) defined the workspace's data/isolation
contract but left **how a caller authenticates** open. [ADR-0015](0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md)
named **`component-auth`** for identity/RBAC/attribution and the **Cloudflare Tunnel + Access**
([ADR-0012](0012-artifact-storage-and-sharing.md)) for exposure, and warned we must not lose the
attribution the rejected tools gave for free. maestro is **internal-first** (the architect is the only
participant today; external functional reviewers arrive at M4).

The architect chose: **component-auth with Google SSO**, and *"don't overcomplicate to start."* The
risk to avoid is collapsing perimeter, identity, and authorization into one bespoke auth blob — or
duplicating maestro's role model into the identity provider.

## Decision

Keep three concerns separate, each with a clear owner.

1. **Perimeter — Cloudflare Access (Google IdP).** The workspace is reachable **only** over the
   Cloudflare Tunnel + Access (ADR-0012); Access authenticates Google at the edge. No open inbound port;
   near-zero app code. This is the first gate (defense-in-depth), not the app's identity source.

2. **Identity — `component-auth`, federating Google SSO.** maestro's identity provider is
   `component-auth` (the shared fps4 block — we do **not** roll our own), with **Google** as the upstream
   SSO. The workspace authenticates the user's Google identity through component-auth (OIDC) and gets a
   stable identity (email + `sub`) and session. Attribution (ADR-0009) records this identity on every
   event the workspace emits.

3. **Authorization — the maestro register, unchanged.** *Who can see/do what* stays in maestro's own
   domain model: `participant → product → role` (ADR-0008/0010/0011). component-auth says *who you are*;
   the **register** says *what you may do*. We do **not** mirror roles into the IdP. Per-product
   isolation is enforced server-side by the read API (ADR-0018).

4. **Mapping — by Google identity on the participant.** A participant is matched to the authenticated
   user by **`email`** (and/or the stable Google `sub`), a register field beside the existing
   `slack_user_id` / `telegram_user_id`. Those surface ids remain for the notification channels; `email`
   is the workspace identity.

5. **Start simple, phased — no rework.**
   - the thin S1 slice runs against a **dev/stub identity** locally (build render + isolation first);
   - **wire component-auth OIDC (Google)** before the workspace is externally reachable;
   - Cloudflare Access (Google) is the perimeter throughout.
   No elaborate RBAC, no bespoke auth — the register is the authority, component-auth the identity.

6. **The portfolio scales by register entries.** maestro manages **its own repo as a technical product**
   today (dogfood), and the portfolio grows by adding products/repos to the register
   ([`config/products.yaml`](../../../config/products.yaml)). Identity and authorization scale with it
   automatically — per-product membership, **no per-product auth code**.

## Consequences

- **Resolves ADR-0018's open auth question.** The read API enforces isolation against a real identity:
  component-auth (who) × register (what).
- **No rolled-own auth; attribution preserved** (the ADR-0015 concern), via component-auth + the WORM
  event log (ADR-0009).
- **External reviewers (M4) slot in without changing the model** — component-auth federates their
  identity (Google or magic-link later); they appear in the register with a role for their product, and
  per-product isolation already covers them.
- **Two services in the auth path** (Access perimeter + component-auth identity) — slightly more infra,
  but standard zero-trust and mostly assembly from existing fps4 parts (ADR-0015).
- **Register schema gains `email`** on participants; the `GitHubClient`-era `Participant.matches()` (engine
  spine) extends to match on email — a one-line change in the build slice.
- **Webhooks are not user-auth.** The GitHub App webhook endpoint (ADR-0017) authenticates by **HMAC
  signature**, not SSO; if fronted by Access it uses a service token, never the Google user flow.

## Open questions

- **External-reviewer identity at M4** — Google SSO vs. magic-link via component-auth for users outside
  the org's Google tenant. Decided when M4 onboards the first commercial product.
- **Session/token lifetime + refresh** between component-auth and the workspace — an engineering detail
  for the auth slice.
- **`email` vs `sub` as the primary key** — email is human-friendly and what the register authors know;
  the immutable `sub` is safer against email changes. Likely store both, match on either.
