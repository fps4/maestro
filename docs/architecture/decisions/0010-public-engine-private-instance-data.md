---
title: "0010: Open-core — public engine, private instance data"
status: accepted
date: 2026-05-25
related:
  - 0008-system-of-record-and-persistence.md
  - 0009-audit-logging-and-observability.md
  - ../../principles.md
  - ../../../config/products.example.yaml
---

## Context

maestro itself is open source (MIT, public repo). But the products it builds — and their details — are confidential: commercial product names, repository lists, participants, specs, and the operational/audit data of every run. [ADR-0008](0008-system-of-record-and-persistence.md) makes the product register *config-as-code*, which created a direct conflict: a config-as-code register living in the **public** engine repo would publish exactly the data that must stay private.

We need a clear boundary between the open-source **engine** and the operator's private **instance data**.

## Decision

maestro is **open-core**: the engine and conceptual docs are public; **all instance data is private and never lives in the public repo.**

**Public (this repo):** engine/agent/orchestrator code, conceptual documentation, and **templates only** — e.g. [`config/products.example.yaml`](../../../config/products.example.yaml), `config/reviewers.yaml` (generic routing matrix with placeholder handles).

**Private (never committed to the public repo):**

| Instance data | Where it lives |
|---|---|
| **Product register** (`config/products.yaml`) | gitignored locally; for PR-reviewed governance, in a **separate private repo** or private overlay, loaded by maestro at boot |
| **Product code** | each product's own GitHub repos (private by default — principle 5) |
| **Specs / designs** for a product | seed the *product's own* repo's `docs/product/`, not this repo |
| **Operational state** (tasks, gates, features, traceability) | maestro's event-sourced store on the private host (ds1/ds2) |
| **Audit logs** (prompts, decisions, costs) | same private store, immutable tier (ADR-0009) |
| **Secrets** (API keys, tokens) | `.env` / secrets manager (gitignored) |

The real register is loaded from a configurable path (`PRODUCTS_REGISTER`, default `config/products.yaml`), so it can point at a private location without code changes — the same indirection ADR-0002 uses for `base_url`. This preserves ADR-0008's "register is config-as-code, changes are reviewed PRs" benefit while keeping the data private: the PR review just happens in a private repo.

## Consequences

- **Open-sourcing the engine never risks product confidentiality** — the public repo contains no product data, only templates and the conceptual design.
- **ADR-0008 refined, not contradicted:** the register stays config-as-code; this ADR fixes *where* it lives (private), not *what* it is.
- **`.gitignore` enforces the floor** — `config/products.yaml`, `*.private.yaml`, and any local operational/audit stores (`/data/`, `*.db`) cannot be committed by accident.
- **Two governance levels for the register:**
  - *Baseline:* gitignored local file (simple; no PR audit of register changes).
  - *Recommended:* a separate **private repo** for the register, giving PR review + git history on who-can-review-what changes, while staying private.
- **What this does not cover.** The mechanism for loading a private register at deploy (git submodule, clone-at-boot, mounted secret, or a private overlay dir) is a deployment choice, made when the deploy phase is built (ADR-0007).
