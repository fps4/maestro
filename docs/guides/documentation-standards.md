---
title: Documentation standards
status: current
last_updated: 2026-05-28
owners: [architect]
related:
  - docs/guides/sdlc.md
  - docs/architecture/decisions/0018-workspace-read-api-and-frontmatter-index.md
  - docs/architecture/decisions/0021-plain-language-summary-on-artefacts.md
  - standards/documentation.yaml
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
│   ├── roadmap.md             # milestone-level roadmap (build + adoption tracks)
│   ├── roadmap/mN-*.md        # per-milestone scoping doc — lands when a milestone opens
│   ├── product/               # pre-code intent
│   │   ├── vision.md
│   │   ├── prd/NNNN-*.md
│   │   └── user-stories/EP-NN-*/US-NNNN-*.md
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
- User stories: `US-NNNN-*`, grouped under epics `EP-NN-slug/`; story numbers track the epic (EP-01 → US-001x). Each story carries `milestone: M<n>` frontmatter (see *Roadmap and milestones*).
- Per-milestone scoping docs: `roadmap/mN-short-slug.md` (e.g. `roadmap/m1-spec-to-design.md`).
- Issues: `ISSUE-NNNN-*` (with RCA) / `LIMITATION-NNNN-*` (accepted constraint).

## Roadmap and milestones

maestro plans in **milestones**, and decomposes a milestone into user stories only when that milestone opens for engineering. Two layers:

1. **`docs/roadmap.md` — milestone-level only.** It names *what* each milestone ships, what it proves, and how milestones sequence. It does **not** decompose milestones into stories. Speculative per-story decomposition of later milestones gets stale faster than it pays off, so the roadmap keeps a "currently open scoping docs" table and nothing more granular.
2. **`docs/roadmap/mN-*.md` — per-milestone scoping doc.** Lands when a milestone **opens for engineering**. It decomposes the milestone into user stories distributed across the **structural epics** under `docs/product/user-stories/`, and carries: a *deliverables → stories* table, a *dependency order*, *what it does/does not ship*, *what it proves*, a *definition of complete*, and *open questions*.

**Epics persist across milestones.** An epic (`EP-01-delivery-loop`) is a product-capability bucket that outlives any one milestone; milestone slicing happens in the scoping doc, not in the epic structure. Each story carries `milestone: M<n>` in its frontmatter, so the same epic accumulates stories as milestones open. (A story that genuinely spans steps across milestones — e.g. a multi-step surface — may carry a span like `M0–M3` with an inline note, and is split into per-step stories when convenient.)

**No markdown feature board.** Per-story build/review status is **not** kept in a checked-in kanban file. It lives in the **maestro workspace** (the UI), read from each story's `status:` frontmatter and the event-log status (ADR-0018). The lifecycle is unchanged — `draft → accepted → in-progress → done → blocked`, with `draft → accepted` human-only (the architect locks scope) and `in-progress → done` CI-only on a green merge — only the surface moved off Markdown and into the product.

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

### The `maestro:` block — for functional specs and technical designs

Functional specs and technical designs the crew produces (or that a human authors against maestro's domain) carry an extra `maestro:` sub-frontmatter that opts them into maestro's domain index ([ADR-0018](../architecture/decisions/0018-workspace-read-api-and-frontmatter-index.md)). Without it, the SpecIndex treats the file as a plain doc (guide / README / ADR) and skips it.

```markdown
---
title: "Invoice CSV export"
status: draft
last_updated: 2026-05-28
owners: [architect]
related:
  - docs/architecture/data-model.md
maestro:
  feature: invoice-export              # REQUIRED — the Feature (ADR-0005). [a-z0-9-]+
  kind: functional_spec                # REQUIRED — functional_spec | technical_design
  task: US-0042                        # OPTIONAL — the DeliveryTask, when one owns it
  summary: |                           # REQUIRED on functional_spec | technical_design — ADR-0021
    A CSV export endpoint that lets finance pull the last quarter's invoices
    in one paged, RFC-4180-quoted file, up to 50 000 rows per request.
---
```

The `summary` field is the **plain-language summary** ADR-0021 requires — one paragraph, ≤ 120 words / 800 characters, no markdown, no links, no code fences, written for the **non-technical reviewer**. The workspace renders it as the first block of the spec/design view; future surfaces (inbox snippet, Slack notifications) reuse the first sentence. The spec/design agent emits the summary on every revision, so it never drifts.

The machine-readable schema (with validation rules) lives in [`standards/documentation.yaml`](../../standards/documentation.yaml) — that is the version the crew reads on every task.

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
