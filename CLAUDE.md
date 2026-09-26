# Working in this repository

This repository holds maestro's MVP: the design in `docs/`, and the components with no consumer outside maestro — `spine/`, `signals/`, `console/`, `specs/` (specs-service), `work/` (work-service) — released together at one tag (ADR-0020). identity-service has its own repository. Read `README.md`, then `docs/mvp.md`, then `CONTEXT.md` for the vocabulary. `docs/decisions/` is the decision log for everything here; a design change that contradicts an accepted decision needs a new decision, not an edit. `specs/docs/decisions/` is specs-service's old log, closed: cite it, do not add to it.

## Rules

- **Vocabulary is `CONTEXT.md`.** Use its words. A new term is added there before it is used elsewhere.
- **Nothing tenant-identifying lands here.** No client names, application names, AWS account ids, hostnames, webhooks or channel ids. The demo tenant is fictional (`aannemer-x`); the first observed application is always `app1`. Tenant configuration lives in `fps4/maestro-<tenant>`; see `docs/tenancy-and-config.md`.
- **Links are checked.** Run `scripts/check-links.sh` before pushing; CI runs it on every PR.
- **Services stay apart.** `specs/` and `work/` import from each other only through published contracts (the spine package, HTTP), never by a relative path into the other's source; `scripts/check-boundaries.sh` fails on a crossing. Each service's gate runs when its tree changes (`.github/workflows/<service>-*.yml`); a service's own `README.md` and `Makefile` are where its local loop is.
- **The retired corpus** (git tag `corpus-2026-09`) is history, not a source. Do not cite its identifiers (T-, D-, PS-numbers) in current documents.

## Pull requests

- Open PRs ready for review (`gh pr create`, no `--draft`); the architect is the reviewer.
- Squash-merge on the architect's word only; no auto-merge. The one exception is a PR that brings in another repository's history (ADR-0020's consolidation): it is merged with a merge commit, or the history it exists to keep is flattened.
- Commit messages end with the attribution line the session provides.

## Diagrams

Mermaid fences in Markdown; GitHub renders them. No image files for diagrams.
