---
title: "0022: The agent response event — what the spec/design agent emits to close a refinement cycle"
status: proposed
date: 2026-05-28
related:
  - 0008-system-of-record-and-persistence.md
  - 0009-audit-logging-and-observability.md
  - 0014-orchestration-runtime-langgraph.md
  - 0017-github-app-and-webhook-ingestion.md
  - 0018-workspace-read-api-and-frontmatter-index.md
  - 0020-feedback-bundle-payload-shape.md
  - 0021-plain-language-summary-on-artefacts.md
  - ../workspace-ux-design.md
  - ../contracts/workspace-write-api.md
  - ../../product/user-stories/EP-01-delivery-loop/US-0010-draft-functional-spec.md
  - ../../product/user-stories/EP-01-delivery-loop/US-0013-produce-technical-design.md
  - ../../product/user-stories/EP-03-reviewer-surface/US-0031-workspace-ux-design.md
  - ../../product/user-stories/EP-03-reviewer-surface/US-0032-workspace-discuss-and-decide-m1.md
  - ../../product/user-stories/EP-02-engine-foundation/US-0020-orchestrate-delivery-task.md
---

## Context

[ADR-0020](0020-feedback-bundle-payload-shape.md) pinned the **input** to a refinement cycle: a `feedback_bundle` of anchored comments + reviewer rationale, projected from existing events. It named the agent's response — `agent_response.posted` — as the close-of-cycle event and committed to it carrying `bundle_id` and `addresses[]`, but **explicitly deferred the full shape** to "the engine spine's event schema."

[`workspace-ux-design.md`](../workspace-ux-design.md) §refinement-loop step 4 needs that shape to render: the **diff-of-artefact** view shows the new artefact + the agent's "what I changed and why" note + per-anchor replies inline with each comment. Step 5 (cycle or approve) needs the reviewer to see whether each comment was *addressed*, *deferred*, or *rejected* — so they can decide whether to approve, request changes again, or escalate.

This ADR pins that shape. It is small but load-bearing: without it, US-0010 and US-0013 implementations have to guess what closes a refinement cycle, the workspace cannot render step 4, and a "rejected" comment becomes silent.

## Decision

Define `agent_response.posted` as the event the responsible agent emits **immediately after publishing a re-drafted artefact** in response to a `feedback_bundle`. The event has a fixed, slim shape; per-item replies are required (no silent skipping); a bundle has **at most one** response (one-shot closure of one cycle).

### Event shape

```yaml
agent_response.posted:
  id: resp-7d2…                       # opaque event id
  bundle_id: bundle-3a7…              # the feedback_bundle.created this responds to (1:1)
  task_id: run-9c2e…
  agent: spec                          # spec | design — which crew agent produced the response
  artefact:
    kind: functional_spec              # functional_spec | technical_design
    ref:                               # the NEW ref after the re-draft (different commit from the bundle's)
      repo: fps4/maestro
      branch: maestro/run-9c2e
      path: docs/.../spec.md
      commit: def5678
  summary_of_changes: |
    One paragraph (≤ 120 words) explaining what changed at the artefact level,
    in plain language. Audience: the reviewer who triggered request_changes.
  addresses:                           # one entry per bundle item, in bundle order
    - comment_id: cmt-83b…
      action: addressed                # addressed | deferred | rejected
      note: |
        Added an empty-result case to AC-3: "WHEN export receives 0 rows,
        THE SYSTEM SHALL return an empty CSV with the header row only."
      ref_section:                     # OPTIONAL — where in the new artefact the change landed
        locator: { criterion_id: AC-3 }
    - comment_id: cmt-84c…
      action: deferred
      note: |
        Logged for the design gate — moves to the technical design after
        spec approval, since it's implementation detail.
      ref_section: null
  emitted_at: 2026-05-28T10:34:11Z
  attributed_to:
    agent: spec                        # the crew agent identity (run_id is the correlation id)
    run_id: run-9c2e
    model: claude-opus-4-7             # for audit (ADR-0009)
```

### Required-shape rules

