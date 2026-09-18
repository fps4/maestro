# Build standards — the CI floor

What every maestro repository's CI runs on every PR ([ADR-0014](decisions/0014-the-mvp-ci-floor.md)). One job, four groups. Nothing here may be declined by a tenant; a tenant may add, never remove.

## 1. Repository

- Relative links in Markdown resolve (`scripts/check-links.sh`).
- No path matches `tenants/**` or `config/tenants/**`; no `.env` other than `.env.example`.
- No 12-digit AWS account id; no `arn:aws:` carrying an account.
- Every `Repository:` line in a component document resolves to a repository that exists.
- Inside `fps4/maestro`, once it holds code: the domain module of a component imports nothing from its services or transport; a component imports nothing from another component (an import lint).

## 2. Secrets

- A secret scan on every PR and on push to `main`, with a **custom pattern list kept outside the repository** (tenant and client names) supplied as a secret to the workflow.
- A finding blocks the merge.

## 3. Dependencies

- `npm audit` (or the ecosystem's equivalent) fails on **high** and **critical**.
- Dependabot enabled; its alerts are [signals](signals.md) to the advisory lane once work-service runs.
- A lockfile is committed and CI installs from it.

## 4. Artifacts

- Every built artifact (container image, Lambda bundle) emits an **SBOM** (CycloneDX) as a build output and attaches it to the release.
- Images are scanned before push; a critical finding blocks.
- The artifact's digest is what the deploy event carries to [runtime-service](components/runtime-service.md); tags are never resolved by anything downstream.

## The manifest rule

A check the substrate makes unrepresentable gets **a manifest entry naming what enforces it**, not a silent absence. Example: workspace isolation is enforced by the handle type and the adversarial isolation test, not by CI — the manifest says so, so nobody later deletes the test because CI appeared to cover it.

## Tests that are gates, not aspirations

Every component's test suite includes, and CI runs:

- **the adversarial isolation test** — acquire workspace A's handle, attempt B's data, assert failure;
- **the rebuild test** — drop the workspace database, rebuild from the archive, read back identically;
- **the attribution test** — an event without `accountable` resolving to a human is rejected at append.
