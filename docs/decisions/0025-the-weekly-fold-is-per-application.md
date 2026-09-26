# ADR-0025 · The weekly fold is one obligation per application

**Status:** proposed · 2026-09-26 · amends [ADR-0019](0019-work-services-table.md) (the fold bucket's key, §2 and §7)

## Context

[ADR-0019](0019-work-services-table.md) folds a workspace's medium and low findings into the week's obligation, keyed `<fold>#<period>`: one per workspace per week. The first finding raises the obligation, and the obligation is *about* that finding's application, answered for by its owner. Every later finding that week attaches to it, whatever its application.

With one application in the workspace, this is invisible. The first tenant observes four. When maestro's own repositories were first observed on 2026-09-26, fifteen findings across identity-service, specs-service and work-service folded into one obligation about work-service. Its owner answered for the other two services' findings, and those services' boards showed nothing. That breaks the rule that an item's accountable human is its application's, and never moves.

## Decision

1. **The fold is keyed `<fold>#<application>#<environment>#<period>`.** A workspace has one obligation per application and environment per week. It is about that application, and that application's owner answers for it.
2. The period is still the ISO week in UTC, and everything else in ADR-0019 §7 stands: raised by the first finding with a conditional put, one `rescan_clear` entry per finding, and never reopened once closed.

## Consequences

- The key is on the `WorkItemRaised` event's `fold`, so a rebuild derives the new buckets from the events as they were written. Obligations folded under the old key keep it. The first tenant's one mixed obligation is closed `superseded` and its findings are sent again.
- A workspace with many applications has as many weekly obligations as applications with findings that week. That is the point: each is someone's.

## What would reopen it

A tenant who wants one hygiene obligation across applications, answered for by a steward. That would be a fold whose accountable human is the workspace's steward rather than an application's owner, and it needs its own rule.
