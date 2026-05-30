---
title: "0021: Plain-language summary on every spec/design — agent-authored, in frontmatter"
status: accepted
date: 2026-05-28
related:
  - 0006-spec-driven-sdlc.md
  - 0008-system-of-record-and-persistence.md
  - 0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - 0018-workspace-read-api-and-frontmatter-index.md
  - 0020-feedback-bundle-payload-shape.md
  - ../workspace-ux-design.md
  - ../webapp-concept.md
  - ../../product/user-stories/EP-01-delivery-loop/US-0010-draft-functional-spec.md
  - ../../product/user-stories/EP-01-delivery-loop/US-0013-produce-technical-design.md
  - ../../product/user-stories/EP-03-reviewer-surface/US-0031-workspace-ux-design.md
  - ../../product/user-stories/EP-03-reviewer-surface/US-0032-workspace-discuss-and-decide-m1.md
---

## Context

[`workspace-ux-design.md`](../workspace-ux-design.md) P1 names the load-bearing rule that makes the workspace usable for non-technical reviewers: *"every spec, design, and PR view opens with a plain-language summary (one paragraph, no jargon) authored by the agent."* Structured detail (EARS criteria, diagrams, diff hunks) lives below the fold. The functional reviewer often acts on the summary alone; the architect scrolls.

The mechanism was deliberately deferred. Two options were on the table, with a hybrid in between:

