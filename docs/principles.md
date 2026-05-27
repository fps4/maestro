---
title: maestro principles and guidelines
status: current
last_updated: 2026-05-25
owners: [architect]
related:
  - docs/product/vision.md
  - docs/guides/sdlc.md
  - docs/architecture/decisions/0001-architect-directed-agentic-delivery.md
---

# Principles and guidelines

The durable rules for everything maestro builds and how it builds it. This is maestro's **charter** — principles applied to every product and every change. A product may add stricter rules; it may not relax these.

## 1. Spec-driven — the spec is the source of truth

Nothing is built without an approved spec. Work flows through a four-artifact spine:

1. **Charter** — this document plus any product-level additions. Durable.
2. **Functional spec** — what & why: user stories and **acceptance criteria in EARS form** ("WHEN [condition] THE SYSTEM SHALL [behaviour]"). Tech-agnostic.
3. **Technical design + tasks** — architecture, data/contracts, ordered task list.
4. **Implementation** — the expression of the spec.

**Why:** specs are cheap to change before code exists and expensive after; an explicit spec lets a human approve *intent* without reading a diff. **How:** every delivery task produces these artifacts in order; each is gated; acceptance criteria are written so tests can be generated from them. See [`docs/guides/sdlc.md`](guides/sdlc.md).

## 2. Human-in-the-loop by design

The gates are the product, not friction. Two gates, separately owned:

- **Functional gate** (pre-code) — *is this the right thing to build?* Owned by the **functional reviewer** for commercial products, the **architect** for technical products.
- **Technical gate** (design, and merge) — *is it designed and built right?* Owned by the **architect**.

**Why:** removing the gates makes maestro an ungoverned code generator; collapsing them into one PR-skim loses the architect's design authority. **How:** gates are technically enforced (an agent cannot proceed without an explicit positive decision), routed by `config/reviewers.yaml`, risk-tiered to avoid both over-gating and under-gating, and delivered to the responsible participants on their surface — architects in a shared Slack channel, functional reviewers in the product's Telegram group, where any role-holder may decide ([ADR-0011](architecture/decisions/0011-multi-surface-human-control.md)).

## 3. Agents propose, humans dispose

Agents work on `maestro/*` branches and open pull requests; they never push to a default branch. **The merge decision is a human action** — the architect approves the merge gate in the maestro workspace, and maestro then executes the merge against that recorded, role-authorized approval event (the event is the sole authority; nothing merges without it). A **reviewer agent may not author the feature it reviews** — independent checks, not self-grading. See [ADR-0016](architecture/decisions/0016-merge-after-workspace-approval.md) (supersedes [ADR-0004](architecture/decisions/0004-agents-propose-via-pr-humans-merge.md)).

## 4. Fully automated testing and quality gates

Every product has CI. A delivery task is **Done** only when, before the human technical gate opens, all of these are green (the Definition of Done — [ADR-0006](architecture/decisions/0006-spec-driven-sdlc.md)):

1. **Spec-adherence tests** generated from the functional spec's acceptance criteria.
2. **Unit / integration / e2e** with a coverage threshold.
3. **SAST** (CodeQL or Semgrep) — block on high severity.
4. **Dependency + secret scanning** (Dependabot/Renovate + secret scan).
5. **Hallucinated-dependency check** — verify every added package exists and is the intended one (AI code's signature failure mode).
6. **License + SBOM** check (see principle 5).

**Why:** AI-generated code carries materially higher defect and vulnerability rates, so gates must *block*, not advise. Risk tiers may relax *human* review for low-blast-radius changes, but SAST, secret, and dependency scans are a floor that is **never** disabled.

## 5. Open-source as a value; repos private by default

Two distinct axes, deliberately held apart:

- **Open-source as a value** — prefer open-source dependencies and permissive licenses; build so a repo *can* be opened later. Treat agent output like a third-party contribution: scan licenses, check OSS similarity/attribution, emit an SBOM per build, track provenance.
- **Repo visibility — private by default.** Making a repo public is a deliberate, recorded **per-product** decision, not the default.

**Why:** the work spans commercial and technical products; defaulting to private protects commercial work, while the OSS-value bias keeps dependencies clean and keeps the option to open things open. **How:** product creation sets visibility explicitly and records an allowed-license policy; CI enforces license/SBOM regardless of visibility.

## 6. Deploy where the product needs — with preferences, kept open

There is no single hosting target. Per product, in preference order, but open:

- **Default:** lab servers (`ds1` / `ds2`) for development and self-hosting (maestro itself can run there too).
- **Production option:** **AWS**.
- **Exception, from day one:** if the product's technology requires **AWS / Azure / GCP** up front, that cloud is the product's infra platform and is written up as such in the product's own docs.

**Why:** forcing one platform either wastes the lab servers or blocks technology that needs a specific cloud. **How:** deployment target is a per-product setting with a documented rationale (see [ADR-0007](architecture/decisions/0007-per-product-deployment-targets.md)); the provisioning/deploy capability is a later build phase.

## 7. The product is the unit of work

A **product** has **one or more repositories** and **one or more human participants** (the architect always included) and one **product type** (`commercial` | `technical`) its repos inherit. Model **Product↔Repo and Participant↔Product as many-to-many with per-product roles**; keep **requirement → task → PR traceability** first-class so "is the product done?" aggregates across repos. See [ADR-0005](architecture/decisions/0005-product-domain-model.md).

**Why:** real products span several repos and several people; no competing tool models this, and it is maestro's clearest differentiator. **How:** gates route to the participant whose product role owns them; a persistent knowledge/context agent indexes all of a product's repos as one mental model.

## 8. Claude direct, with audit discipline

All reasoning goes through a single internal **`ModelClient`** that calls the **Anthropic API directly** — to use native prompt caching, extended thinking, and tool use — and records every call (agent, tokens, cost, cache hits) to maestro's own audit log. `base_url` is configurable, so any OpenAI/Anthropic-compatible router can be flipped on as an optional layer; none is a dependency. See [ADR-0002](architecture/decisions/0002-claude-api-direct-via-modelclient.md).

**Why:** the value is Claude-native capability and a clean own audit trail, not a mandatory proxy hop. **How:** no agent imports a provider SDK directly; the single `ModelClient` is the only egress and the only audit writer.

## 9. Standards are machine-injected, not tribal

The SDLC standards above are encoded as machine-readable rules in [`standards/`](../standards/) that the crew reads on every task — not as documentation humans are trusted to remember. This is how the SDLC stays standardised as the crew and the number of products grow.

## 10. Graduated, revocable autonomy

A new product starts more-gated. As a crew demonstrates reliability on a repo, auto-merge eligibility for low-risk change classes may be relaxed — with one-switch revocation and a full audit trail. Autonomy is earned per product and per change class, never a launch-time global toggle.

## 11. Open-core — public engine, private instance data

The maestro **engine and its conceptual docs are open source**; **everything about the products it builds is private and never lives in the public repo.** Product code sits in each product's own (private-by-default) repos; specs/designs seed the *product's* repo; operational state and audit logs live in maestro's store on a private host; the product register is gitignored (only a template is public). The public repo ships templates and design, never product data. See [ADR-0010](architecture/decisions/0010-public-engine-private-instance-data.md).

**Why:** open-sourcing the engine must never risk product confidentiality. **How:** the real register loads from a configurable path (default `config/products.yaml`, gitignored) that can point at a private repo/overlay; `.gitignore` enforces the floor so product data can't be committed by accident.
