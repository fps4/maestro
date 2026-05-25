---
title: "0001: Architect-directed delivery loop"
status: draft
last_updated: 2026-05-25
owners: [architect]
related:
  - docs/product/vision.md
  - docs/principles.md
  - docs/guides/sdlc.md
  - docs/product/user-stories/EP-00-platform-scaffold/US-0001-platform-setup.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0010-draft-functional-spec.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0011-implement-and-open-pr.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0012-route-review-by-product-type.md
  - docs/architecture/decisions/0005-product-domain-model.md
  - docs/architecture/decisions/0006-spec-driven-sdlc.md
---

## Summary

The founding capability of maestro: a **spec-driven delivery loop** that takes one unit of work from intent to a merged pull request, with a Claude agent crew doing the execution and the right human approving at each gate. The loop runs inside a **product** (one-or-more repos, one-or-more participants) and standardises the four-artifact spine — charter → functional spec → technical design + tasks → implementation. This PRD defines that loop, the two human gates, the automated quality gates that precede the human, and the traceability that ties them together. It advances the vision goal that *the architect takes a system from intent to a merged, reviewed PR without writing the implementation by hand.*

> **Scope note.** The **product / repo / participant** domain model is specified in [ADR-0005](../../architecture/decisions/0005-product-domain-model.md); product creation and participant management as a user-facing flow is **PRD-0002 (planned)**. This PRD assumes a product exists with at least one repo and the architect as a participant.

## Problem statement

The architect needs a repeatable pipeline they can hand a unit of work to, trust to execute, and step into only at decision points. Without a defined loop — explicit artifacts, explicit gates, explicit reviewer routing, and machine-enforced quality before any human looks — agent work is either ungoverned (unreviewed code merges, AI-typical defects slip through) or bottlenecked (every step waits on the architect, including functional sign-off that should belong to someone else on commercial work).

## Users and context

When the architect has a unit of work, they dispatch it from Slack against a product and a target repo, and are pulled back in only to: approve the spec (if functional review is theirs), approve the design, approve the diff, and merge. For commercial products the functional reviewer approves the spec instead. The architect runs many such loops concurrently across products.

## The loop

```
Charter (product, durable)
  │
  intent (Slack)
  │
  ▼ spec agent
Functional spec  ──[ FUNCTIONAL GATE ]──►   (functional reviewer | architect, per product_type; PRE-CODE)
  │  user stories + EARS acceptance criteria
  ▼ architect/planner agent
Technical design + tasks  ──[ TECHNICAL (DESIGN) GATE ]──►   (architect)
  │
  ▼ crew builds on a maestro/* branch
Automated quality gates (all must pass)
  │  spec-tests · unit/integration/e2e+coverage · SAST · deps+secrets · hallucinated-dep · license/SBOM
  ▼
Pull request, annotated per requirement  ──[ TECHNICAL (MERGE) GATE ]──►   (architect; risk-tiered, agent-pre-reviewed)
  │
  ▼  a human merges in GitHub  →  delivery task done
```

The full method — artifact templates, gate mechanics, the Definition of Done, and the human/agent protocol — is in [`docs/guides/sdlc.md`](../../guides/sdlc.md).

## Scope

### In scope

- A **delivery task**: one unit of work, owned by a product, targeting one repo (v1), moving through the loop.
- The **four-artifact spec-driven spine** with the functional spec carrying **EARS-form acceptance criteria**.
- **Two human gates** — functional (pre-code) and technical (design, and merge) — routed by `config/reviewers.yaml` against the product's `product_type`.
- **Automated quality gates** that must be green before the technical merge gate opens (Definition of Done — [ADR-0006](../../architecture/decisions/0006-spec-driven-sdlc.md)).
- **Requirement → task → PR/commit traceability**, surfaced on the PR.
- **Slack** as the control surface: dispatch, per-gate per-participant actionable approvals, status.
- **GitHub** as substrate and enforcement: `maestro/*` branches, draft PR per task, branch protection + required checks + CODEOWNERS as the real merge lock.
- **Claude via a single internal `ModelClient`**, calling the Anthropic API directly, recording cost/audit per call ([ADR-0002](../../architecture/decisions/0002-claude-api-direct-via-modelclient.md)).

