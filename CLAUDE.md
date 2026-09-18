# Working in this repository

This repository holds the design of maestro's MVP. Read `README.md`, then `docs/mvp.md`, then `CONTEXT.md` for the vocabulary. `docs/decisions/` is the decision log; a design change that contradicts an accepted decision needs a new decision, not an edit.

## Rules

- **Vocabulary is `CONTEXT.md`.** Use its words. A new term is added there before it is used elsewhere.
- **Nothing tenant-identifying lands here.** No client names, AWS account ids, hostnames, webhooks or channel ids. The demo tenant is fictional (`aannemer-x`). Tenant configuration lives in `fps4/maestro-config-<tenant>`; see `docs/tenancy-and-config.md`.
- **Links are checked.** Run `scripts/check-links.sh` before pushing; CI runs it on every PR.
- **The retired corpus** (git tag `corpus-2026-09`) is history, not a source. Do not cite its identifiers (T-, D-, PS-numbers) in current documents.

## Pull requests

- Always open PRs as drafts (`gh pr create --draft`). Never mark ready without explicit confirmation.
- Squash-merge on the architect's word only; no auto-merge.
- Commit messages end with the attribution line the session provides.

## Diagrams

Mermaid fences in Markdown; GitHub renders them. No image files for diagrams.
