---
title: "0018: specs-service stays the record; OpenSpec is interoperated with, not adopted"
summary: "OpenSpec (Fission-AI, MIT) is a folder convention and prompt workflow for AI-assisted development — proposal, design, tasks, delta specs, an archive step that is a file move — with no identity, no attribution and, by design, no gate. Its working convention would run beside the record this service exists to keep, and the two would need a drift check to stay honest. Decided: do not adopt it as a system for the maestro repositories. Take its requirement/scenario layout as a declared block shape so an OpenSpec project can propose into this service unchanged, and write requirement statements in EARS with scenarios in GIVEN/WHEN/THEN. Revisit only when a second team or a client already runs OpenSpec and wants this service as its record."
status: accepted
last_updated: 2026-09-15
date: 2026-09-15
related:
  - ./0005-agents-may-author-never-decide.md
  - ./0016-the-git-native-path.md
  - ./0017-one-document.md
  - ../architecture.md
---

## Context

OpenSpec came up as a candidate for the maestro repositories on 2026-09-15, after the git-native
path (ADR-0016) and the one-document model (ADR-0017) landed. Checked against its repository and
concept docs on that date, it is:

- `openspec/specs/<capability>/spec.md` — current truth: `### Requirement:` statements in
  SHALL/MUST form with `#### Scenario:` blocks in GIVEN/WHEN/THEN;
- `openspec/changes/<name>/` — `proposal.md`, `design.md`, `tasks.md`, and delta specs marked
  `## ADDED / MODIFIED / REMOVED Requirements`, matched by requirement name;
- `/opsx:propose → apply → archive`, where **archive merges the deltas and moves the folder** —
  the whole of acceptance;
- integrations with thirty-plus assistants, a CLI, telemetry on by default, MIT;
- a stated posture: *specs are the source of truth; fluid not rigid; no phase gates; built for
  brownfield.*

It has no identity, no attribution, no immutable version, no decision and no question. Git is its
history, and git history is rewritable.

## Decision

**specs-service remains the record for every maestro repository, including the platform's own
specifications under D39. OpenSpec is not adopted as a system.**

Two things are taken from it, for interoperability rather than adoption:

1. **A declared block shape** for its requirement layout — `### Requirement:` with
   `#### Scenario:` children — as a `body_blocks` shape, so a specification written the OpenSpec
   way becomes a `requirements[]` facet with scenarios, diffs by requirement name, and reads in the
   decider's packet as *Requirement X modified*. An OpenSpec project can then propose into this
   service unchanged. This is the block shape ADR-0017 deferred until the notation was settled.
2. **The notation line**: requirement statements in EARS form (platform-standards §4.4, PS3 §4.2);
   scenarios in GIVEN/WHEN/THEN. Compatible with both, and one notation rather than two.

## Why not adopt

**Two truths.** OpenSpec's `specs/` claims to be the source of truth; ADR-0016 says the record wins
when a file and the record disagree. Running both means a drift check in every repository to keep
the file equal to the accepted version — work spent maintaining a duplicate of what the service
already holds.

**The valuable half is the half we do not need from it.** OpenSpec's distinctive contribution is
the change convention and the prompts around it. The delta format — its best idea — this service
produces *computed*, from stored versions, in the packet's "what changed since the last decided
version"; a hand-written delta is weaker than a diff of what was actually accepted. The change
workflow — proposal, design, tasks — is a work-service (`change` class) and skills concern, and is
the planned next step; adopting OpenSpec would spend that effort on integrating a third-party
convention instead.

**The posture is the opposite of the product's.** *No phase gates* is a reasonable stance for a
solo repository and the wrong one for a specification a named human is answerable for. Wrapping
`archive` so it refuses without an accepted version is possible (ADR-0016's Action already shows
the shape), but it is a wrapper around a tool whose design says the opposite.

**The git-native path already covers the platform's own case.** One `docs/spec.md` per service
with front-matter, proposed by its pipeline, decided by its owner, held here. No second folder
convention, no second CLI, no telemetry to switch off.

## Consequences

- No `openspec/` directory appears in a maestro repository as a matter of this decision. A
  repository that already has one is not asked to remove it; its `spec.md` proposes into this
  service once the block shape exists.
- The `openspec` block shape is a scheduled piece of work, not a dependency on OpenSpec: it is a
  markdown layout the parser recognises, and it is the second `body_blocks` shape after `table`.
- The change workflow — how a change is worked with an agent, from intent to a proposed version —
  is owed by work-service and the skills that drive it, and this decision records that it is not
  owed by a spec convention.

## When to revisit

A second team or a client already runs OpenSpec and wants this service as its record. Then the
block shape makes the integration a day's work, and adopting *their* convention for *that*
repository is the right call. Not before, and not for the platform's own repositories.

This is the first decision in this set recorded as `accepted` rather than `proposed`: the
architect took it explicitly, and it constrains work rather than describing a design under
review.

---

*Citations, 2026-09-18.* "D39", "platform-standards §4.4" and "PS3 §4.2" above refer to the maestro
design corpus as it stood when this was decided. That corpus was retired on 2026-09-18 (git tag
`corpus-2026-09` on `fps4/maestro`) and the MVP design written afresh; the decision stands unchanged.
What "the platform's own specifications" means now is in `fps4/maestro/docs/components/specs-service.md`,
and the EARS-plus-GIVEN/WHEN/THEN notation line is carried by this ADR alone.
