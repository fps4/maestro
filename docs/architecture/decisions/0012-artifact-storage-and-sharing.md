---
title: "0012: Artefact storage and sharing — S3-compatible ArtifactStore (MinIO on ds1)"
status: proposed
date: 2026-05-25
related:
  - 0002-claude-api-direct-via-modelclient.md
  - 0007-per-product-deployment-targets.md
  - 0010-public-engine-private-instance-data.md
  - 0011-multi-surface-human-control.md
  - ../data-model.md
  - ../../guides/setup.md
---

## Context

maestro must store and share **artefacts**: functional specs and technical designs (so a functional reviewer can read them before approving), PR/diff renderings, test-report evidence, SBOMs, and other large work products (knowledge indices, stored payloads). Functional reviewers are on Telegram ([ADR-0011](0011-multi-surface-human-control.md)) and need to open a link.

Constraints already set:

- **Private instance data** ([ADR-0010](0010-public-engine-private-instance-data.md)) — artefacts never live in the public repo, and **per-product confidentiality** matters: a reviewer for product A must not reach product B's artefacts.
- **Hosting posture** ([ADR-0007](0007-per-product-deployment-targets.md)) — lab servers (ds1/ds2) are the default; AWS is the production option; a specific cloud only when a product's technology requires it.

We need to decide where object storage lives and how artefacts are shared externally.

## Decision

1. **A single S3-compatible `ArtifactStore` egress.** All artefact reads/writes go through one internal client with a **configurable endpoint + credentials** — the same indirection `ModelClient` uses for `base_url` ([ADR-0002](0002-claude-api-direct-via-modelclient.md)). Code is backend-agnostic; the backend is configuration.

2. **Default backend: MinIO on ds1** (S3 API). Matches ADR-0007's lab default, keeps bytes on our own hardware (ADR-0010), and avoids per-GB egress fees for the heavy external-sharing use case.

3. **AWS S3 as a per-product opt-in.** A product needing cloud-grade durability/availability or a region/compliance constraint sets an `artifact_store` override on the product (the same shape as `deploy_target`'s cloud exception) — a config flip, no code change.

4. **Per-product isolation.** Each product's artefacts live under their **own bucket/prefix**, access scoped per product — mirroring the per-product Telegram bot (ADR-0011), so a product's artefacts, bot, and group are all product-scoped.

5. **Sharing via short-TTL presigned URLs.** maestro mints time-limited presigned GET URLs and posts them to the responsible surface (the functional reviewer's Telegram group). Links are **short-TTL and per-product-scoped** because a group link is visible to every member and forwardable. ds1 is reached externally via a **Cloudflare Tunnel** (no inbound ports) fronted by **Cloudflare Access**, exposing only the artefact-GET path — **never** the MinIO admin/console.

6. **Credentials are secrets.** S3 access keys / MinIO credentials live in env / a secret manager, never in the register — the same rule as Telegram bot tokens (ADR-0011).

## Consequences

- **Backend-agnostic by construction.** Start on MinIO/ds1; move any product to AWS S3 by config — no lock-in, consistent with the ADR-0002/0007 "keep it open" stance.
- **Consistent per-product isolation** across artefacts and surface — one product's bucket, bot, and group line up.
- **Durability/ops is now ours for the default path.** MinIO needs erasure coding + an offsite backup, or artefacts (which back traceability and audit evidence) risk loss. This is an operational requirement recorded here, not an afterthought.
- **The event log holds references, the store holds bytes.** Artefact `uri` + `sha256` go in the event log (ADR-0008/0009 stay authoritative for references); the object store holds the bytes.
- **The external-sharing security boundary is Cloudflare Tunnel + Access + short-TTL presigned URLs**; the presigned TTL is configurable.
- **What this does not cover:** backup/replication tooling and artefact retention specifics; optional CDN caching; rendering artefacts (markdown → HTML/PDF) is a separate concern.
