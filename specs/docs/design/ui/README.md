---
title: Console design reference
status: approved
last_updated: 2026-08-06
owners: [architect]
related:
  - ../architecture.md
---

# Console design reference

[`console-mock.html`](console-mock.html) is the **approved** design for the console. Open it in a
browser — it is a single self-contained file with no dependencies, and every screen is reachable
from the picker at the top.

It is a design reference, not a prototype to be lifted. The tokens, the component vocabulary and
the state treatments are what the implementation copies; the markup is not.

## What it fixes

**Design language.** Light-first, near-monochrome, tabular density. The neutral carries a slight
green bias toward the accent so it reads as chosen rather than inherited. The accent — `#2F5D50`
light, `#78B8A1` dark — is **reserved for state** and for the one action that changes state. A
component that spends it on decoration has taken it away from the thing it is there to mark.

**The mutability line, carried by form.** A draft has dashed edges and live controls; a version has
a solid rule, a monospace digest and no edit affordance at all. This is the one property a reader
must never have to infer, so it is never carried by a label alone.

**State is legible without colour.** A dashed outline means in flight, a filled chip means decided,
a strike means retracted, a double rule means reconstructed. Remove the hue and the chips still
read.

**Identifiers are monospace, language is not.** A digest, an ordinal, a lineage id and a standard id
are bytes, not prose, and the type treatment says so.

## The eleven screens

| Screen | Carries |
|---|---|
| Register | Everything in flight, with the two signals a stale register hides: expiry and lapsed acceptance |
| Artifact | The version ledger, links and the pin, facets, standards in force at that version |
| Draft editor | Body and facets side by side, provenance per field, propose blocked on unconfirmed extraction |
| Diff | Facet diff and body diff together — a gate reads one, a human reads the other |
| Decide | Requirements before outcomes, each outcome stating its consequence, attribution shown not collected |
| Lineage | The pinned edge solid, everything else dashed, absent services dotted |
| Catalogue | Standards as artifacts — ours in full text, external by citation and summary |
| Standards & binding | Which standards this tenant accepted, by whom, when, against which pack version |
| Search | Facet matches and body matches distinguished; the workspace boundary stated |
| Workspace definition | The types, gates and lifecycle as data, including a declared omission |
| Sign in | One card, one action, no chrome |

## Keeping it true

**Change this file in the same pull request as the UI it describes.** A design reference that has
drifted from the product is worse than none, because it is still believed. If a screen changes
shape, update the mock; if the mock is wrong, it is a defect.

Where the implementation deliberately departs from the mock, record it in the ADR that authorises
the departure and note it here — an undocumented difference is indistinguishable from drift.
