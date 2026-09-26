---
title: External and platform standards are distinct types
status: proposed
date: 2026-08-06
deciders: [architect]
related:
  - ./0004-facets-are-evaluated-bodies-are-read.md
  - ./0008-the-catalogue-is-a-workspace.md
---

# ADR-0009 — External and platform standards are distinct types

## Context

The catalogue holds two kinds of standard and they are not the same kind of thing.

**Ours.** We author it. The body *is* the standard, and it carries the know-how — why we hold it,
what counts as satisfying it, how to satisfy it cheaply. That last part is what makes a standard
actionable rather than only enforceable, and it is the part an agent building against it needs.

**Someone else's.** ISO, NIST, a regulator. We did not author it and in most cases **we are not
licensed to reproduce it**: ISO's terms forbid redistribution, while NIST SP 800-53 and the Dutch
Bbl are freely redistributable. What we can always hold is a citation, a summary we wrote, and our
interpretation — and an interpretation has a *party* who made it, on a date, which is itself a fact
worth recording.

So the body means different things in the two cases, and a reader who mistakes one for the other
has mistaken *our paraphrase for the obligation*.

## Decision

**Two artifact types, not one type with a flag.**

- `platform_standard` — ours. Full text and know-how. Facets carry `assertion`, `tier`, `severity`,
  `evidence_required`, `remediation`, and `supports_construct`.
- `external_standard` — theirs. Facets carry `authority_body`, `citation`, a **required**
  `licence_disposition` (`full_text_permitted` · `summary_only` · `reference_only`), and
  `interpreting_party` with its arrangement and whether it is attested.

This follows the same argument that keeps descriptive and generative specifications apart: an
auditor is entitled to know which they are reading, and **a flag is settable**. A type is not.

`licence_disposition` is required, so an ingest that has not been licence-reviewed is a refused
write rather than a discovered problem. The field records a human's determination — this service
cannot adjudicate a licence and does not pretend to.

## Consequences

**Two schemas and two register sections** rather than one of each. Accepted: the split is the point.

**A migration is impossible if we get it wrong.** A standard filed under the wrong type cannot be
converted, because a type change is a new lineage. That is the same cost every type carries and it
is the reason the distinction has to be right before content arrives — which is an argument for
deciding it now, while the catalogue is empty.

**Licence review is per standard, before ingest, by a person.** The schema makes the omission
impossible to miss; it cannot make the judgement.

## Alternatives considered

**One `standard` type with `authority: external | ours` and `text_disposition`.** Simpler schema,
one register, one search. Rejected on ADR-0004's own logic: the question "is this the obligation or
our reading of it" would become a field someone can edit, and the answer matters most exactly when
somebody is under pressure to change it.
