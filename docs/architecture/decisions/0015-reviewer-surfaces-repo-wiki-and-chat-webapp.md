---
title: "0015: Reviewer surfaces — a repo-linked docs wiki + a maestro chat webapp (OpenProject/XWiki rejected)"
status: accepted
date: 2026-05-26
related:
  - 0013-web-control-ui-for-reviewers.md
  - 0011-multi-surface-human-control.md
  - 0008-system-of-record-and-persistence.md
  - 0010-public-engine-private-instance-data.md
  - 0012-artifact-storage-and-sharing.md
  - 0006-spec-driven-sdlc.md
  - ../../product/vision.md
---

> **Amendment (2026-05-26).** This ADR first named the in-house **Minimals (`@minimal-kit/next-js`)**
> template as the webapp base. Because maestro is a **public, open-core repo** (ADR-0010) and the
> Minimals kit is **commercially licensed** (no public redistribution), the base is instead an
> **MIT/open stack — shadcn/ui + Next.js + Tailwind** (you own the component source). The decision is
> otherwise unchanged; see decision point 3.

## Context

[ADR-0013](0013-web-control-ui-for-reviewers.md) (proposed) split the functional reviewer's need into
a **document surface** (read + comment) and a **control surface** (decide), proposed a maestro-owned
web control UI, set the document surface to **Google Docs**, and **deferred the build approach**
(extend Agent Inbox vs. build minimal vs. Google-Docs-comments-only). [ADR-0011](0011-multi-surface-human-control.md)
made the surface a pluggable, per-role layer (Slack for architects, Telegram for functional reviewers).

We then evaluated two off-the-shelf, self-hosted tools as the reviewer surfaces — **OpenProject**
(control, Jira-like) + **XWiki** (document) — including the idea of using **ticket comments / document
edits as the channel to communicate with agents**. Both were stood up on ds1 alongside MinIO
([ADR-0012](0012-artifact-storage-and-sharing.md)) to evaluate them where they would actually run.

Findings:

- **The one real win** was identity + per-project RBAC + attribution out of the box — exactly what
  ADR-0009/0010/0011 want, and better than Telegram (phone identity) or Google Docs (ACLs).
- **But the costs outweighed it:**
  - **XWiki as a document store is a second source of truth** — directly against spec-driven
    ([ADR-0006](0006-spec-driven-sdlc.md)) and repo-as-truth ([ADR-0008](0008-system-of-record-and-persistence.md)/[ADR-0010](0010-public-engine-private-instance-data.md)). ADR-0013 had already flagged the same risk for Google Docs.
  - **Two more heavy stateful services** to run, back up, and patch next to the existing ds1 stacks.
  - **Overlap with GitHub Issues/Projects** (already a dependency) — a third work-item plane.
  - **"Jira-like" is too heavy** for a business reviewer whose job is *read the spec, then approve*.
  - The **agent-comms-via-comments** thesis still needs a webhook/REST bridge we would build either
    way — so the tool buys little there.

Net: the convenience does not justify two services plus a sync discipline, and the document-surface
choice broke our source-of-truth rule.

## Decision

1. **Reject OpenProject + XWiki** as maestro surfaces. (The evaluation stack was a throwaway, never
   committed; this ADR is its record.)

2. **Document surface = a docs-as-code wiki rendered one-way from the product repo.** The repo's
   markdown specs/designs stay the **single source of truth** (ADR-0006/0008/0010); the wiki is a
   generated, read-only-with-comments *view*. This **replaces ADR-0013's Google-Docs document surface**
   and removes the second-source-of-truth risk by construction.

3. **Control + discussion surface = a maestro-owned web app**, built on an **MIT/open base
   (shadcn/ui + Next.js + Tailwind)** so it can live in the public open-core repo (see Amendment;
   a commercial template cannot). Components are copied in and owned in-repo, kept as a reusable base.
   The app hosts the **gate** (context + approve / request-changes / reject) and a **chat** thread for
   discussion, and renders the repo-sourced wiki. This **resolves ADR-0013's deferred build approach:
   build minimal, on our own open base** — not Agent Inbox, not Google-Docs-comments.

4. **Reuse fps4 building blocks, not greenfield:** identity + RBAC + attribution via **`component-auth`**
   (the one thing the rejected tools gave for free — we must not lose it); shared UI via
   **`component-ui`**; chat backend / embeddable UI from **`chatbot`** where it fits; reasoning via the
   **`sovereign-llm-gateway`**; external exposure via the **Cloudflare Tunnel + Access** already in use
   (ADR-0012, `core-services`).

5. **Agent-comms is our own webhook/REST contract into the webapp**, not a third party's comment API.
   A webapp event (comment, decision) → orchestrator → **authorize by role** (ADR-0011) → append to
   maestro's **event log** (ADR-0008) → agent reply rendered back. **One writer of truth**; the webapp
   is a surface, never the system of record.

6. **This reverses the "no bespoke UI in v1" non-goal.** [`vision.md`](../../product/vision.md) and
   [`CODEBASE.md`](../../../CODEBASE.md) are updated on acceptance. Slack stays the architect control
   surface; GitHub PR stays the architect's document + merge surface; **Telegram remains an optional,
   low-touch control surface** (ADR-0011), no longer the default.

## Consequences

- **Source of truth preserved.** Repo → wiki is one-way; ADR-0008 is unchanged; no split-brain. The
  failure mode we rejected XWiki for cannot recur.
- **Real build scope added** — a webapp + an auth model + a docs-render pipeline — the main cost. But
  it is mostly **assembly from existing fps4 parts**, not new construction.
- **Identity / RBAC / attribution become maestro's responsibility**, met by `component-auth`.
- **One controlled, per-product-isolated surface** for *read + discuss + approve* across mixed
  internal/external reviewers — the ADR-0013 need — without operating OpenProject or XWiki.
- **Relationships:** refines **ADR-0011** (adds `webapp` as a surface; Telegram demoted to optional);
  **supersedes ADR-0013's** document-surface and build-approach specifics (its two-axis framing is
  retained); leans on **ADR-0012** (Cloudflare Tunnel/Access).
- **Open questions:**
  - the wiki renderer (Next.js MDX in the same app vs. a sibling static site — MkDocs Material /
    Docusaurus / Backstage TechDocs) — a build-time pick;
  - the external-reviewer auth model inside `component-auth` (OIDC / magic link / Cloudflare Access);
  - how much of `chatbot` is reused vs. maestro-specific;
  - whether the architect also moves into the webapp (likely not for v1).
