---
title: Onboarding a product
status: draft
last_updated: 2026-05-25
owners: [architect]
related:
  - config/products.example.yaml
  - config/README.md
  - docs/guides/repo-controls.md
  - docs/architecture/decisions/0005-product-domain-model.md
  - docs/architecture/decisions/0008-system-of-record-and-persistence.md
  - docs/architecture/decisions/0010-public-engine-private-instance-data.md
  - docs/architecture/decisions/0011-multi-surface-human-control.md
---

# Onboarding a product

How to register a new product with maestro and make its repos ready for the delivery loop.

> **Scope today (founding scaffold).** Onboarding is currently a **config + per-repo-setup** act.
> The engine that *runs* the loop (orchestrator, agent crew, adapters) is not built yet, and
> product/participant management as a guided flow is **PRD-0002 (planned)**. So onboarding now
> means: register the product, and put the GitHub-side controls in place so it is ready the moment
> the engine lands.

## 1. Register the product (config-as-code)

The register is your **private** `config/products.yaml` (gitignored; ADR-0010). Create it from the
template if you have not already:

```bash
cp config/products.example.yaml config/products.yaml   # gitignored; never committed
```

Add a product block. A product has 1+ repos and 1+ participants (the architect always included),
one `product_type` it inherits to its repos, a `visibility`, and a `deploy_target`:

```yaml
  - id: acme-billing
    name: Acme Billing
    product_type: commercial      # commercial | technical  (routes functional review — ADR-0003)
    visibility: private           # private by default (principle 5)
    deploy_target:                # ADR-0007
      from_day_one: aws           # or: { default: ds1, production: aws }
    repos:
      - acme/billing-api          # 1+ repos; Product↔Repo is many-to-many (ADR-0005)
      - acme/billing-web
    functional_channel:           # the product's Telegram group + bot (ADR-0011)
      surface: telegram
      bot: acme-billing-bot       # token is a SECRET in env, not here (see below)
      group_chat_id: "-1001234567890"
    participants:                 # 2+ functional reviewers can share the group; any decides, others monitor
      - { handle: "@you",   role: architect,           slack_user_id: U0ARCHITECT }   # always present
      - { handle: "@priya", role: functional_reviewer, telegram_user_id: "987654321" }
```

How the fields drive behaviour:

- **`product_type`** picks the functional reviewer via the [`config/reviewers.yaml`](../../config/reviewers.yaml)
  matrix: `commercial` → the `functional_reviewer`; `technical` → the architect. Everything technical
  is always the architect (ADR-0003). Missing/unknown type defaults to `technical`.
- **`participants`** is the authoritative role→handle map for *this* product; the `reviewers.yaml`
  `roles:` block is only a fallback (see `reviewers.yaml` header).
- **`visibility: public`** is a deliberate, recorded exception — private is the default.
- **`functional_channel`** binds the product to its own Telegram group + bot; participant
  `telegram_user_id` / `slack_user_id` let maestro authorise and attribute a decision (ADR-0011).

For PR-reviewed governance of register changes, keep the real `products.yaml` in a **separate
private repo** and point maestro at it with `PRODUCTS_REGISTER` (see [`config/README.md`](../../config/README.md)).

## 2. Set up the functional surface (commercial products)

Architects need no per-product setup — they all approve in one shared Slack channel
(`ARCHITECT_SLACK_CHANNEL`). A product **with a functional reviewer** gets its **own Telegram bot**
so it stays isolated from every other product (ADR-0011):

- [ ] Create a Telegram bot for this product (via BotFather) and note its token.
- [ ] Create the product's Telegram group and add the bot and the functional reviewer(s).
- [ ] Record `functional_channel: { surface: telegram, bot: <name>, group_chat_id: <id> }` on the product.
- [ ] Put the token in your secret store as `TELEGRAM_BOT_TOKEN__<bot_name>` — **never** in the register.
- [ ] Record each functional reviewer's `telegram_user_id` so maestro can authorise/attribute decisions.

## 3. Put the per-repo controls in place

For **each** repo the product lists, apply the three enforcement layers from
[`repo-controls.md`](repo-controls.md):

- [ ] `.github/CODEOWNERS` with the architect (and a `pull_request_template.md`).
- [ ] Branch protection on the default branch — required review + code-owner review + the DoD
      status checks.
- [ ] A maestro runtime credential scoped **without merge rights** for that repo.
- [ ] CI that runs the Definition-of-Done gates on PRs (`.github/workflows/dod.yml` as a starting point).

## 4. Verify

- [ ] `config/products.yaml` is **not** tracked: `git check-ignore config/products.yaml` prints the path.
- [ ] Each repo: a test PR cannot be merged by the runtime credential, only by a human (US-0001 / ADR-0004).
- [ ] Commercial product: a test post reaches the product's Telegram group via its bot, and an
      in-group action from a functional reviewer is accepted (one from a non-reviewer is ignored).
- [ ] No bot token is present in `products.yaml`; tokens live only in the secret store.

## What is NOT part of onboarding yet

- Running the delivery loop end to end — needs the engine (orchestrator/crew/adapters), unbuilt.
- A Slack/GitHub-driven "create product" command — PRD-0002.
- Provisioning the `deploy_target` — a later build phase (ADR-0007); the target is recorded now so
  the future capability has a contract.
