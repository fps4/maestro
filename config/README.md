# config

maestro is **open-core**: this public repo holds the engine and **templates**, never your product data. See [ADR-0010](../docs/architecture/decisions/0010-public-engine-private-instance-data.md).

## Files

| File | Public? | What it is |
|------|---------|-----------|
| `reviewers.yaml` | ✅ committed | The routing matrix, the role→surface policy, and gate behaviour (generic; placeholder handles). Safe to keep public. |
| `products.example.yaml` | ✅ committed | **Template** for the product register. Copy it, don't edit it in place. |
| `products.yaml` | ❌ **gitignored** | **Your real product register** — product names, repos, participants. Private. |

## Keeping your products private

```bash
cp config/products.example.yaml config/products.yaml   # gitignored; put real products here
```

`config/products.yaml`, `config/*.private.yaml`, and local stores (`/data/`, `*.db`) are gitignored — they cannot be committed to this public repo by accident.

### Two ways to hold the real register

- **Baseline (simple):** keep `config/products.yaml` as a private local file on your host. No PR history of register changes.
- **Recommended (governed):** keep your real register in a **separate private repo** (e.g. `your-org/maestro-config`) so changes to who-reviews-what and which-repos-a-product-spans still get PR review and git history — just privately. Point maestro at it with `PRODUCTS_REGISTER=/path/to/private/products.yaml`.

## What else stays private (not in this repo at all)

- **Product code** → each product's own private repos.
- **Specs/designs** → seed the *product's* repo (`docs/product/`), not maestro's.
- **Operational state + audit logs** → maestro's store on your private host (ds1/ds2).
- **Secrets** (`ANTHROPIC_API_KEY`, GitHub/Slack tokens, **per-product Telegram bot tokens**) → `.env` / secrets manager (gitignored).

## Human surfaces (ADR-0011)

`reviewers.yaml` maps each role to a surface — `architect → slack`, `functional_reviewer → telegram`. The concrete destinations are instance data, kept out of the public repo:

- **Architect Slack channel** — one shared channel for the architect team; an instance setting (`ARCHITECT_SLACK_CHANNEL`), not per product.
- **Per-product Telegram group + bot** — declared on the product in `products.yaml` (`functional_channel: { surface, bot, group_chat_id }`). Each product has its **own bot**; the bot **token is a secret** referenced by logical name, never stored in the register (one token = one product's blast radius).
- **Participant surface ids** (`slack_user_id` / `telegram_user_id`) on each participant let maestro authorise and attribute a decision; any role-holder in the group may decide (quorum 1).
