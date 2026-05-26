---
title: "0013: A web control UI for reviewers (revisiting the no-bespoke-UI non-goal)"
status: superseded by ADR-0015
date: 2026-05-25
related:
  - 0011-multi-surface-human-control.md
  - 0012-artifact-storage-and-sharing.md
  - 0010-public-engine-private-instance-data.md
  - ../../product/vision.md
---

> **Superseded by [ADR-0015](0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md).** The two-axis
> framing (separate document vs. control surface) is retained; the **document surface** changes from
> Google Docs to a **repo-linked docs wiki**, and the deferred **build approach** is resolved as a
> **maestro-owned chat webapp** on the in-house Minimal/Next.js template. OpenProject + XWiki were
> evaluated and rejected (see ADR-0015).

## Context

maestro's v1 non-goal is **"no bespoke UI — Slack + GitHub only"** (vision.md, CODEBASE.md). That held
while the reviewers were the architect (who reviews in GitHub) plus a chat ping. Two facts now strain it:

- **Functional reviewers are a mix of internal and external people** who must **read** specs/designs
  and **discuss** them — not just click approve. Chat (Slack/Telegram) is a poor surface for reading a
  multi-page document; Telegram reaches external people but still can't host real doc review.
- The market has converged on a **dedicated human-in-the-loop review surface** (e.g. LangChain's
  open-source **Agent Inbox**) — a queue of pending decisions shown with context (a diff/explanation,
  not raw logs), separate from chat.

So the single chat surface in [ADR-0011](0011-multi-surface-human-control.md) (still `proposed`) is
insufficient for the functional reviewer's *read + discuss + approve* need across mixed audiences.

> **Companion decision, deferred.** Whether maestro's runtime is **LangGraph** is being evaluated in
> [`spikes/langgraph/`](../../../spikes/langgraph/) and is **not decided here.** This ADR's UI decision
> does not depend on it; the LangGraph option only affects *how* the UI is built (see below).

## Decision (proposed)

1. **Two-axis surfaces.** Separate the **document surface** (read + comment) from the **control
   surface** (decide), resolved **per product / per participant**. This refines ADR-0011 (still
   proposed), which conflated them into one chat channel.

2. **Adopt a maestro-owned web control UI** as the functional-reviewer control surface: a
   **per-product, access-scoped** page showing the gate with context (artifact preview / diff, *not*
   raw logs), the linked document, a comment thread, and **approve / request-changes / reject**. Served
   over the existing **Cloudflare Tunnel + Access** (ADR-0012), per-product isolation (ADR-0010/0011).
   **This reverses the "no bespoke UI in v1" non-goal** — on acceptance, vision.md and CODEBASE.md are updated.

3. **Document surface = Google Docs** for functional reviewers (mixed internal/external, already in
   use): the spec/design is **published one-way from the product repo** (which stays the source of
   truth — ADR-0010) for reading + inline comments. Architects keep **GitHub PR** as their doc surface
   and **Slack** as their control surface.

4. **Telegram becomes optional** — a per-product control-surface choice for low-touch / external-only
   cases, no longer the default functional surface.

5. **Build approach (deferred with the runtime):** *if* we adopt LangGraph, **Agent Inbox** is the
   candidate starting point for the control UI; otherwise a minimal bespoke page over the ArtifactStore
   + Cloudflare Access. Decided after the spike.

## Consequences

- **Solves read + discuss + approve for mixed internal/external reviewers** in one controlled,
  per-product-isolated surface — the thing chat cannot do.
- **Reverses a v1 non-goal and adds real build scope** (a UI + an auth model) — the main cost.
  Mitigated by starting from Agent Inbox (if LangGraph) or a minimal page.
- **Refines ADR-0011** (two-axis surfaces; Telegram demoted) and **leans on ADR-0012** (Cloudflare
  Tunnel/Access; presigned/rendered docs).
- **Google Docs is a published view, not a second source of truth** — one-way sync from the repo spec.
- **Open questions:** extend Agent Inbox vs. build minimal vs. Google-Docs-comments-only; the external
  reviewer **auth model** (Cloudflare Access / magic links / OIDC); whether the architect also moves
  into the UI (likely not for v1); coupling to the deferred LangGraph runtime decision.
