---
title: "0003: Drafts are mutable, versions are immutable; proposing snapshots one into the other"
summary: "Editing happens on a draft, which is freely mutable and has no integrity obligations. Proposing snapshots it into a version, which is written once and superseded, never edited. This is what lets a real editor and a trustworthy record coexist in one service."
status: proposed
last_updated: 2026-08-04
date: 2026-08-04
related:
  - ./0004-facets-are-evaluated-bodies-are-read.md
  - ./0005-agents-may-author-never-decide.md
  - ./0007-mongodb-with-inline-bodies.md
---

## Context

The failure this service exists to prevent is not that approval is missing. It is that approval is
**advisory** — the artifact was approved, then edited, and the approval still appears to attach to
it. Every tool that stores a document and an approval flag beside it has this defect, and it is
invisible until someone asks what exactly was approved.

But the service must also be somewhere people *write*. It has its own domain, its own console, and
humans and agents authoring in it. Authoring is continuous, incremental and occasionally wrong —
autosave, half a facet set, an empty section. A record is none of those things.

Forcing both onto one entity gives a bad answer either way. Make the entity mutable and every
approval becomes advisory again. Make it immutable and every keystroke is a version, which is absurd.

## Decision

**Two entities.**

**A draft is mutable and has no integrity obligations.** It carries a `revision` counter, accepts
partial and invalid facets, accumulates a contributor list, and may be saved as often as anyone
likes. It is not a record and nothing may cite it.

**A version is immutable.** Proposing snapshots a draft — facets, body, attachment set — into a
version with an ordinal and a digest over the whole. From that moment:

- There is **no update operation on a version**, and none is exposed. `PUT` and `PATCH` are absent
  from the API surface, not guarded in a handler.
- A change is a **new draft, then a new version** that supersedes the previous one.
- `state` is the only mutable field, moves only through declared lifecycle transitions, and only a
  gate decision moves it (ADR-0005).

**Concurrency on a draft is optimistic.** A save carrying a stale `revision` is refused with the
current state. Real-time collaborative editing is deliberately deferred.

**Rejection reopens a draft, it does not erase a version.** `request_changes` creates a new draft
based on the rejected version, carrying the reviewer's comments. The rejected version stays in the
record; the loop is visible.

**Redaction is the single permitted mutation of a version.** Bodies live inside version documents
(ADR-0007), so a lawful erasure cannot be a blob delete. Redaction replaces content in place, is
recorded as an event, and leaves the digest unchanged — so the resulting mismatch is *detectable and
explained*. A mismatch with no event is corruption; a mismatch with one is an erasure. Silent
deletion would be indistinguishable from tampering.

## Consequences

**An approval means something.** "Version 8 was accepted by this named human on this date" stays true
permanently, because version 8 cannot become something else.

**The editor can be genuinely good** without threatening any of that, because nothing an editor does
touches a version. This is what makes the product viable as a standalone tool rather than a
headless registry with a viewer.

**Drafts need their own lifecycle**, which is new work: they go stale, they accumulate, and a draft
abandoned six months ago against a version superseded four times is noise. Expire them on a declared
interval and record the expiry — the same discipline the register applies to everything else.

**Two entities is a real cost in the UI.** "You are editing a draft based on version 7, which is not
what anyone else sees" has to be legible, and getting it wrong produces the worst possible confusion
in a tool whose value is knowing what is current. The console must always show which version is
accepted, independently of what is being edited.

**Storage grows monotonically**, and it is a non-issue at this shape. If version count is the scaling
problem, something has been misused as a document store.

**Clients must not cache a version reference as "current".** Read the lineage and resolve. A consumer
that pins an ordinal gets exactly what it asked for, which is usually what it wanted.
