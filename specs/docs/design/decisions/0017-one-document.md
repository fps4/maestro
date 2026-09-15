---
title: "0017: One document is the artifact; the facets are a projection of it, derived at save; typed blocks are declared, not coded"
summary: "ADR-0004's split — facets a machine reads, a body a person reads — stays in the record and leaves authoring. A draft is written and saved as one markdown document: front-matter carries the envelope and any facet; a type may declare `body_blocks`, so the table under a named heading *is* a facet; the service derives the projection at save and marks its provenance from the saver. The digest, storage, and the rule that gates read only facets are unchanged. The console's second form is gone; the CLI and MCP read and write the same document."
status: proposed
last_updated: 2026-09-15
date: 2026-09-15
related:
  - ./0001-artifact-types-are-configuration.md
  - ./0003-immutable-versions-mutable-drafts.md
  - ./0004-facets-are-evaluated-bodies-are-read.md
  - ./0016-the-git-native-path.md
  - ../architecture.md
---

## Context

ADR-0004 was right about the record: a gate that reads prose is unfalsifiable, so a version carries
typed facets the gate reads and a body it never does. It was silent about authoring, and the
console filled the silence with a JSON form beside a textarea. An author wrote the acceptance
criteria as prose in the body and then again as objects in the facet panel, and the two drifted.
A non-technical author met custom fields; an agent kept two representations in sync; the CLI
(ADR-0016) had to invent front-matter to carry facets at all.

The maestro design had already moved past this — PS3 v0.5: *the body is EARS and a requirement is
an object, addressable, versioned with its specification.* The build had not followed.

## Decision

**A draft is authored and saved as one document.** `PUT /drafts/:id/document` takes one markdown
text. Front-matter carries `title`, `classification`, `links`, `catalogue_refs`, `effective`, and
every other key — or everything under `facets:` — as a facet. The rest is the body. The service
derives the facets, replaces the draft's, and marks each with the saver's provenance: `declared`
for a person, `extracted` for an agent. A facet whose value did not change keeps its provenance,
confirmation included; a changed one is the saver's.

**Typed blocks are declared per type, never coded.** `body_blocks: [{ facet: acceptance_criteria,
heading: "Acceptance criteria", shape: table }]` says the table under that heading is that facet:
header cells become keys, rows become objects, and the same bytes are prose to the reader and
structure to the gate. A block wins over front-matter for the facet it names. `table` is the only
shape; a second arrives with a second consumer, per ADR-0001's rule.

**A version has a document too.** `GET …/versions/:n/document` composes it from what is stored:
the envelope and the non-block facets as front-matter, then the body. Block facets are not
repeated in the front-matter — they are in the body already, and writing them twice is how the
two drift. The digest is over facets and body as before; the document is a projection of the
record, not a new stored thing.

**Every surface reads and writes the document.** The console editor is one textarea, with the
derived projection beside it — *what the gate will read* — for confirmation and for seeing what
one's prose became. The CLI sends the file as the document and parses nothing itself but the
envelope. MCP gains `read_document` and `save_document`; `save_draft` with separate facets and body
remains for a caller that wants it.

## Consequences

**ADR-0004 is narrowed to the record.** Gates read facets and never bodies — unchanged. Facets are
*authored* in the document and *derived* from it — new. The two statements do not conflict: a
facet derived from a table is still a facet, validated against the schema, evaluated, and gated.

**Drift is structurally impossible for a block facet.** There is one place the acceptance criteria
live. An author who edits the table has edited the facet; there is nothing else to update.

**The projection panel replaces the form.** It is read-only and shows provenance and the confirm
control; the *Facets* form is gone. An author who never opens the front-matter and only writes
under the declared headings still produces a gate-readable version.

**Coercion is minimal and stated.** In a table, `true`/`false` and bare numbers become what they
look like; everything else is a string. A schema that wants a number gets one when the author
typed one, and reports a mismatch through readiness in the schema's words.

**What this does not do.** It does not parse EARS statements into requirement objects — that is
the next block shape, and it needs the notation settled first. It does not make the body
evaluable; a block is a table the author chose to structure, not prose the service interpreted.
