---
title: Documentation standards
status: current
last_updated: 2026-05-25
owners: [architect]
related:
  - docs/guides/sdlc.md
---

# Documentation standards

How docs are structured in maestro and in the products it builds. Docs feed both humans and agents, so precision and machine-readable structure matter.

## Principles

1. **Docs live next to the code they describe.** `/docs` at the repo root; colocate module notes in source dirs.
2. **Narrow scope over broad.** One accurate file beats a sweeping overview that drifts.
3. **Docs change in the same PR as the code.** Doc updates are part of the Definition of Done.
4. **Product intent precedes implementation.** The repo holds the *why* and *what* before the *how*.

## Folder structure

```
repo-root/
├── README.md · CODEBASE.md · GLOSSARY.md · AGENTS.md
├── docs/
│   ├── README.md              # index
│   ├── principles.md          # charter (durable rules)
│   ├── product/               # pre-code intent
│   │   ├── vision.md
│   │   ├── prd/NNNN-*.md
│   │   ├── user-stories/EP-NN-*/US-NNNN-*.md
│   │   └── feature-board.md
│   ├── architecture/
│   │   ├── overview.md        # C4 L1+L2
│   │   ├── data-model.md
│   │   ├── components/<name>.md   # C4 L3
│   │   └── decisions/NNNN-*.md    # ADRs
│   ├── guides/                # how-to / reference (sdlc, setup, …)
│   └── issues/                # ISSUE-NNNN / LIMITATION-NNNN
└── logs/test_reports/         # evidence (git-ignored)
```

## File naming

- Lowercase, hyphen-separated; name describes the subject, not the author/date.
- PRDs and ADRs: zero-padded numeric prefix (`0001-…`).
- User stories: `US-NNNN-*`, grouped under epics `EP-NN-slug/`; story numbers track the epic (EP-01 → US-001x).
- Issues: `ISSUE-NNNN-*` (with RCA) / `LIMITATION-NNNN-*` (accepted constraint).

## Per-file structure

Every doc opens with frontmatter:

```markdown
---
title: <matches the subject>
status: draft | current | deprecated   # (ADRs: proposed | accepted | superseded by NNNN)
last_updated: YYYY-MM-DD
owners: [role]
related:
  - docs/...            # repo-root-relative; builds the machine-readable graph
---
```

Then a consistent heading order (omit sections that don't apply — never write "N/A"): **Purpose → Behaviour → Interface/API → Dependencies → Configuration → Known limitations**.

Follow the [Diátaxis](https://diataxis.fr) split — a file is *reference*, *explanation*, *how-to*, or *tutorial*; don't mix types.

## Acceptance criteria use EARS

maestro writes acceptance criteria (in functional specs and user stories) in **EARS** form — "WHEN [condition] THE SYSTEM SHALL [behaviour]" — so they are unambiguous and tests can be generated from them. See [`sdlc.md`](sdlc.md).

## ADRs

Immutable once `accepted` — never edit an accepted ADR; write a new one that supersedes it (and set the old one's status to `superseded by NNNN`).

```markdown
---
title: "NNNN: Short title"
status: accepted
date: YYYY-MM-DD
---
## Context      # what forced the decision; the constraints
## Decision     # what was decided, plainly
## Consequences # what gets easier, harder, constrained
```

## Diagrams

Architecture diagrams are **Mermaid blocks inside markdown** — no external diagram files. `C4Context` for system context (L1), `flowchart` with subgraphs for containers (L2) and components (L3), `sequenceDiagram` for dynamic flows. Place each diagram under the heading it illustrates.

## Agent-facing files (repo root)

- **`CODEBASE.md`** — the first file an agent reads: what the product does, directory map, entry points, naming notes, out-of-scope.
- **`GLOSSARY.md`** — term definitions where business language and code diverge.
- **`AGENTS.md`** — what agents may/may not do, how to run things, code style, pre-submit checks.

## Staleness prevention

`last_updated` on every file; doc updates in the PR's definition of done; narrow per-component docs over broad overviews; `status: deprecated` with a link to the replacement; ADRs immutable once accepted.
