---
title: "US-0040: Notification channel topology — destination resolution per product"
persona: architect
status: draft
complexity: M
milestone: M3
last_updated: 2026-05-28
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0011-multi-surface-human-control.md
  - docs/architecture/decisions/0010-public-engine-private-instance-data.md
  - docs/architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - docs/roadmap.md
  - docs/guides/onboarding-a-product.md
  - docs/product/user-stories/EP-04-notifications/US-0041-pr-lifecycle-notifications.md
---

## Story

As the architect,
I want a stated topology for the Slack/Telegram **notification** channels — one place that resolves "which channel does this event go to?" per product —
so that lifecycle notifications (US-0041) have a defined destination and the register tells onboarding what to provision, without baking the answer into adapter code.

## Context

[ADR-0011](../../../architecture/decisions/0011-multi-surface-human-control.md) decided the **gate-delivery** topology: architect gates → one shared architect Slack channel (instance setting `ARCHITECT_SLACK_CHANNEL`, *not* per product); functional gates → the product's Telegram group via the product's own bot. It left as an **open question** *"whether architects ever want per-product Slack channels (default: one shared channel, per-product override possible later)"*.

M3 demotes Slack/Telegram to **notification + deep-link** channels ([`roadmap.md`](../../../roadmap.md), [`webapp-concept.md`](../../../architecture/webapp-concept.md) line 171). At that point the channel question reopens: a single shared channel is fine for a one-product dogfood; once the portfolio grows it gets noisy. This story resolves the open question by recording a topology — and the resolver that consumes it — *before* US-0041 hard-codes a destination.

This story does **not** introduce an "incident" concept. There is none in the data model today ([`data-model.md`](../../../architecture/data-model.md)); per-incident channels are explicitly out of scope until incidents are modelled.

## Acceptance criteria (EARS)

- THE SYSTEM SHALL resolve a notification destination from a **single channel resolver** parameterised by `(product_id, event_kind, role)`, never from hard-coded channel names in adapter code.
- THE SYSTEM SHALL accept a product-level **Slack notification channel** binding on a product (`notification_channel: { surface: slack, channel: <name-or-id> }`) and, when present, route that product's notifications there; WHEN absent, THE SYSTEM SHALL fall back to the shared architect channel (`ARCHITECT_SLACK_CHANNEL`). This resolves the ADR-0011 open question with **"shared by default, per-product override supported."**
- THE SYSTEM SHALL keep `ARCHITECT_SLACK_CHANNEL` as the **instance** default for architect-audience notifications when no per-product override is set; gate **delivery** routing (ADR-0011, US-0012) is unchanged by this story.
- WHEN a product's `notification_channel.channel` is given as a name (not an id), THE SYSTEM SHALL resolve it to a channel id at boot or at first use, log the resolved id, and refuse to start the notifier if resolution fails (no silent fall-through to the shared channel without an `IF` clause).
- WHEN a notification destination is resolved, THE SYSTEM SHALL record the resolution (product, event_kind, channel_id, source: instance-default | product-override) in the audit log; **no destination is silently chosen**.
- IF the per-product channel exists but the bot lacks `chat:write` (or the Telegram bot lacks group-membership), THEN THE SYSTEM SHALL log the failure, fall back to the shared architect channel **with an explicit "fallback" tag in the message**, and surface the failure on the next architect notification (so a misconfigured product is visible, not invisible).
- THE SYSTEM SHALL treat Telegram **gate-delivery groups** (ADR-0011) as distinct from notification channels: a product's `functional_channel` (gates, Telegram) and `notification_channel` (Slack, this story) are independent settings; a product MAY have one without the other.
- THE SYSTEM SHALL document the resolved topology in [`onboarding-a-product.md`](../../../guides/onboarding-a-product.md): per-product Slack channels are **optional**, not required for onboarding.

## Channel naming and lifecycle (recommendations, not enforced)

These are conventions the topology table records, not code-enforced rules:

- Per-product Slack channel naming: `#maestro-<product_id>` (e.g. `#maestro-acme-billing`). The register stores the channel id; the name is human-readable only.
- A channel's lifecycle follows the product's: create at onboarding (manual), archive when the product is retired. Maestro does not auto-create or auto-archive channels in this story — that is a deployment task in the onboarding checklist.

## Out of scope

- **Auto-provisioning Slack channels.** maestro **reads** a channel binding; it does not create channels on its own. A "create the channel for this product" affordance is a future story (likely part of PRD-0002 onboarding).
- **Per-incident channels.** There is no `Incident` entity in maestro's domain model ([`data-model.md`](../../../architecture/data-model.md)). Adding one (and per-incident notification channels) needs its own PRD and ADR, and is not part of M3.
- **Changing gate-delivery routing.** Architect-gate delivery still goes to `ARCHITECT_SLACK_CHANNEL` per ADR-0011 / US-0012 / US-0017; this story governs **notifications**, not gate delivery.
- **Per-thread Slack threading** (e.g. one thread per delivery task). A natural follow-up to US-0041 but not required to ship M3 notifications.
- **Telegram notifications to functional reviewers.** This story's per-product binding is Slack-only by default; Telegram remains the **gate** surface for commercial products (ADR-0011). A Telegram notification override can plug into the same resolver later.

## Notes

This story is small but load-bearing: it resolves ADR-0011's deferred channel question by **codifying the resolver shape** rather than the channel list. The default ("shared architect channel for everything") keeps the dogfood instance simple; the per-product override path is the seam a multi-product instance needs without re-litigating ADR-0011.

The "register has the binding, secret store has the token" rule from ADR-0011 / [`onboarding-a-product.md`](../../../guides/onboarding-a-product.md) extends unchanged: channel ids/names in `config/products.yaml`; tokens (Slack app, Telegram bots) only in the secret store.
