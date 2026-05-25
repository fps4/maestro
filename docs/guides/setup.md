---
title: maestro setup
status: draft
last_updated: 2026-05-25
owners: [architect]
related:
  - docs/product/user-stories/EP-00-platform-scaffold/US-0001-platform-setup.md
  - docs/architecture/decisions/0002-claude-api-direct-via-modelclient.md
---

# Setup

How to connect maestro to its three external dependencies. This is a stub: it captures the *contracts* required for first run (US-0001); concrete commands land when the orchestrator and adapters exist.

## Prerequisites

maestro runs on a cloud substrate — three external connections:

| Dependency | What maestro needs | Critical constraint |
|---|---|---|
| **GitHub** | Credentials for the target repo(s) scoped to **branch-create + PR-open**, with **no merge rights** | The missing merge right is the safety boundary (ADR-0004), verified at first run |
| **Slack** | A Slack app able to post messages and receive interactive actions in the configured channel | The human control surface — intent in, approvals out |
| **Anthropic / Claude** | An `ANTHROPIC_API_KEY` for the `ModelClient` | maestro's only LLM egress (ADR-0002); native prompt caching / extended thinking / tool use |

## Environment variables (planned)

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key used by the `ModelClient` |
| `MAESTRO_MODEL_BASE_URL` | No | Override to route the `ModelClient` through an OpenAI/Anthropic-compatible proxy (optional; default is the Anthropic API directly) |
| `GITHUB_TOKEN` | Yes | Token scoped to branch + PR, **without** merge permission |
| `SLACK_BOT_TOKEN` | Yes | Slack app bot token |
| `SLACK_CHANNEL` | Yes | Channel for status and approval requests |
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
2. maestro can post to Slack and receive a button-click action back.
3. A test `ModelClient` call returns a completion and appears in maestro's audit log (tokens, cost, cache hits).
4. Missing/invalid credentials for any of the three cause a startup failure naming the failed connection — no partially-connected start.