### Out of scope

- Product / participant management as a flow (PRD-0002 planned).
- A single delivery task spanning **multiple repos** at once (v1 targets one repo per task; the product may have many).
- Deployment/hosting of built products to lab servers or cloud (target model in [ADR-0007](../../architecture/decisions/0007-per-product-deployment-targets.md); build is a later phase).
- A bespoke maestro web UI (Slack + GitHub UI only).
- Automated merge or automated production deploy.

## Requirements

### Functional requirements

1. The architect can create a delivery task from Slack against a named product and target repo by describing a unit of work.
2. The spec agent produces a **functional spec** (summary, scope, user stories, EARS acceptance criteria); a consistency/clarify pass flags ambiguities before a human is asked to review.
3. The functional gate routes to the reviewer resolved from `config/reviewers.yaml` for the product's `product_type` (commercial → functional reviewer; technical → architect). The task does not advance until that reviewer approves.
4. After functional approval, the architect/planner agent produces a **technical design + ordered tasks** (and an ADR when a significant trade-off exists), posted to the technical (design) gate, routed to the architect.
5. After design approval, the crew implements on a `maestro/*` feature branch and opens a **draft pull request** — never pushing to a default branch, never merging.
6. Before the technical merge gate opens, **all automated quality gates pass**: spec-derived tests, unit/integration/e2e with coverage threshold, SAST (block on high), dependency + secret scan, hallucinated-dependency check, and license/SBOM check.
7. A **reviewer agent** (which may not author the feature it reviews) posts a triaged, severity-tagged review on the diff; maestro then posts the PR to the technical merge gate for the architect.
8. The PR shows **which requirement each change satisfies**; the architect reviews and **merges manually** in GitHub. maestro marks the task done on the observed merge event.
9. Each gate supports **approve / request-changes / reject**; request-changes returns the task to the agent that produced the artifact, with the feedback.
10. Every LLM call goes through the internal `ModelClient` and is recorded (agent, tokens, cost, cache hits) in maestro's audit log.

### Non-functional requirements

- **Auditability:** every gate decision (who/what/when/why) and every LLM call is recorded, queryable per product.
- **Safety:** no code path merges or pushes to a default branch; the GitHub credential lacks merge rights, and branch protection enforces human merge independently.
- **Quality floor:** SAST, secret scanning, and dependency scanning can be risk-tiered but never disabled.
- **Native LLM features:** prompt caching and extended thinking are used where they reduce cost/latency; the direct Anthropic path must preserve them.

## Open questions

| Question | Owner | Due |
|----------|-------|-----|
| State of record for delivery-task/gate/traceability — maestro-owned store, GitHub (Issues + sub-issues + issue-fields + PR state), or hybrid? | @architect | 2026-06-15 |
| Does the merge gate reuse GitHub's native PR review/approval, a Slack approval, or both (Slack UX + GitHub enforcement)? | @architect | 2026-06-15 |
| How does a functional reviewer who is not a GitHub collaborator approve a spec — Slack-only, or a lightweight GitHub identity? | @architect | 2026-06-15 |
| Which automated gates are required vs advisory at v1, and what are the risk tiers for auto-eligible vs human-required merges? | @architect | 2026-06-30 |

## Out of scope decisions deferred to engineering

- Orchestration foundation — build on the **Claude Agent SDK** (subagents, hooks, MCP) vs a bespoke state machine.
- Persistence choice for delivery-task / gate / traceability state.
- GitHub integration mechanism (GitHub App vs PAT) and Slack integration mechanism (Slack app — Socket Mode vs Events API).
- Concrete SAST/dependency/secret/SBOM tool selection (e.g. CodeQL vs Semgrep; Dependabot vs Renovate).
