---
title: "0016: Merge after workspace approval — the human decides, the agent executes the merge (supersedes ADR-0004)"
status: accepted
date: 2026-05-27
related:
  - 0004-agents-propose-via-pr-humans-merge.md
  - 0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - 0008-system-of-record-and-persistence.md
  - 0009-audit-logging-and-observability.md
  - 0011-multi-surface-human-control.md
  - 0006-spec-driven-sdlc.md
  - ../webapp-concept.md
  - ../../product/vision.md
---

## Context

[ADR-0004](0004-agents-propose-via-pr-humans-merge.md) made merge an **exclusively human action**,
enforced at two independent layers: a GitHub credential **without merge rights**, and **branch
protection** as a complementary lock — so the merge click was always a human's, and first run verified
maestro *could not* merge.

The [webapp concept](../webapp-concept.md) (extending [ADR-0015](0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md))
moves the human's **merge decision** into the maestro workspace: the architect approves /
request-changes / rejects the merge gate there, and that decision becomes a role-authorized, attributed
event in maestro's log (ADR-0008/0009/0011). Once the judgement is captured and recorded, requiring the
same human to *also* physically click merge in GitHub is redundant friction — the **decision**, not the
click, is what governance needs. The architect has chosen to let maestro execute the merge against that
recorded approval, with **the approval event as the sole authority** (no GitHub-side backstop).

This supersedes ADR-0004's mechanic while keeping its purpose: no change reaches a default branch
without an explicit, attributed human decision.

## Decision

**The human decides the merge in the workspace; maestro executes it against the recorded approval.**

1. **The decision stays human and is the gate.** At `merge_gate` the architect approves /
   request-changes / rejects **in the workspace** (the PR diff + green DoD shown there). Nothing merges
   without an approve.
2. **The approval is an event, and it is the sole authority.** On approve, the orchestrator appends a
   **merge-approval event** — role-authorized for that product (ADR-0011), attributed (ADR-0009) — to
   the append-only log (ADR-0008). That event is the **only** thing that authorizes the merge; there is
   no GitHub-side review or branch-protection backstop (the architect's chosen model).
3. **maestro executes the merge.** The orchestrator instructs the **github adapter** to merge — a
   deterministic adapter action, **not** a crew agent (no reasoning; reviewer ≠ author does not apply).
   The adapter **refuses unless** handed a valid merge-approval event: one that exists, is typed
   merge-approval, matches this task + PR, was made by a participant holding the gate's role for the
   product, and has **not already been consumed** (anti-replay). Otherwise it rejects and logs.
4. **The credential boundary inverts.** maestro's GitHub credential **gains merge rights** (scoped to
   merging `maestro/*` into the default branch for its products). ADR-0004's platform-level "cannot
   merge" backstop is **removed**; the backstop is now **maestro-internal** — the event-gated adapter.
5. **Retained from ADR-0004:** agents propose via `maestro/*` branches + PRs and never push to a
   default branch directly; **reviewer ≠ author**; DoD floors green before the gate opens (ADR-0006);
   "Done" is keyed on the **observed merge event**, never an agent's claim.

## Consequences

- **Governance is preserved; only the mechanical click moves.** Every default-branch change still
  passes an explicit, attributed human decision. Throughput improves marginally (no manual merge step)
  but is still bounded by the human *decision*, by design.
- **Defence drops from two layers to one — stated plainly.** ADR-0004's independence (credential scope
  *and* branch protection, neither trusted alone) is gone. If **maestro itself is compromised**, there
  is no longer an independent GitHub-side layer preventing an unapproved merge. This is the accepted
  cost of the "sole authority" model.
- **The approval event and the adapter check are now security-critical** — their integrity *is* the
  boundary. Mitigations: the event log is hash-chained + WORM (ADR-0009), so an approval cannot be
  forged or back-dated undetectably; the adapter's verification (decider identity, task/PR match,
  single-use) must be server-side and is itself covered by acceptance tests.
- **First-run verification changes.** US-0001's "verify maestro *cannot* merge" becomes "verify maestro
  **refuses to merge without** a valid, role-authorized, unconsumed merge-approval event" — a negative
  test that an unapproved / forged / replayed merge is rejected and logged. The check stays
  load-bearing; its content inverts.
- **Relationships.** **Supersedes ADR-0004** (its mechanic; retains the purpose + the items above).
  **Refines ADR-0015** — the merge gate becomes an *actioning* surface, not informational. **Leans on
  ADR-0008/0009/0011** for the authoritative, attributed, role-checked event.
- **Docs remapped on acceptance:** `vision.md`, `principles.md` (#3), `sdlc.md`, `setup.md`,
  `standards/git.yaml` + `standards/patterns.yaml`, `data-model.md`, `overview.md`, `orchestrator.md`,
  the operational guides (`repo-controls.md`, `onboarding-a-product.md`, `README.md`), `PRD-0001`, and
  US-0001 / US-0011 / US-0015 / US-0020. Still to remap: **`roadmap.md`** (rides the re-baseline).
- **Open questions:**
  - ~~Optional defence-in-depth per product (a GitHub required-status-check)?~~ **Resolved
    (2026-05-27): no.** The architect chose the **single-layer** model — GitHub-side branch protection /
    required reviews / merge-less token are not used; the event-gated adapter + WORM log is the only
    boundary.
  - Merge method (squash / merge / rebase) and whether the agent deletes the `maestro/*` branch
    post-merge — engineering details.
