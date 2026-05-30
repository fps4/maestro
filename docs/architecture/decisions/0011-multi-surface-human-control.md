---
title: "0011: Multi-surface human control — Slack for architects, Telegram for functional reviewers"
status: accepted
date: 2026-05-25
related:
  - 0001-architect-directed-agentic-delivery.md
  - 0003-split-review-routing-matrix.md
  - 0010-public-engine-private-instance-data.md
  - ../overview.md
  - ../data-model.md
  - ../components/orchestrator.md
---

## Context

[ADR-0001](0001-architect-directed-agentic-delivery.md) fixed **Slack as *the* human control surface** and accepted GitHub / Slack / Anthropic as maestro's external dependencies. The operating reality is now different on two counts:

- **Different audiences, different tools.** The architect team works in Slack. Functional reviewers are a different population — often business/product people, and different per commercial product — reached on **Telegram**.
- **Per-product confidentiality.** A functional reviewer for product A must not see product B's gates. A single shared bot/app holding access to every product's group would be a confidentiality and blast-radius risk, directly counter to [ADR-0010](0010-public-engine-private-instance-data.md).

Gates are also **not one-to-one with a person**. A product may have two or more functional reviewers; architects are a team. The humans themselves decide who actively responds and who only monitors — maestro should not hard-assign a single named reviewer (the current US-0012 "@-mention the resolved reviewer, only that reviewer approves" rule).

## Decision

**The human control surface is a pluggable, per-role layer.** Four parts:

1. **A surface abstraction.** A `Surface` (`slack` | `telegram`, extensible) has an adapter implementing a common gate-delivery contract: deliver a gate to a destination with approve / request-changes / reject controls, receive a decision callback, and resolve the responder's identity. The orchestrator's `GateManager` is surface-agnostic. This **refines ADR-0001** ("Slack as the human surface" → "per-role surfaces behind one interface") and **adds Telegram** as an accepted external dependency.

2. **Surface chosen by role.** `architect → slack`, `functional_reviewer → telegram`. The role→surface map is engine policy in [`config/reviewers.yaml`](../../../config/reviewers.yaml). A future surface (email, Teams) plugs in here without touching routing logic.

3. **Gates post to a group; any role-holder decides.** A gate is delivered to a **destination group**, not a named person:
   - architect gates → one shared **architect Slack channel** (instance setting; architects are one team);
   - functional gates → the **product's Telegram group**.

   Any participant holding the gate's role for that product may issue the decision; the others **monitor silently** (who is the "main responder" is the group's own convention, not enforced). **Quorum is 1** — the first valid decision resolves the gate. maestro **records the deciding participant** and **ignores** decision callbacks from anyone lacking the role for that product (authorization + attribution).

4. **One Telegram bot per product.** Each product has its own Telegram bot (distinct token) bound to that product's group. The bot's access is scoped to exactly one product's group, so a compromised or misdirected token exposes **one** product — consistent with ADR-0010 private-by-default. Bot **tokens are secrets** (secret manager / env, referenced by a logical name from the register); the group `chat_id` and the bot reference are register config. Slack uses a **single workspace app** for the architect team (one audience), so the per-product-bot rule is Telegram-specific.

**Addressing & identity in the register.** A product carries its functional surface binding (`surface: telegram`, `bot: <ref>`, `group_chat_id`). Participants carry their per-surface user id (`slack_user_id` / `telegram_user_id`) so maestro can authorize and attribute a decision. These are instance data — private register, never the public repo (ADR-0010).

## Consequences

- **Right tool per audience; per-product isolation by construction.** Functional reviewers never see another product; a Telegram token's blast radius is one product.
- **Approval matches reality.** Multi-reviewer products and the architect team work as groups; maestro imposes no single assignee yet still records who decided — auditable (ADR-0009).
- **ADR-0003 extended, not replaced.** The matrix still yields `(product_type, gate) → role`; resolution now continues `role → surface → destination group`. Recording the new surface axis here satisfies the ADR-0003 rule that semantic routing changes need an ADR.
- **ADR-0001 refined.** Slack is the *architect* surface, not the only surface; Telegram joins the accepted external dependencies.
- **Relaxes "only the assigned reviewer approves"** (US-0012) to "any role-holder in the destination group," authorized by role membership.
- **More setup per product.** Onboarding a product with functional reviewers now provisions a Telegram bot + group and records the binding (see [`onboarding-a-product.md`](../../guides/onboarding-a-product.md)). Operational cost: N bots for N products — accepted for the isolation it buys.
- **Telegram feasibility.** Telegram bots support inline-keyboard buttons and callback queries in group chats, so approve / request-changes / reject works in-group; the callback carries the responder's Telegram user id for authorization and attribution.
- **Open questions:** quorum > 1 or a named-lead sign-off (deferred; default quorum 1); whether architects ever want per-product Slack channels (default: one shared channel, per-product override possible later); Telegram group-membership management (manual invite vs automated) — a deployment detail.
