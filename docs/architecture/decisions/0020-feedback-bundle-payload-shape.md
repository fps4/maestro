---
title: "0020: The feedback-bundle payload shape — what the agent receives when the reviewer requests changes"
status: proposed
date: 2026-05-28
related:
  - 0008-system-of-record-and-persistence.md
  - 0009-audit-logging-and-observability.md
  - 0011-multi-surface-human-control.md
  - 0014-orchestration-runtime-langgraph.md
  - 0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - 0018-workspace-read-api-and-frontmatter-index.md
  - ../contracts/workspace-write-api.md
  - ../workspace-ux-design.md
  - ../webapp-concept.md
  - ../../product/user-stories/EP-01-delivery-loop/US-0010-draft-functional-spec.md
  - ../../product/user-stories/EP-01-delivery-loop/US-0013-produce-technical-design.md
  - ../../product/user-stories/EP-03-reviewer-surface/US-0031-workspace-ux-design.md
  - ../../product/user-stories/EP-03-reviewer-surface/US-0032-workspace-discuss-and-decide-m1.md
---

## Context

[`workspace-ux-design.md`](../workspace-ux-design.md) §refinement-loop named **anchored comments → feedback bundle → agent re-draft → diff-of-artefact** as the pattern that makes the refinement loop tractable for both technical and non-technical reviewers. The [workspace write API](../contracts/workspace-write-api.md) commits **to** bundling (server-side, at `request_changes` time) and emits a `feedback_bundle.created` event with a `feedback_bundle_id`, but **deliberately defers the bundle's internal payload shape** to this ADR — the wire owns the trigger and the id; this ADR owns what the agent reads.

The question is what the **spec/design agent** actually receives so it can re-draft against specific anchors instead of free-form chat. Three options were on the table:

- **A — Free text only.** A reviewer rationale + verbatim concatenation of comments. Simplest. Loses anchor specificity, so the agent has to re-discover *where* to change in the artefact — defeating the comment-anchoring discipline US-0031 P4 put in place.
- **B — Structured anchored list + reviewer rationale.** An ordered list of `{anchor, comments[], suggested_change?}` items, with a top-level `rationale` string the reviewer supplied at `request_changes` time. Anchor specificity preserved; structured input for the agent.
- **C — Hybrid (A + B + a "summary of asks").** Structured list AND a separately-entered summary, on the theory the agent benefits from a single-sentence "the gist." Adds a UX step at decision time and a field whose value the rationale already carries; risk of over-engineering before we see the failure modes.

The agent's job is to re-draft an artefact section-by-section while telling the reviewer *what changed and why* per anchor (the "what I changed and why" note from US-0031). The bundle is the agent's **input**; the response note is the agent's **output**. This ADR pins the input; the output is named here but its event shape lives in the engine spine.

## Decision

**Choose option B — a structured anchored list with the reviewer's rationale at the top.** The bundle is a server-side projection of the events that already exist (`comment.posted` and the `gate.decided` that triggered the bundle); the orchestrator constructs it at `request_changes` time and hands it to the responsible agent.

### Payload shape (M1)

```yaml
feedback_bundle:
  id: bundle-3a7…                       # opaque; the feedback_bundle_id from gate.decided
  task_id: run-9c2e…
  gate:
    id: gate-1f0…
    type: functional                    # functional | design | merge
  artefact:
    kind: functional_spec               # functional_spec | technical_design | pull_request_diff
    ref:
      repo: fps4/maestro
      branch: maestro/run-9c2e
      path: docs/.../spec.md
      commit: abc1234                   # the commit the reviewer was reading
  rationale: |
    AC-3 is the empty-result case I need addressed; AC-5 belongs in
    the technical design, not the functional spec.
  items:
    - anchor:
        locator: { criterion_id: AC-3 }
      comments:
        - id: cmt-83b…
          body: "AC-3 is missing the empty-result case — what does the export return for 0 rows?"
          attributed_to: { email: you@example.com, role: architect }
          created_at: 2026-05-28T10:14:22Z
          in_reply_to: null
      suggested_change: null            # OPTIONAL — see "What 'suggested_change' is for"
    - anchor:
        locator: { criterion_id: AC-5 }
      comments:
        - id: cmt-84c…
          body: "This is implementation detail — move to the design."
          attributed_to: { email: you@example.com, role: architect }
          created_at: 2026-05-28T10:15:01Z
          in_reply_to: null
      suggested_change: null
  decided_at: 2026-05-28T10:21:09Z
  attributed_to:                        # the deciding participant — same identity as gate.decided
    email: you@example.com
    role: architect
    product_id: maestro
```

### Composition rule (what goes in `items[]`)

At `request_changes` time the orchestrator collects every `comment.posted` event that satisfies **all** of:

