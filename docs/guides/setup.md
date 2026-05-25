---
title: maestro setup
status: draft
last_updated: 2026-05-25
owners: [architect]
related:
  - docs/product/user-stories/EP-00-platform-scaffold/US-0001-platform-setup.md
  - docs/architecture/decisions/0002-claude-api-direct-via-modelclient.md
  - docs/architecture/decisions/0011-multi-surface-human-control.md
---

# Setup

How to connect maestro to its external dependencies. This is a stub: it captures the *contracts* required for first run (US-0001); concrete commands land when the orchestrator and adapters exist.

## Prerequisites

maestro runs on a cloud substrate. Its external connections (human surfaces are per-role — ADR-0011):

| Dependency | What maestro needs | Critical constraint |
|---|---|---|
| **GitHub** | Credentials for the target repo(s) scoped to **branch-create + PR-open**, with **no merge rights** | The missing merge right is the safety boundary (ADR-0004), verified at first run |
| **Slack** | A Slack app able to post and receive interactive actions in the shared **architect** channel | The architect surface — intent in, architect-gate approvals out |
| **Telegram** | One **bot per product** (with a functional reviewer), added to that product's group | The functional-reviewer surface; per-product bots isolate products (ADR-0011) — set up when onboarding a product, not a single global step |
| **Anthropic / Claude** | An `ANTHROPIC_API_KEY` for the `ModelClient` | maestro's only LLM egress (ADR-0002); native prompt caching / extended thinking / tool use |
| **Object store** | An S3-compatible endpoint + credentials — **MinIO on ds1** by default | Artefact store (ADR-0012); shared externally via short-TTL presigned URLs over a Cloudflare Tunnel; AWS S3 is a per-product opt-in |

## Environment variables (planned)

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key used by the `ModelClient` |
| `MAESTRO_MODEL_BASE_URL` | No | Override to route the `ModelClient` through an OpenAI/Anthropic-compatible proxy (optional; default is the Anthropic API directly) |
| `GITHUB_TOKEN` | Yes | Token scoped to branch + PR, **without** merge permission |
| `SLACK_BOT_TOKEN` | Yes | Slack app bot token (architect surface) |
| `ARCHITECT_SLACK_CHANNEL` | Yes | The shared architect-team channel for status + architect-gate approvals |
| `TELEGRAM_BOT_TOKEN__<bot_name>` | Per product | One token per product's bot, keyed by the `bot:` logical name in the register (e.g. `TELEGRAM_BOT_TOKEN__acme_billing_bot`). Secret; never in the register (ADR-0011) |
| `ARTIFACT_STORE_ENDPOINT` | Yes | S3-compatible endpoint for the default ArtifactStore (the MinIO instance on ds1); per-product AWS-S3 overrides come from the register (ADR-0012) |
| `ARTIFACT_STORE_ACCESS_KEY` / `ARTIFACT_STORE_SECRET_KEY` | Yes | Object-store credentials (secret) |
| `ARTIFACT_URL_TTL_SECONDS` | No | Lifetime of a presigned share link (default short, e.g. 900) |
| `REVIEWERS_CONFIG` | No | Path to the routing matrix (default: `config/reviewers.yaml`) |
| `PRODUCTS_REGISTER` | No | Path to your **private** product register (default: `config/products.yaml`, gitignored). Point at a private repo/overlay to keep product data out of the public repo (ADR-0010). |

## Your private product register

maestro is open-core — the public repo ships only a template. Create your real, private register before first run:

```bash
cp config/products.example.yaml config/products.yaml   # gitignored; never committed
```

See [`../../config/README.md`](../../config/README.md) for keeping product data private (including the recommended separate-private-repo option).

## First-run verification (from US-0001)

1. maestro can create a branch and open a PR on the target repo — and **cannot** merge it.
2. maestro can post to the architect Slack channel and receive a button-click action back.
3. For a product with a functional reviewer: maestro can post to that product's Telegram group via its bot and receive an in-group action back.
4. A test `ModelClient` call returns a completion and appears in maestro's audit log (tokens, cost, cache hits).
5. Missing/invalid credentials for any required connection cause a startup failure naming the failed connection — no partially-connected start.
