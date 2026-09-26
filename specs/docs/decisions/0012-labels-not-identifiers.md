---
title: "0012: Every identifier a workspace declares has a label, and no surface shows the identifier"
summary: "Types, gates, outcomes, phases, links and attribution fields are declared as identifiers for the record and labelled for the reader, in the same definition. The api computes the full label set with a humanised fallback for anything unlabelled, and the console renders only labels. A person deciding at a gate never meets `request_changes`."
status: proposed
last_updated: 2026-09-15
date: 2026-09-15
related:
  - ./0001-artifact-types-are-configuration.md
  - ./0005-agents-may-author-never-decide.md
  - ../architecture.md
---

## Context

ADR-0001 put the whole domain vocabulary in the workspace definition so the service ships none of
it. That worked for the record: a decision carries `explore` and `request_changes`, and those are
stable identifiers an auditor can rely on across a rename.

It did not work for the reader. The console rendered `artifact.type.replace(/_/g, ' ')` in nine
places, the outcome buttons said `request changes`, the attribution form asked for `oversight_level`
in monospace capitals, and the phase column read `in_review`. Every one of those is the record's
word, not the person's. A sponsor asked to approve a business case on their phone was being shown
the storage format.

The definition already had `title` on types and gates and used it in two places. The rest was
unlabelled because nothing required a label, and the console filled the gap with the identifier.

## Decision

**Every identifier a definition declares can carry a label, in the definition, next to the
identifier.** Types and gates have `title` and a one-line `description`; gates have
`outcome_labels`; the lifecycle has `phase_labels`; links have `label`; attribution profiles have
`field_labels`. A label for something the definition does not declare is refused at apply, with the
path named, exactly as an undeclared link target is.

**The api computes the complete label set and returns it with the definition** (`labels` on
`GET /definition`) and on every gate view (`title`, `description`, `type_title`, `outcome_labels`,
`field_labels`). Where a definition gave no label the api humanises the identifier
(`request_changes` → `Request changes`), so the set is total: every id has a word.

**The console renders labels and never identifiers**, with one class of exception: the states the
*service* owns — `proposed`, `accepted`, `superseded` — which no definition can name, and which the
console labels itself (`Awaiting a decision`, `Accepted`, `Superseded`). Identifiers still appear
where they are the point: an artifact id, a digest, an ordinal, a principal id in an attribution
record. Those are what an auditor cites and are shown in monospace, as before.

## Consequences

**The record is unchanged.** Nothing about what a decision, version or event carries moves. A
rename in the definition changes what people see and not what was recorded, which is the property
that makes labelling safe to do late.

**Two words for one thing, on purpose.** `request_changes` in the record and "Ask for changes" on
the button are the same outcome. The identifier is for the machine and the audit trail; the label
is for the person pressing it. They must never be shown together, and the label must never be
written to the record — a decision carrying the label would break the moment the workspace reworded
it.

**The fallback is a floor, not a target.** A humanised id is a label, so no screen is ever forced
back to the raw identifier, but it is a worse label than a declared one. Both committed definitions
now declare every label. A new definition that declares none still renders, and reads like one that
declares none.

**Descriptions are the first plain-language surface.** A type's `description` ("Is it worth
solving, and do we know enough to say so?") and a gate's ("Is this worth taking further?") are
shown wherever the type or gate is named. They are the sentence a person without training reads
instead of the identifier, and they are the seam the decision page and the MCP decider's packet
build on.
