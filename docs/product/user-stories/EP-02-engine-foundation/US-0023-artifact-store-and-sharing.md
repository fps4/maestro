---
title: "US-0023: Store and share artefacts via an S3-compatible ArtifactStore"
persona: architect
status: draft
complexity: L
last_updated: 2026-05-25
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0012-artifact-storage-and-sharing.md
  - docs/architecture/decisions/0011-multi-surface-human-control.md
  - docs/architecture/decisions/0010-public-engine-private-instance-data.md
---

## Story

As the architect,
I want maestro to store delivery artefacts in one S3-compatible store and share them as short-lived links on the reviewer's surface,
so that functional reviewers can read specs and designs before approving — without artefacts leaking across products.

## Context

Implements [ADR-0012](../../../architecture/decisions/0012-artifact-storage-and-sharing.md): a single `ArtifactStore` egress with a configurable backend — MinIO on ds1 by default, AWS S3 as a per-product opt-in. Artefacts are shared as presigned links on the reviewer's surface (ADR-0011).

## Acceptance criteria (EARS)

- WHEN an agent produces an artefact (functional spec, technical design, test report, SBOM, diff snapshot), THE SYSTEM SHALL store it via the single `ArtifactStore` under the product's own bucket/prefix and record a reference (`uri` + `sha256`) in the event log.
- WHEN resolving the backend, THE SYSTEM SHALL use the instance default (MinIO on ds1) unless the product sets an `artifact_store` override (e.g. AWS S3), resolved by configuration with no code change.
- WHEN maestro shares an artefact with a reviewer, THE SYSTEM SHALL post a short-TTL presigned URL scoped to that product's object(s) to the reviewer's surface (the functional reviewer's Telegram group / the architect's Slack channel).
- IF a presigned URL has expired, THEN THE SYSTEM SHALL mint a fresh one on request rather than expose a long-lived public link.
- THE SYSTEM SHALL keep object-store credentials as secrets (never in the register) and SHALL NOT expose the storage admin/console on the public endpoint.
- WHEN purging a product's artefacts, THE SYSTEM SHALL act only within that product's bucket/prefix (per-product isolation).

## Out of scope

- Backup / replication and artefact retention tooling (ADR-0012 records these as operational requirements).
- Rendering artefacts to HTML/PDF, and the surface delivery mechanics themselves (US-0017).

## Notes

Per-product bucket/prefix mirrors the per-product Telegram bot (ADR-0011) — a product's artefacts, bot, and group are all product-scoped. ds1/MinIO is the default per ADR-0007; AWS S3 is the per-product opt-in.
