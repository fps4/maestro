---
title: "US-0033: Browse a task's artefacts in the workspace (M2 slice of US-0030, S4)"
persona: architect
status: accepted
complexity: L
milestone: M2
last_updated: 2026-05-29
accepted_on: 2026-05-29
accepted_by: "@farid (architect)"
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/product/user-stories/EP-03-reviewer-surface/US-0030-reviewer-webapp-and-wiki.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0031-workspace-ux-design.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0032-workspace-discuss-and-decide-m1.md
  - docs/product/user-stories/EP-02-engine-foundation/US-0023-artifact-store-and-sharing.md
  - docs/architecture/decisions/0010-public-engine-private-instance-data.md
  - docs/architecture/decisions/0011-multi-surface-human-control.md
  - docs/architecture/decisions/0012-artifact-storage-and-sharing.md
  - docs/architecture/decisions/0019-workspace-identity-component-auth-google-sso.md
  - docs/roadmap/m2-build-to-merge.md
---

## Story

As the architect,
I want the workspace to show me, per task, the artefacts the loop produced (spec, design, PR diff, test report, SBOM) — resolved through the `ArtifactStore` with short-lived presigned URLs —
so that I can read what I'm being asked to approve at the merge gate without leaving the workspace, and without any artefact leaking across products.

## Context

US-0030 spans the webapp steps S1–S6 across M0–M3. **S1 (Read) shipped in M0**, **S2 + S3 (Discuss + Decide) shipped in M1 via [US-0032](US-0032-workspace-discuss-and-decide-m1.md).** This story is the **M2 slice — S4 (Artefacts)** carved out as its own M2 deliverable, per the [M2 scoping doc](../../../roadmap/m2-build-to-merge.md) (open question Q7, resolved 2026-05-29). US-0030 remains the umbrella for the full webapp; this story is what M2 ships from it.

**Storage.** Artefact content lives in the `ArtifactStore` ([US-0023](../EP-02-engine-foundation/US-0023-artifact-store-and-sharing.md), [ADR-0012](../../../architecture/decisions/0012-artifact-storage-and-sharing.md)) — MinIO on ds1 as the M2 default (Q4). The workspace never embeds a long-lived public link; every read goes through a short-TTL presigned URL minted on request.

**Diff rendering.** PR-file diffs and re-draft diffs reuse the **same diff component** that landed in the M1 follow-up for the literal diff-of-artefact view (`react-diff-viewer-continued`) — one component, two surfaces (Q6, resolved 2026-05-29). The component is parametrized on data source (artefact-side blob diff vs PR file diff) and surfaces a "click a line → seed anchor `{path, side, line}`" affordance for the comment composer (using the anchor contract already named in [`workspace-write-api.md`](../../../architecture/contracts/workspace-write-api.md)).

## Acceptance criteria (EARS)

- WHEN a participant opens a task that has artefacts referenced in its event projection (functional spec, technical design, PR diff, test report, SBOM, diff snapshot), THE SYSTEM SHALL present a **per-task artefacts index** in the workspace task page showing each artefact's type, name, the source event, and a "view" affordance.
- WHEN a participant requests an artefact's content, THE SYSTEM SHALL resolve it through the `ArtifactStore` (US-0023) using a **short-TTL presigned URL** scoped to the requesting participant's product ([ADR-0012](../../../architecture/decisions/0012-artifact-storage-and-sharing.md)); the webapp SHALL NOT embed a long-lived public URL and SHALL NOT proxy the bytes through the orchestrator.
- WHEN rendering a diff artefact (PR file diff or spec/design re-draft diff), THE SYSTEM SHALL use the shared diff component already in use for the literal diff-of-artefact view (`react-diff-viewer-continued`) — one component across the artefacts browser, the M1 refinement-loop view, and the merge-gate diff (M2 Q6).
- WHEN rendering a test report, THE SYSTEM SHALL show pass/fail per scenario with a link to the failing-scenario detail (not just a blob link); WHEN rendering an SBOM, THE SYSTEM SHALL show per-package metadata (name / version / license) with a search affordance.
- THE SYSTEM SHALL scope artefact visibility to the products the caller participates in (per-product isolation — [ADR-0010](../../../architecture/decisions/0010-public-engine-private-instance-data.md) / [ADR-0011](../../../architecture/decisions/0011-multi-surface-human-control.md)); an artefact under a product the caller does not participate in SHALL return `404` (existence not disclosed — same rule as the read API).
- THE SYSTEM SHALL run behind the M0 **dev-stub identity** (`MAESTRO_DEV_IDENTITY`, [ADR-0019](../../../architecture/decisions/0019-workspace-identity-component-auth-google-sso.md)) for M2; production rejects the stub path. The authenticated edge lands in M3.
- IF the `ArtifactStore` is unavailable or a presigned URL has expired between mint and click, THEN THE SYSTEM SHALL show the artefact index read-only with an "artefact unavailable — retry" affordance and SHALL NOT serve a stale cached copy.

## Out of scope

- The per-participant **inbox** (S6) — M3 (split out of US-0030 when M3 opens).
- The authenticated edge / Cloudflare Access + `component-auth` — M3 ([ADR-0019](../../../architecture/decisions/0019-workspace-identity-component-auth-google-sso.md)).
- **Uploading** artefacts from the UI — artefacts are produced by agents and stored via [US-0023](../EP-02-engine-foundation/US-0023-artifact-store-and-sharing.md); the workspace is read-only on artefact bytes.
- HTML / PDF rendering of artefacts — text / code / diff / structured-report (test report, SBOM) only at M2.
- Cross-product artefact comparison — explicitly out per per-product isolation.
- Group-decision semantics (US-0017); M2 keeps the M1 single-architect assumption.

## Notes

This is the **M2 join point for the storage and surface streams**: [US-0023](../EP-02-engine-foundation/US-0023-artifact-store-and-sharing.md) is the source, this story is the rendering surface — mirrors how [US-0032](US-0032-workspace-discuss-and-decide-m1.md) was the M1 join point for the engine and surface streams. The diff component reuse closes one of two diff-viewer paths in `web/` before they diverge — same M1 discipline that kept the workspace one-page-per-task.