- **A — Agent-authored at draft time, committed to the repo.** The spec/design agent produces a summary in the artefact's frontmatter (or a `## Summary` body section); the workspace renders it as the first block. One-shot cost; the summary is part of the artefact's history. Drift risk: if the artefact changes but the summary isn't re-generated, the summary goes stale.
- **B — On-the-fly rendering.** The workspace calls the LLM to render a summary each time the artefact is opened (cached by commit). Always fresh; costs tokens per view; the workspace gains an LLM call path that doesn't otherwise exist; a stale-cache or rate-limit failure makes the *first* line of the artefact missing.
- **C — Hybrid.** Agent writes a summary at draft time **and** on every re-draft (after [ADR-0020](0020-feedback-bundle-payload-shape.md)'s feedback bundle is applied); on-the-fly rendering as a fallback when the committed summary is missing.

The repo is the source of truth for content ([ADR-0006](0006-spec-driven-sdlc.md) / [ADR-0008](0008-system-of-record-and-persistence.md)) and the workspace is a projection ([ADR-0015](0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md)). Option B introduces a second authoritative source (the live LLM render) for content the reviewer reads first; the invariant says we should not.

## Decision

**Choose option A with discipline.** The spec/design agent emits a plain-language summary in the artefact's **`maestro:` frontmatter** on **every revision** — the first draft and every re-draft after a `request_changes` cycle. The workspace renders the summary as the first block of the spec/design view, before any structured content.

### Schema (extends the [ADR-0018](0018-workspace-read-api-and-frontmatter-index.md) frontmatter contract)

```yaml
maestro:
  feature: invoice-export
  task: US-0042
  kind: functional_spec
  summary: |                              # NEW — REQUIRED for functional_spec | technical_design
    A plain-language description of what this spec proposes,
    written for someone without coding context. ≤ 120 words.
```

Constraints:

- **Required** on `kind: functional_spec` and `kind: technical_design`. Absence is a soft index warning (`unindexed`, `reason: "missing maestro.summary"`) — the artefact still serves, but the workspace renders a placeholder ("Summary not yet generated — request the spec agent to add one"), not a guess.
- **≤ 120 words / 800 characters.** Long enough for one substantive paragraph; short enough that the reviewer reads it. Over the limit → the validator flags it; the agent contract instructs re-writing to fit.
- **No jargon, no spec-section ids, no EARS keywords.** Audience is the functional reviewer (domain expert, not technical) per US-0031's persona-card. The constraint is the agent's; the validator does not lexically enforce it.
- **No links, no code fences, no markdown.** Plain text; the renderer wraps it as the first block. This keeps it usable for notification snippets (EP-04, M3) and screen-reader linear flow.

### Where it renders

| Surface | Render position |
|---|---|
| Spec / design view (S1, US-0030) | First block of the view, above the H1; framed with a small "in plain language" label |
| Gate page (S3, US-0032) | First block of the gate context, before the artefact body |
| Inbox card (S6, M3) | The summary's first sentence (truncated to ~140 chars) as the card's snippet |
| Slack notification (US-0041, M3) | The summary's first sentence as the notification body |
| Repo (as-committed) | Frontmatter only; not re-rendered into the artefact's body. The body keeps its existing structure (H1, EARS, etc.). |

The renderer takes the summary from frontmatter; the body of the artefact is unchanged.

### Agent contract update

The spec agent (US-0010) and the planner/design agent (US-0013) gain one new requirement:

- **Every revision emits `summary:`.** On the first draft *and* on every re-draft that follows a feedback bundle (ADR-0020). The summary is part of what the agent writes; it is **not** generated by a separate "summary agent."
- **Summary reflects the current artefact.** If the artefact changes, the summary changes with it — no drift, because the same call that updates the artefact updates the summary. The two are always-emitted-together.
- **The agent's "what I changed and why" note** (the `agent_response.posted` event, [ADR-0020](0020-feedback-bundle-payload-shape.md)) may mention the summary delta when material. This is convention, not contract.

### Why not B (on-the-fly)

- **It introduces a second authoritative source for content the reviewer reads first.** The workspace becomes a partial system of record for the first-line representation — counter to the ADR-0015 invariant. A stale or failed render makes the reviewer's first impression *no impression*.
- **Per-view LLM cost without value.** A summary changes only when the artefact changes; rendering it on every open burns tokens that the committed-summary path doesn't spend.
- **The workspace gains an outbound LLM call path.** It otherwise doesn't have one; adding one expands what the workspace owns, against its "projection only" framing.

### Why not C (hybrid)

C is A *plus* B as a fallback. Once A is required and the validator surfaces missing summaries, the fallback's only job is to paper over an agent contract failure — at which point fixing the agent is the right move. Operating two paths to cover one bug is over-engineering before we know the failure modes; B remains available as a future option if the failure modes prove it earns its keep.

## Consequences

- **One source of truth.** The summary lives with the artefact, in the repo, as-committed. Renderers project it; nobody re-derives it.
- **Audit and diff for free.** The summary is committed; `git diff` of a spec includes the summary change; US-0031's *diff-of-artefact* view ([§refinement-loop step 4](../workspace-ux-design.md)) shows it naturally. The reviewer can see "the summary changed because criterion AC-3 was clarified."
- **No drift, by construction.** Every artefact revision emits the summary; an artefact change without a summary update is impossible if the agent contract is honoured. The validator's soft warning catches the failure mode.
- **The agent contract grows by a small amount.** Spec (US-0010) and design (US-0013) agents emit one extra field. The `ModelClient` budget covers it; the cost is a few dozen tokens per draft, not per view.
- **Notifications and inbox get a usable snippet for free.** EP-04 notifications and the M3 inbox can carry the first sentence with no separate generation step.
- **Frontmatter contract extends.** `maestro.summary` joins the [ADR-0018](0018-workspace-read-api-and-frontmatter-index.md) schema; the `standards/` frontmatter contract co-documents it (the ADR-0018 follow-up).

## Open questions

- **Word/char limit calibration.** 120 words / 800 characters is a reasonable first cut. Subject to feedback once US-0031's wireframes land and the inbox-snippet usage (M3) gets real.
- **PR-diff summary.** [`workspace-ux-design.md`](../workspace-ux-design.md) P1 names "spec, design, and PR view" as carrying the summary. PR diffs are not produced by a spec/design agent; the PR opener (US-0011, M2) can carry a separate "what this PR does in plain language" field in the PR body. Not in M1, but the convention is the same: written at draft time, not on the fly.
- **Multilingual.** If a commercial product's functional reviewers prefer another language, the summary is the natural translation seam (one paragraph, no jargon). Out of scope for M1; track for M4 onwards.
- **Validator strictness.** "Missing" is a soft warning today (`unindexed`, but artefact still serves). If empirical drift turns up, we tighten it. Defer the tightening until we see the failure modes.
- **Style guide for the summary.** A short rubric ("address the reviewer in second person? present tense? open with what; close with why?") would help the agent be consistent across products. Sits in `standards/`; small follow-up after the ADR lands.
