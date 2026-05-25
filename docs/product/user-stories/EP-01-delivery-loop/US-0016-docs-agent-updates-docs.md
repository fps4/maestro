---
title: "US-0016: Update affected docs in the same PR"
persona: architect
status: draft
complexity: M
last_updated: 2026-05-25
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - standards/documentation.yaml
  - docs/guides/documentation-standards.md
---

## Story

As the architect,
I want the docs agent to update the docs a change affects within the same PR,
so that no behaviour change leaves docs stale and the docs-with-code Definition-of-Done item is satisfied.

## Context

Runs on the open PR (US-0011) after the builder produces the implementation and before the merge gate. Implements the docs-with-code DoD item ([`standards/documentation.yaml`](../../../../standards/documentation.yaml), CONTRIBUTING).

## Acceptance criteria (EARS)

- WHEN a pull request changes behaviour documented elsewhere, THE SYSTEM SHALL update the affected docs in the same PR to match the state the change produces.
- WHEN docs are updated, THE SYSTEM SHALL keep frontmatter current (`title` / `status` / `last_updated` / `owners`) and `related:` links valid per the documentation standards.
- IF a behaviour change would leave a referenced doc stale and the docs agent cannot resolve it, THEN THE SYSTEM SHALL flag it on the PR rather than report the docs DoD item green.
- WHEN no documented behaviour changed, THE SYSTEM SHALL record the docs item as not-applicable rather than force an empty change.

## Out of scope

- Authoring product specs/designs (US-0010 / US-0013).
- The merge decision (architect).

## Notes

Docs ship in the same PR as the code (`documentation.yaml`), not as a follow-up commit after merge.
