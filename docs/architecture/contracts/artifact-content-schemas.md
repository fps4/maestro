---
title: "Contract: artefact content schemas (the renderer ⇄ emitter shape)"
status: current
last_updated: 2026-05-31
owners: [architect]
maestro:
  feature: artifact-content-schemas
  kind: technical_design
  task: US-0033
related:
  - docs/architecture/contracts/artifact-store.md
  - docs/architecture/contracts/workspace-read-api.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0033-workspace-artefacts-browser-m2.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0011-implement-and-open-pr.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0014-generate-spec-derived-tests.md
  - docs/architecture/decisions/0012-artifact-storage-and-sharing.md
---

## Purpose

The **content schemas** for the structured artefacts the workspace artefacts browser renders
(US-0033 AC #3/#4): a **PR diff**, a **test report**, and an **SBOM**. The
[ArtifactStore contract](artifact-store.md) pins how bytes are stored and shared (presigned URLs);
this doc pins **what those bytes are**, so the renderer and the (future) emitter agree on a shape.

It is a **reference** doc (Diátaxis): the interface, not the implementation.

> **Renderer-first, emitter-pending.** US-0033 ships the renderers against these schemas now; the
> emitters that *produce* the artefacts (the builder US-0011 for the PR diff, the test agent US-0014
> for the test report, the CI license-SBOM floor for the SBOM) wire up as a follow-up and MUST emit
> these shapes. A renderer that meets content it can't parse falls back to a raw text / pretty-JSON
> view — it never throws (US-0033 AC #7 keeps the index usable).

The `kind` on the `artifact.stored` event (and the `StoredArtefact` index entry) selects the renderer;
the `content_type` is the wire media type the store serves.

## PR diff — `kind: "pr_diff"`

`content_type: application/vnd.maestro.diff+json`. A per-file old/new snapshot so the workspace renders
each file with the **shared `react-diff-viewer-continued` component** (US-0033 AC #3 / M2 Q6) — the
same side-by-side view used for the spec/design re-draft diff. A pre-file old/new pair (not a unified
patch) is what that component consumes.

```jsonc
{
  "base": "main",                 // the PR base ref (for the header)
  "head": "maestro/<task>",       // the PR head branch
  "files": [
    {
      "path": "orchestrator/agents/impl.py",
      "status": "modified",       // added | modified | deleted
      "old": "…full previous file content… ",   // "" for an added file
      "new": "…full new file content… "          // "" for a deleted file
    }
  ]
}
```

## Test report — `kind: "test_report"`

`content_type: application/vnd.maestro.test-report+json`. The spec-adherence DoD result (US-0014):
**pass/fail per scenario**, each scenario traceable to the `AC-N` it verifies, with a failing-scenario
detail (US-0033 AC #4).

```jsonc
{
  "tool": "pytest",
  "summary": { "total": 12, "passed": 11, "failed": 1, "skipped": 0, "duration_ms": 4200 },
  "scenarios": [
    {
      "id": "tests/test_csv_export.py::test_ac1",
      "name": "exports a CSV when asked",
      "criterion": "AC-1",            // OPTIONAL — the EARS id this scenario verifies
      "status": "passed",            // passed | failed | skipped
      "duration_ms": 120,
      "message": null,               // a one-line failure summary when status == failed
      "detail": null                 // OPTIONAL — the traceback / assertion detail (failing only)
    }
  ]
}
```

The renderer shows the summary, a per-scenario pass/fail table grouped fail-first, and expands a
failing scenario's `detail`. A green spec-adherence gate is `summary.failed == 0`.

## SBOM — `kind: "sbom"`

`content_type: application/vnd.cyclonedx+json`. **CycloneDX JSON** (the M2 license-SBOM floor's output;
widely produced by Syft / cdxgen). The renderer reads `components[]` and shows a **searchable per-package
table** of name / version / license / type (US-0033 AC #4). CycloneDX is the chosen format (vs SPDX) for
its first-class `components[].licenses` and `purl`.

```jsonc
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "components": [
    {
      "type": "library",            // library | application | framework | …
      "name": "boto3",
      "version": "1.35.0",
      "purl": "pkg:pypi/boto3@1.35.0",
      "licenses": [ { "license": { "id": "Apache-2.0" } } ]   // or { "expression": "MIT OR Apache-2.0" }
    }
  ]
}
```

The renderer flattens `licenses[]` to a display string (`license.id` / `license.name` / `expression`),
and the search box filters across name / version / license / purl.

## What this contract does NOT pin

- The **emitter** mechanics (when/where the builder, test agent, and CI floor write these) — a
  follow-up; they MUST emit these shapes and the matching `kind`.
- HTML/PDF artefact rendering — out of scope for M2 (US-0033 §out-of-scope); text / code / diff /
  structured-report only.
- SPDX support — CycloneDX is the M2 SBOM format; an SPDX adapter is a later addition if a product's
  toolchain emits SPDX.