1. `comment.task_id == task_id` (this task's comments only).
2. `comment.anchor.artefact.ref` matches the gated artefact's ref (same `repo + branch + path`, on the **commit the reviewer was reading** — `If-Match`'s `gate.seq` pins this; see [workspace-write-api §optimistic-concurrency](../contracts/workspace-write-api.md#optimistic-concurrency-gate-decisions-only)).
3. The comment is **not already addressed** — there is no later `agent_response.posted` event with this `comment.id` in its `addresses[]` (M1 starts with no such events, so every anchored comment in scope is included on the first cycle).
4. The comment carries an `anchor.locator` — **unanchored comments are excluded from `items[]`** and instead folded into the bundle's free-text `rationale` field by the orchestrator (prefixed with `[from comment cmt-…]` so the reviewer's words still reach the agent).

Comments are listed in **creation order** within an item; items are listed in **artefact order** (criterion id ascending, then heading order) so the agent's diff reflects the artefact's flow.

### What `suggested_change` is for

A reviewer may attach a concrete suggested replacement to a comment ("change AC-3's last line to …"). The wire contract is permissive — the workspace UI can produce one — but **M1 does not require the agent to honour it verbatim**; the suggestion is a hint, not a directive. Shape in M1: free-text only (`{kind: "text", body: "…"}`). Structured patches (regex, section-aware replacement) are an explicit future open question; not in M1.

If `suggested_change` is absent (the M1 norm) the agent re-drafts on the comment text alone.

### Identity & attribution

The bundle's `attributed_to` is the **deciding participant** (the one who clicked `request_changes`). The individual `items[].comments[].attributed_to` carry each comment author's identity — they may be different participants in a multi-reviewer product (US-0017, post-M1). Every identity is the same `{email, role, product_id}` shape used across the engine spine ([ADR-0009](0009-audit-logging-and-observability.md)).

### Eventing

Three event kinds participate; **no event is invented for the bundle's contents** — the bundle is a projection:

| Event | Emitted by | Carries |
|---|---|---|
| `gate.decided` (`decision: request_changes`) | the write API on the decision POST | `feedback_bundle_id`, `rationale`, `attributed_to`, `gate`, `task_id` |
| `feedback_bundle.created` | the orchestrator, immediately after `gate.decided` | `bundle_id`, the `items[]` projection (snapshot at decision time) |
| `agent_response.posted` (later) | the spec/design agent after re-drafting | `bundle_id`, `addresses: [comment_id, …]`, `summary_of_changes`, the new artefact ref |

The bundle is a **snapshot**: even if a comment is later edited (M2+ — append-only supersession), the bundle the agent received does not change. The audit trail can replay exactly what the agent saw.

### The agent's response — named here, shaped elsewhere

The agent's "what I changed and why" note (US-0031) is the `agent_response.posted` event. Its shape — a per-item response (`{comment_id, action: "addressed" | "deferred" | "rejected", note: "<one sentence>"}`) plus a top-line `summary_of_changes` — belongs in the **engine spine's** event schema, not this ADR. This ADR commits **only** to the response event carrying `bundle_id` and `addresses[]` so the next reviewer visit can render the per-anchor reply (US-0031 §refinement-loop step 4).

## Consequences

- **Anchor discipline holds end-to-end.** The reviewer anchors, the bundle preserves anchors, the agent re-drafts against anchors, the response replies per anchor. The refinement loop closes legibly; the reviewer does not re-read the whole spec each cycle.
- **The wire stays slim.** The workspace already posts anchored comments and an `If-Match`-pinned decision; the bundle is server-side. Clients gain no new schema responsibility.
- **Unanchored comments don't disappear.** They roll into `rationale` with provenance, so a reviewer who comments without an anchor (the P4 fallback) is not silenced; the agent simply gets less precision for those.
- **Replay-correct audit.** `feedback_bundle.created` snapshots the `items[]` at decision time; replaying the projection yields the same bundle the agent received. Attribution is per-comment and per-decision (ADR-0009).
- **Multi-reviewer ready.** When US-0017 lands and several role-holders can comment, the bundle composition rule is unchanged — every eligible role-holder's anchored comment is included; the *decider* is one participant; the *authors* are several. No schema change required.
- **The agent contract grows by a small known amount.** The crew agents (US-0010 spec, US-0013 design) consume `feedback_bundle` and emit `agent_response.posted` — both shapes are pinned (the latter named here, defined in the engine spine).

## Trade-offs explicit

- **More structure than Option A.** A free-text bundle would be simpler to build but force the agent to re-discover anchors. We pay a small composition cost server-side for a much smaller agent error budget.
- **Less than Option C.** A separate "summary of asks" field duplicates `rationale`. If, in practice, reviewers' rationales are too long or too narrative, we can add a `summary` field later without breaking the bundle's structural commitment.
- **`suggested_change` is hint-only in M1.** A directive-style patch (the agent *must* apply this text) would let reviewers fix typos in one click, but turns the workspace into an editor and the spec agent into a passthrough — the wrong shape for a refinement loop. Defer until we see if it's needed at all.

## Open questions

- ~~**`agent_response.posted` shape.**~~ **Resolved by [ADR-0022](0022-agent-response-event.md)** (2026-05-28): one entry per bundle item in `addresses[]` (`{comment_id, action: addressed | deferred | rejected, note, ref_section?}`) plus a top-level `summary_of_changes`, one-shot per bundle. Per-item reply is **required** — no silent skipping; the trichotomy is what makes the loop legible for non-technical reviewers.
- **Structured `suggested_change`.** A patch-shaped variant (regex, section anchor) is plausible for technical designs; not in M1. Track in [`workspace-ux-design.md`](../workspace-ux-design.md) §open-questions.
- **Cross-artefact items.** A reviewer comment on the spec that asks the agent to "move this to the design" is M1-shaped as a single item against the spec; the agent decides whether the action is `addressed` (move it) or `deferred` (raise it at the design gate). A cross-artefact `target_artefact` hint can land later if the cross-artefact patterns turn out to be common.
- **Re-bundling after partial responses.** If an `agent_response.posted` marks some items `addressed` and the reviewer requests changes again, the next bundle excludes addressed items (composition rule 3). The convention "addressed once, never re-bundled" is the M1 default; an explicit reviewer override ("re-open this item") is a later affordance.
