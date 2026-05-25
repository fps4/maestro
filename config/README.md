# config

maestro is **open-core**: this public repo holds the engine and **templates**, never your product data. See [ADR-0010](../docs/architecture/decisions/0010-public-engine-private-instance-data.md).

## Files

| File | Public? | What it is |
|------|---------|-----------|
| `reviewers.yaml` | ✅ committed | The routing matrix + gate behaviour (generic; placeholder handles). Safe to keep public. |
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
- **Secrets** (`ANTHROPIC_API_KEY`, GitHub/Slack tokens) → `.env` / secrets manager (gitignored).
