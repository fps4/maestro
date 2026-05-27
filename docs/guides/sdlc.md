---
title: The maestro SDLC — spec-driven delivery
status: current
last_updated: 2026-05-25
owners: [architect]
related:
  - docs/principles.md
  - docs/architecture/decisions/0006-spec-driven-sdlc.md
  - docs/architecture/decisions/0003-split-review-routing-matrix.md
  - docs/guides/documentation-standards.md
---

# The maestro SDLC

How maestro takes a unit of work from intent to a merged pull request — and the protocol that governs how humans and agents collaborate to do it. maestro **runs** this loop for the products it builds and **follows** it for changes to maestro itself.

It is a **spec-driven** method: the specification is the source of truth; code is its expression. The shape is informed by the convergent practice of GitHub Spec Kit, AWS Kiro, and Tessl, adapted to maestro's split functional/technical review.

## The four artifacts

Each phase produces a markdown artifact that feeds the next. Two are owned by the functional track, two by the technical track.

| # | Artifact | Answers | Owner | Gate |
|---|----------|---------|-------|------|
| 1 | **Charter** | What are the durable rules? | product | — (set once) |
| 2 | **Functional spec** | What & why? | functional track | functional gate (pre-code) |
| 3 | **Technical design + tasks** | How? | technical track | technical (design) gate |
| 4 | **Implementation** | The code | technical track | technical (merge) gate |

### 1. Charter

Product-level durable principles and constraints. maestro's own charter is [`docs/principles.md`](../principles.md); a product may add stricter rules. Set once, changed rarely.

### 2. Functional spec

The "what & why": summary, scope (in/out), user stories, and **acceptance criteria in EARS form**:

> **WHEN** [trigger / condition] **THE SYSTEM SHALL** [observable behaviour].
> **IF** [unwanted condition] **THEN THE SYSTEM SHALL** [response].
> **WHILE** [state] … **WHEN** [trigger] **THE SYSTEM SHALL** [behaviour].

EARS makes criteria unambiguous and testable — which matters because **tests are generated from them**, so "spec adherence" is machine-verifiable and the functional reviewer can trust a green check instead of reading code. Tech-agnostic: no stack, no API shapes.

### 3. Technical design + tasks

The "how": architecture, data and API contracts, and an **ordered, dependency-aware task list**. A significant trade-off gets an ADR (see [documentation-standards](documentation-standards.md)). Each task **targets a repo** and references the requirement(s) it satisfies.

### 4. Implementation

Code on a `maestro/*` branch, expressed from the design, opened as a pull request annotated with **which requirement each change satisfies** (traceability).

## The clarify pass

Between phases, a read-only **consistency/clarify pass** runs before a human is asked to approve: it scans for ambiguity, gaps, and drift between spec ↔ design ↔ tasks, and surfaces *targeted* questions (one at a time) rather than guessing. This keeps the human review about judgement, not cleanup.

## The two gates

| Gate | When | Reviews | Owner |
|------|------|---------|-------|
| **Functional** | after the spec, **before any code** | the functional spec + EARS criteria | functional reviewer (commercial) / architect (technical) |
| **Technical (design)** | after the design | architecture + tasks | architect |
| **Technical (merge)** | after green DoD, before merge | the PR diff, annotated per requirement | architect |

Routing is resolved from [`config/reviewers.yaml`](../../config/reviewers.yaml) (see [ADR-0003](../architecture/decisions/0003-split-review-routing-matrix.md)). Each gate offers **approve / request-changes / reject**; request-changes returns the task to the agent that produced the artifact, with the feedback. Gates are **technically enforced** — an agent cannot proceed without an explicit positive decision — and delivered to the responsible participant in Slack.

## Definition of Done

A delivery task is **Done** only when all of these are green **before the human technical (merge) gate opens** (see [ADR-0006](../architecture/decisions/0006-spec-driven-sdlc.md)):

1. **Spec-adherence tests** generated from the acceptance criteria.
2. **Unit / integration / e2e** with the coverage threshold met.
3. **SAST** (CodeQL or Semgrep) — block on high severity.
4. **Dependency + secret scanning**.
5. **Hallucinated-dependency check** — every added package exists and is the intended one.
6. **License + SBOM** check.

Risk tiers may relax *human* review for low-blast-radius changes; SAST, secret, and dependency scans are a floor that is **never** disabled.

## The human / agent protocol

maestro's runtime crew and any AI agent working on maestro itself follow the same protocol. (This generalises the working agreement maestro inherited from its origins.)

**Roles**

| Party | Role |
|-------|------|
| **Human (architect / reviewer)** | Sets direction, approves at gates (including the merge), makes architectural decisions. |
| **Agent** | Produces specs/designs/code/tests/docs, runs the gates, reports status; never decides a gate; executes the merge only on a recorded human approval ([ADR-0016](../architecture/decisions/0016-merge-after-workspace-approval.md)). |

**Lifecycle** (mirrors the feature board columns):

```
intent → Draft (spec) ──[human accepts scope]──► Accepted
   → In Progress (design → build, DoD gates) → PR
   → green CI + gates ──► human approves merge ──► maestro merges ──► Done (CI-confirmed)
   (any gate request-changes → back to the producing stage; blocker → Blocked)
```

**What an agent must do**

- Read the spec, the relevant ADRs, and `standards/` before changing anything.
- Work on a `maestro/*` branch; open a pull request; keep CI green.
- Surface findings in the PR / report, not as silent assumptions.
- Propose an ADR when an architectural trade-off arises, and stop for the decision.

**What an agent must not do**

- Push to a default branch, or merge any PR without a recorded human approval at the merge gate ([ADR-0016](../architecture/decisions/0016-merge-after-workspace-approval.md)).
- Author a feature *and* sign off its review (reviewer ≠ implementer).
- Disable a Definition-of-Done floor gate (SAST / secret / dependency scan).
- Move a card to **Done** — `Draft → Accepted` is human-only; `In Progress → Done` is CI-only on green merge.

## Traceability

`Requirement → Task → PR/Commit` links are first-class. They let the functional reviewer confirm "was my intent built?" without reading code, let the architect trace any diff back to its requirement, and let a product-level view aggregate done-ness across the product's repos.

## References (the practice this is built on)

- GitHub Spec Kit — `constitution → specify → clarify → plan → tasks → analyze → implement`.
- AWS Kiro — `requirements.md` (EARS) / `design.md` / `tasks.md`, with requirement→design→task→diff links.
- Tessl — specs as versioned source of truth, with capabilities linked to tests.
- EARS — Easy Approach to Requirements Syntax.
