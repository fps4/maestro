---
title: "0004: Facets are evaluated; bodies are authored, rendered and diffed but never evaluated"
summary: "A version is an envelope, a typed facet set validated per artifact type, and a body in a declared format. The service now authors, renders, diffs and searches bodies — but no gate requirement and no evaluator may read one. That single rule keeps the body format free to change and keeps gates falsifiable."
status: proposed
last_updated: 2026-08-04
date: 2026-08-04
related:
  - ./0001-artifact-types-are-configuration.md
  - ./0003-immutable-versions-mutable-drafts.md
  - ./0007-mongodb-with-inline-bodies.md
---

## Context

Two requirements pull against each other.

**Artifacts must be machine-evaluable.** A gate that requires a passing check needs something
structured to check. maestro generates spec-adherence tests from EARS acceptance criteria; adel
evaluates sufficiency standards against a business case. Neither works against prose.

**Artifacts must be human-authored and human-readable**, in this service, by people who are not
schema authors. An artifact someone cannot read is one they cannot confirm, and a confirmation
nobody understood is worthless.

A third pressure decides how they are reconciled: **the representation is not settled.** adel has an
open question about what a specification's internal representation should be — controlled natural
language, a structured model, or a hybrid. Committing the service to one answer commits every
consumer to it, and changing it later invalidates everything written before.

## Decision

**Three layers, with a hard rule about what may be evaluated.**

| Layer | Owned by | Validated | Evaluated by a gate |
|---|---|---|---|
| **Envelope** | The service | Always | — |
| **Facets** | The type's JSON Schema | On propose | **Yes** |
| **Body** | The type's declared format | Format and size only | **Never** |

**No gate requirement and no evaluator may read a body.** The service renders it, diffs it, searches
it and stores it — it does not interpret it, and neither may anything downstream of a gate.

Three things follow:

- **The body format can change** — twice — without invalidating a record, because nothing structural
  depends on it
- **Gate requirements stay falsifiable.** A requirement over prose cannot be shown to have been met
- **Prose stays prose**, undeformed by a parser's needs

**Facets carry per-field provenance:** `declared` (a human wrote it), `extracted` (an agent proposed
it), `reconstructed` (recovered after the fact from something that already existed).

**Only confirmed facets are evaluated or gated.** An agent may extract; its extraction cannot reach a
gate unconfirmed. This is what makes generous agent authority safe at low oversight cost — the
extraction is not binding, so the agent's latitude can be wide, while the confirmation is a human act
at the point of consequence.

**Attachments are not bodies.** Images, PDFs and files are content-addressed in object storage and
referenced from the body as `attachment:<id>`. They are snapshotted with the version, and equally
never evaluated.

## Consequences

**Facet–body drift is possible and is not eliminated.** A body whose prose says one thing while its
facets say another will pass evaluation and mislead every reader. This is the honest cost of keeping
the representation open, and it is *worse* now that the service hosts the editor, because the two
layers are edited in one place and can diverge in one sitting.

Three mitigations, none complete: confirmation is a human act performed against a diff of **both**
layers; a facet change is a new version like any other; and provenance makes an unconfirmed
extraction visible rather than silent. A fourth is available if drift proves real — render facets
alongside the body in the editor, so divergence is visible while writing rather than at review.

**The facet schema is the real design work per consumer**, and that is where the difficulty moves
rather than disappearing. Too thin and gates check nothing; too thick and authoring becomes
form-filling. Both known consumers have a usable start — maestro's `AC-N` with `priority`, `verify`,
`source` and `rationale`; adel's sufficiency fields.

**Diff splits in two.** Facet diff is structural and available for every type immediately. Body diff
is per format, with a line differ as the default. A body diff only a developer can read is a defect
in the format, not in this service.

**Rendering is now the service's problem**, which it was not in v0.1. Sanitisation is mandatory:
bodies authored by humans and agents are rendered to other users in the same workspace, so
unsanitised HTML is stored XSS against exactly the people the record protects. Server-side render
with a strict allow-list.

**A body format is a declaration plus a renderer**, not an integration. Adding one means a renderer
and a differ, and nothing else — no validator, no linter, no evaluator. A consumer wanting those
runs them through the evaluator port against facets.
