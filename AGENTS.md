# Agent instructions

Instructions for AI coding agents working **on the maestro repo itself**. (For maestro's own runtime agent crew, see [`docs/architecture/overview.md`](docs/architecture/overview.md).)

## Allowed

- Read any file in the repository
- Create and edit files in `docs/`, `standards/`, `config/`, and (once they exist) `orchestrator/`, `agents/`, `model/`, `adapters/`
- Propose changes as branches and pull requests
- **Merge engine-repo pull requests** — the maintainer/owner (or automation acting on their behalf) may merge PRs in *this* repo. The never-merge rule is the runtime crew's contract for the products maestro builds, not a rule for this engine repo.

## Not allowed

- **Push *directly* to the default branch** — change this repo via pull requests (merging them is allowed, per *Allowed* above). The "agents never merge" rule applies to the runtime crew on the products maestro builds (ADR-0004), restated below.
- Edit `docs/architecture/decisions/` accepted ADRs — they are immutable; propose a new ADR that supersedes instead
- Add direct provider SDK calls in agent code — all LLM calls go through the single `ModelClient` (ADR-0002)
- Change split-review routing semantics in `config/reviewers.yaml` without an ADR (ADR-0003)

## Hard rules for the runtime crew

These are maestro's product safety contract **for the products maestro builds** (not for this engine repo, whose PRs the maintainer may merge), restated here so any agent editing this repo preserves them:

1. Agents work on `maestro/*` branches and open pull requests. They never push to a default branch and never merge.
2. A **reviewer agent may not author the feature it reviews** — independent checks, not self-grading.
3. Every delivery task passes its applicable gate(s) before merge. Gate routing is resolved from `config/reviewers.yaml`, never hardcoded.
4. A commercial product's functional spec is not "approved" until its functional reviewer signs off; everything else is the architect.
5. All automated quality gates (Definition of Done) are green before a human is asked to review.
6. Agents are invoked **only through the orchestrator's workflow** (LangGraph; ADR-0014) — never ad-hoc. Ad-hoc invocation makes a run unrecoverable on restart and bypasses the audit log (`standards/patterns.yaml`).
7. Select the model by **tier** through the `ModelClient` (ADR-0002) — never hardcode model names (`standards/patterns.yaml`).

## How maestro builds (and is built)

This repo follows its own spec-driven SDLC:

- Product intent (`docs/product/`) precedes architecture (`docs/architecture/`) precedes code.
- Significant work starts from an approved functional spec and technical design — see [`docs/guides/sdlc.md`](docs/guides/sdlc.md).
- Doc conventions (frontmatter, file naming, ADR format) are in [`docs/guides/documentation-standards.md`](docs/guides/documentation-standards.md).
- Machine-readable standards the crew must honour live in [`standards/`](standards/).

## Code style

- Follow existing patterns in the module you are editing — do not introduce new patterns without discussion.
- Every new function has a corresponding test (full automated testing is a principle, not a preference).
- Architecture diagrams are Mermaid blocks inside markdown — no external diagram files.

## Before proposing changes

1. Read the relevant ADR in `docs/architecture/decisions/` for the area you are touching.
2. If your change affects the pipeline flow, update `docs/architecture/overview.md` in the same PR.
3. If a significant trade-off is being made, propose a new ADR.