1. **`bundle_id` is 1:1.** Each `feedback_bundle.created` has **at most one** `agent_response.posted`; the response IS the closure. If the reviewer requests changes again on the new artefact, that produces a **new** bundle (and a new response cycle, in a new event).

2. **`addresses[]` covers every bundle item.** Every `items[]` entry in the bundle MUST appear in `addresses[]` with the same `comment_id`. **No silent skipping.** Order matches bundle order. A bundle item the agent chose to leave unchanged is `action: deferred` or `rejected` with an explanatory `note`.

3. **`note` is required for every entry**, ≤ 240 characters (one sentence). Forces concision and makes the diff-of-artefact view legible. Empty notes are invalid.

4. **`summary_of_changes` is required**, ≤ 120 words / 800 characters — the same budget as ADR-0021's `maestro.summary`. Plain language, audience-aware. *Not* the same content as the artefact's `summary:` — that one describes the spec; this one describes the *change*.

5. **`artefact.ref.commit` differs from the bundle's `artefact.ref.commit`.** A response without an artefact change is invalid; the agent either commits a new ref or doesn't emit the response (and the cycle stays open — see *Failure modes*).

### Action semantics

| `action` | When | What the workspace renders | What the orchestrator does |
|---|---|---|---|
| `addressed` | The change was made in the new artefact ref | Green check next to the anchor; the note inline; "see the new content" link to the new ref's locator | None — the comment is settled |
| `deferred` | Relevant but addressed elsewhere (e.g. "belongs in the design") | Amber chevron; the note inline; carries the comment forward as **closed-out-here** | None — the comment stays "addressed" for composition rule 3 in ADR-0020; the reviewer can re-anchor on the next artefact if they want |
| `rejected` | The agent disagrees; the reviewer should reconsider or escalate | Red dot; the note inline; an explicit "argue back or escalate" affordance | None automatic — the gate does **not** auto-reopen; the reviewer's next visit decides |

The reviewer's options after a rejection are the same as after any artefact arrival: approve (accepting the rejection), request-changes (escalate with a new bundle), or reject the gate (US-0010 reject path).

### Eventing

| Event (in order) | Emitter | Purpose |
|---|---|---|
| `gate.decided` (`decision: request_changes`) | the write API on the decision POST | triggers bundle composition |
| `feedback_bundle.created` | the orchestrator | snapshots the bundle the agent will read |
| `agent_response.posted` | the spec / design agent | closes the cycle, with addresses + new ref |

The agent **must** push the new artefact commit (via the github adapter, ADR-0017) **before** emitting `agent_response.posted` — the event references a ref that must exist. The orchestrator records the commit through the standard webhook reconciler path, then accepts the response event.

### Composition with ADR-0020's bundle rule

