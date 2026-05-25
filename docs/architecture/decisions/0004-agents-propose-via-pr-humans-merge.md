---
title: "0004: Agents propose via pull request; humans merge"
status: accepted
date: 2026-05-24
related:
  - 0001-architect-directed-agentic-delivery.md
  - 0003-split-review-routing-matrix.md
  - 0006-spec-driven-sdlc.md
  - ../../product/user-stories/EP-01-delivery-loop/US-0011-implement-and-open-pr.md
---

## Context

maestro's agents write to the architect's **real** GitHub repositories. An agent able to push to a default branch or merge a pull request could ship unreviewed code to production. The split-review matrix ([ADR-0003](0003-split-review-routing-matrix.md)) only has meaning if there is no path around it, and because maestro operates autonomously across many repos and products, the principle must be an enforced boundary, not a convention.

## Decision

**Agents propose; humans dispose.**

- Agents create **feature branches** (the `maestro/*` namespace) and open **pull requests**. They never push to a default branch and never merge.
- **Merge is exclusively a human action**, performed behind the applicable gate (ADR-0003). maestro contains no code path that merges a PR or pushes to a default branch.
- The boundary is enforced at the **credential layer**, not just in code: maestro's GitHub credentials are scoped to branch-create + PR-open, without merge rights. Setup verifies maestro *cannot* merge, not merely that it *chooses* not to.
- **GitHub branch protection** on the default branch (required reviews + required status checks + CODEOWNERS) is a complementary enforcement so the rule holds even if application code is wrong.
- A **reviewer agent may not author the feature it reviews** — independent checks, not an agent grading its own work.
- "Done" for a delivery task is driven by the **observed merge event**, never by an agent asserting completion.

## Consequences

- **The gate cannot be bypassed.** With no merge capability, every change to a default branch necessarily passes through a human at the gate. This is the mechanism that makes ADR-0003 real.
- **Two layers of defence.** Even if application code attempted a merge, the credential scope refuses it; even if the credential were misconfigured, branch protection holds. Neither layer alone is trusted.
- **Throughput is bounded by human merge capacity** — by design. maestro's leverage is in spec/design/implementation, not in removing the merge decision. If this bottlenecks, the answer is better-prepared PRs (green on all Definition-of-Done gates — [ADR-0006](0006-spec-driven-sdlc.md)), not auto-merge.
- **What this does not cover.** Whether the technical merge gate reuses GitHub's native PR approval, a Slack approval, or both is an open PRD-0001 question — but whichever is chosen, the *merge click* remains human.
