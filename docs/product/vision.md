---
title: Product vision — maestro
status: current
last_updated: 2026-05-25
owners: [architect]
related:
  - docs/principles.md
  - docs/product/prd/0001-architect-directed-delivery-loop.md
  - docs/architecture/decisions/0001-architect-directed-agentic-delivery.md
---

## Problem

Building real software systems still requires a team: someone to turn intent into a spec, someone to design, someone to implement, someone to test and review. A single experienced architect can hold the *direction* of many systems in their head but cannot personally execute the volume of implementation work that direction implies. Hiring a team is slow and expensive. Fully autonomous code generation goes too far the other way — it removes human judgement exactly where it matters most: at the definition of *what* is being built, and at the gate *before* code ships to a real repository.

The gap is a way for one architect to direct the building of many systems at once — keeping human judgement at the decision points, delegating the execution, and doing it across the several repositories and collaborators a real product spans.

## Users

- **Primary: the architect / technical product owner** (a single experienced engineer — the user). Sets direction, owns every architectural and technical decision, and approves every merge. Participates in *every* product. Wants leverage — to ship more systems than they could build by hand — without surrendering control of *what* gets built or *how*.
- **Secondary: the functional reviewer.** A product/business participant who signs off on *what* a commercial product should do. They review functional specs, not code. They exist for commercial products; for technical products the architect performs functional review too.
- **Other participants.** A product may include additional humans (stakeholders, domain reviewers) with product-scoped roles. The architect is always among them.

## What maestro is

maestro is the architect's **agentic engineering org**: a crew of Claude-powered agents that take a unit of work from intent → functional spec → technical design → implementation → reviewed pull request, on real GitHub, coordinated through Slack and Telegram, gated by the right human at each step.

It organises work around a **product** — the unit no competing tool models:

- A **product** has **one or more repositories** and **one or more human participants** (the architect always included), and one **product type** (`commercial` or `technical`) its repos inherit.
- A single unit of intent can produce **coordinated changes across several repos** in the product; "done" aggregates across them.
- Each gate routes to the participant whose role owns it.

## How maestro works (the spine)

maestro standardises a **spec-driven SDLC**: the specification is the durable source of truth; code is its expression. Four artifacts, split across the two review tracks:

1. **Charter** (product, durable) — the product's principles and constraints. Set once.
2. **Functional spec** — what & why, user stories, acceptance criteria in EARS form. → **functional gate** (functional reviewer for commercial; architect for technical), *before any code*.
3. **Technical design + tasks** — architecture, data/contracts, ordered task list. → **technical (design) gate** (architect).
4. **Implementation** — the crew builds on a `maestro/*` branch across the product's repos, automated quality gates run, a pull request opens annotated with which requirement each change satisfies. → **technical (merge) gate** (architect, decided in the workspace) → **maestro executes the merge against that recorded approval** ([ADR-0016](../architecture/decisions/0016-merge-after-workspace-approval.md)).

Requirement → task → PR traceability is first-class, so the functional reviewer can confirm "was my intent built?" without reading code. The full method is in [`docs/guides/sdlc.md`](../guides/sdlc.md).

## Goals

- The architect takes a system from intent to a merged, reviewed PR — across a multi-repo product — **without writing the implementation by hand**, while personally approving every architectural and technical decision.
- Every change reaches a default branch **only through a human-approved merge gate**; maestro executes the merge only against that recorded, role-authorized approval event — nothing merges without it ([ADR-0016](../architecture/decisions/0016-merge-after-workspace-approval.md)).
- Functional sign-off on commercial products is owned by the functional reviewer, not the architect — the architect's attention stays on technical correctness.
- Quality is **machine-enforced before a human looks**: spec-derived tests, security and dependency scans, and license/SBOM checks all pass before the technical gate opens.
- Every agent action and every gate decision is **auditable** — who, what, when, why — per product.

## Principles (summary)

Full text in [`docs/principles.md`](../principles.md):

- **Spec-driven** — specs are the source of truth; nothing is built without an approved spec.
- **Human-in-the-loop by design** — the gates are the product, not friction.
- **Agents propose, humans decide the merge** — agents open PRs on `maestro/*` branches; the architect approves the merge gate in the workspace and maestro executes the merge against that recorded approval ([ADR-0016](../architecture/decisions/0016-merge-after-workspace-approval.md)).
- **Fully automated testing** — every product has CI; tests and quality gates block merge.
- **Open-source as a value, private by default** — favour OSS dependencies and permissive licenses, build so a repo *can* be opened; repos are private by default and made public as a deliberate per-product decision.
- **Deploy where the product needs** — default to lab servers; **AWS** for production; **AWS/Azure/GCP from day one** when the product's technology requires it.

## Non-goals

- **Not an end-user app generator.** maestro serves the architect and targets real systems; it does not turn a layperson's natural-language request into a finished app.
- **Not autonomous delivery.** Removing the human gates would turn maestro into an ungoverned code generator. The architect-in-the-loop and the split functional/technical review are the product.
- **A maestro web app for functional reviewers** (reverses the original "no bespoke UI" non-goal — [ADR-0015](../architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md)). Architects stay on Slack + GitHub; functional reviewers get a maestro-owned chat webapp (on an MIT/open base — shadcn/ui + Next.js) plus a **repo-linked docs wiki** for reading specs. Telegram becomes an optional low-touch surface. The repo stays the single source of truth; the wiki and webapp are surfaces, not a second store (ADR-0008).
- **No mandatory LLM proxy.** maestro calls the Claude API directly for native prompt caching / extended thinking / tool use, behind a single internal client that records cost and audit (see [ADR-0002](../architecture/decisions/0002-claude-api-direct-via-modelclient.md)).

## Success metrics

- **Leading (behaviour):** number of delivery tasks the architect runs concurrently from intent to merged PR per week, versus building by hand.
- **Leading (quality):** share of PRs that reach the human technical gate already green on all automated gates (so the human reviews vetted work, not raw output).
- **Lagging (outcome):** share of merged PRs with no post-merge revert attributable to a missed review — i.e. the gates caught what they should.

## Where maestro deliberately differs from the market

Validated against Devin, Factory.ai, GitHub Copilot coding agent, Cursor, Jules, Sweep, OpenHands and others (2025–2026). maestro's safe bets — issue→plan→PR, no merge without a human decision, coordinator + bounded-role crew, a chat control surface, persistent context — are all mainstream best practice. Its defensible novelty is the **governance model** that none of them implement:

1. **Architect-owned design gate** as the central organising principle (not "PR review by whoever's around").
2. **Split functional vs technical review** as two separately-owned gates.
3. **Product = many repos + many participants with per-product roles**, with cross-repo traceability.