ADR-0020 §composition-rule §3 says a comment is excluded from a new bundle if "there is no later `agent_response.posted` event with this `comment.id` in its `addresses[]`." This ADR makes that concrete: a comment with `action: addressed` or `action: deferred` is **closed for bundling**; a comment with `action: rejected` is **still open for bundling** (the reviewer's disagreement can flow back as a new anchored comment, which the next bundle includes).

That single rule preserves the legible loop: addressed/deferred → off the table; rejected → still in play.

## Consequences

- **The refinement loop has a definite closure event.** US-0010 / US-0013 agents know exactly what to emit; US-0032's workspace knows exactly what to render at the diff-of-artefact view; US-0031's interaction-pattern step 4 is implementable.
- **No silent skipping.** Every reviewer comment gets a reply (addressed / deferred / rejected). The non-technical reviewer doesn't have to ask "did the agent see this?" — the trichotomy answers it on every cycle.
- **One-shot per bundle.** A bundle has one response; a new request_changes makes a new bundle. The audit trail of "what the agent saw / what the agent did" is by replay.
- **No new system of record.** The response is an event in the existing log (ADR-0008); the artefact ref is in the repo (ADR-0006/0008); the projection joins them. Nothing else is authoritative.
- **The agent contract gains a small known amount.** Spec (US-0010) and design (US-0013) agents must emit `agent_response.posted` after every re-draft. The `ModelClient` budget covers it — ≤ ~150 lines of structured output per cycle.
- **`rejected` is legible.** The action exists explicitly so the agent doesn't have to choose between silent compliance and silent ignoring. The cost is a UX affordance for the reviewer ("argue back or escalate"); the gain is a real two-way conversation.
- **Workspace rendering is local-knowledge.** Step 4 of US-0031's refinement loop joins three sources the workspace already has: the new artefact (read API + ADR-0021 summary), the bundle items (`feedback_bundle.created`), and the response (`agent_response.posted`). No new fetch shape.

## Trade-offs explicit

- **Required per-item reply costs the agent tokens.** Worth it: the alternative (silent skipping) makes the loop opaque for the non-technical reviewer, defeating the US-0031 design.
- **`deferred` is an escape hatch.** It's tempting to ban it ("either address or reject"), but real specs split into spec-versus-design genuinely — forcing `addressed` or `rejected` would create false positives. The cost of `deferred` is the workspace must surface it differently from `addressed`; the trichotomy is the right tax.
- **One-shot per bundle is a hard rule.** A multi-round response (agent emits a partial response, waits, emits more) would let the agent stream progress, but the wire and the audit story stay simpler if a response is a single atomic event. Streaming, if needed, is a workspace-rendering concern (poll the new ref, show "agent working") not an event-shape concern.

## Failure modes

| Failure | Behaviour |
|---|---|
| Agent commits the new artefact but dies before emitting `agent_response.posted` | The orchestrator detects "bundle with new artefact ref but no response" via the projection. M1: re-run the agent on the same bundle (idempotent: the agent reads the bundle, sees its own commit, can emit the response directly). M2+: surface as `blocked` (US-0020) if the retry fails. |
| Agent emits `agent_response.posted` referencing a `commit` the webhook hasn't seen yet | The write path that accepts the event verifies the ref exists; if not, **`409 (artefact_ref_unknown)`** is returned and the agent retries after the next webhook tick. |
| Agent emits a response missing an `addresses[]` entry for a bundle item | **`422 (response_incomplete)`** — the agent must cover every bundle item. The agent's run-loop is responsible for emitting a complete response; the validator catches drift. |
| Agent emits a response with `note` over 240 chars or `summary_of_changes` over 120 words | **`422 (validation_failed)`** with the offending field named. The agent re-emits a tightened version. |
| Reviewer requests changes again while the agent is still mid-response | The new `gate.decided` creates a new bundle that includes any still-open anchored comments (per ADR-0020). The in-flight response, if it lands, closes the **earlier** bundle; the new bundle is independent. Two open bundles on one task is allowed but rare; the workspace shows them in chronological order. |

## Open questions

- **`agent_response.posted` write surface.** The agent emits this event through the orchestrator (it doesn't HTTP-POST to the workspace). The exact internal API the crew uses to append the event sits in the engine spine (the `ModelClient` / orchestrator boundary), not in this ADR. Concrete shape settles when US-0010's agent harness lands.
- **Per-item `ref_section` precision.** Optional in M1 (the comment's original `anchor.locator` is the fallback). When ADR-0031-flavour anchoring on free-form headings tightens, `ref_section` becomes more useful.
- **Streaming progress.** The agent may want to publish "I'm working on this bundle" as an intermediate event so the workspace doesn't show a blank panel. Out of scope here — a future `agent_status.heartbeat` event, decided when the workspace UI's "agent thinking" affordance is designed.
- **`rejected` escalation path.** Today the reviewer's options are workspace-local (approve / request-changes / reject). A future explicit "escalate to architect" affordance for commercial-product functional reviewers (whose architect isn't them) is an EP-04 / M4 concern.
- **Cross-artefact `deferred`.** When `action: deferred` says "moves to the design," is there a structured way for the agent to seed a follow-up at the design gate? M1: the deferral is informational; the design agent reads the spec's `agent_response.posted` events as context. M2+: a `deferred_to: design` field could automate the carry-forward; not in M1.
