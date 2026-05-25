---
title: "0001: Architect-directed agentic delivery"
status: accepted
date: 2026-05-24
related:
  - ../../product/vision.md
  - ../../principles.md
  - 0004-agents-propose-via-pr-humans-merge.md
  - 0005-product-domain-model.md
  - 0006-spec-driven-sdlc.md
---

## Context

Agentic coding tools cluster at two extremes. Assistants keep the human writing code line by line — little leverage. Autonomous agents take an issue to a merged PR with the human reduced to a bystander — which removes human judgement exactly where it matters most: deciding *what* to build and approving *before* code ships to a real repository.

maestro is for a different user: a single experienced **architect / technical product owner** who wants to direct the building of many systems at once — keeping judgement at the decision points, delegating execution, and doing it across the several repositories and collaborators a real product spans. The architectural question this ADR settles is what maestro fundamentally *is*, so every later decision inherits a consistent posture.

## Decision

maestro is an **architect-directed agentic delivery platform**. Four commitments define it:

1. **The human gates are the product, not friction.** A crew of agents executes; the architect (or, for a commercial product's functional spec, a designated reviewer) approves at defined gates. Removing the gates would make maestro an ungoverned code generator — the opposite of its purpose.

2. **Agents propose; humans dispose.** Agents work on `maestro/*` branches and open pull requests. They never push to a default branch and never merge. Merge is a human action, enforced in GitHub, not by agent goodwill (see [ADR-0004](0004-agents-propose-via-pr-humans-merge.md)).

3. **The product is the unit of work** — one or more repositories and one or more human participants, with one product type (`commercial` | `technical`) and per-product roles (see [ADR-0005](0005-product-domain-model.md)). This multi-repo, multi-participant model is what no mainstream tool implements and is maestro's clearest differentiator.

4. **Spec-driven.** The specification is the durable source of truth; code is its expression. Nothing is built without an approved spec (see [ADR-0006](0006-spec-driven-sdlc.md)).

maestro runs on a **cloud substrate** by deliberate choice — GitHub for code, Slack as the human surface, the Claude API for reasoning — trading self-hosting for best-in-class tooling. The one discipline kept is a single audited LLM egress ([ADR-0002](0002-claude-api-direct-via-modelclient.md)).

## Consequences

- **The differentiator must be protected.** If automation ever extends to autonomous merge, or to building end-user apps without a gate, maestro collapses into an ungoverned generator. The architect-in-the-loop, the split functional/technical review, and the product model are the product.
- **Blast radius is real.** maestro writes to the architect's real repositories, so the safety boundary (ADR-0004) is load-bearing, not a nicety.
- **Cloud dependencies are accepted.** maestro depends on GitHub, Slack, and Anthropic. This is a conscious trade for capability and is not in scope to revisit.
- **What this ADR does not cover.** The orchestration engine, the persistence of delivery-task/gate state, and the GitHub/Slack integration mechanisms are downstream engineering decisions, each with its own record when made.
