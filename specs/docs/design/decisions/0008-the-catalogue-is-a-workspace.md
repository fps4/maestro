---
title: The catalogue is a workspace, reached through a read-only handle
status: proposed
date: 2026-08-06
deciders: [architect]
supersedes: []
related:
  - ./0001-artifact-types-are-configuration.md
  - ./0006-workspace-isolation-by-database.md
  - ./0009-external-and-platform-standards-are-distinct-types.md
---

# ADR-0008 — The catalogue is a workspace, reached through a read-only handle

## Context

The service was designed to hold specifications. It was not designed to hold the **standards those
specifications are judged against** — those live in a pack registry, shared across tenants, and
reach us only as an evaluator's verdict.

Walking a real consumer broke that. Three things about standards turn out to be ours:

1. **Which standards a tenant accepted, who accepted each, and when.** A shared registry may hold no
   tenant runtime data, so an acceptance has nowhere else to live.
2. **Which standards were in force when a version was decided**, per standard rather than as one
   aggregate verdict.
3. **The text itself, for the standards we author** — including the know-how that makes a standard
   satisfiable rather than merely enforceable, which is what an agent needs and a citation cannot
   give.

And a standard turns out to have this service's shape item for item: a lineage, immutable versions,
a publication gate an accountable human passes, a diff between 3.1.0 and 3.2.0, a body someone reads
and facets a machine evaluates, an export. Building a second registry would duplicate all of it.

The obstacle is ADR-0006. **Nothing crosses a workspace** — not a link, not a lineage, not a query —
and a pack is shared across tenants by definition.

## Decision

**Standards, constructs and packs live in a dedicated *catalogue workspace*, declared `kind:
catalogue`, and every tenant reads it through a `CatalogueHandle`.**

The catalogue is not a special case in the code. It is a workspace definition with different types
(`platform_standard`, `external_standard`, `construct`), its own publication gate, and its own
lifecycle. Authoring a standard is ordinary authoring.

Four rules keep the boundary honest:

- **A `CatalogueHandle` is a different type from a `WorkspaceHandle`**, exposes reads only, and is
  not assignable to the writable one. "Read a standard" and "read a tenant's business case" cannot
  be confused by a tired caller.
- **It cannot be constructed for a workspace not declared as a catalogue.** Otherwise it would be a
  read across the confidentiality boundary wearing the one type allowed to cross it.
- **The read-only guarantee is enforced at runtime, not only in the type.** The handle hands out an
  object with no write method to reach, because a type-only promise dies to one `as`.
- **A tenant artifact carries a `CatalogueRef`, never a `Link`.** Links are intra-workspace and
  participate in lineage; a catalogue reference resolves read-only and does not. They deliberately
  do not share a type — collapsing them is how this erodes.

## Consequences

**What we get.** One service answers *"what governs this specification"* with the standard's text,
the tenant's acceptance and the recorded verdict. An agent needs one integration and one auth
surface rather than two and a join it performs itself. And the catalogue inherits versioning, gates,
diff, lineage and export for free.

**What it costs, stated rather than discovered.** ADR-0006's guarantee is now "nothing crosses a
workspace *except* a declared catalogue, read-only" — a weaker sentence than the one we had, and the
weakening is real. It is bounded by being expressed as a type rather than as a convention, and the
adversarial test in `tests/integration/isolation.test.ts` drives every edge of it: a
`CatalogueHandle` over a tenant database is refused, and the handle exposes no write method even
when cast.

**What is not solved.** The catalogue's *content* is a stub. The pack registry does not exist yet,
so nothing seeds real standards, and a fixture presented as a standard would be worse than an empty
shelf — the console says the catalogue is empty rather than filling it with plausible text.

## Alternatives considered

**Copy the pack into each tenant workspace.** No new mechanism, perfect isolation, offline-capable.
Rejected because one canonical interpretation across tenants is the point of a shared pack: a
per-tenant copy is the fragmentation, and it breaks fleet-wide re-attestation.

**Keep standards in a separate service.** No boundary question at all. Rejected because it
duplicates version, gate, diff, lineage and export machinery in a second service, and because the
consumer that made this urgent — an agent governing a tenant — would need two integrations to
answer one question.
