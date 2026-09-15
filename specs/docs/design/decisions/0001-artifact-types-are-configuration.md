---
title: "0001: Artifact types, links, gates and lifecycles are configuration, not code"
summary: "The service ships no domain vocabulary. A workspace declares its artifact types, facet schemas, link types, gate definitions, lifecycle phases and attribution profile as data; the service enforces the rules those declarations imply. This is what lets maestro and maestro v1 run the same engine with no shared vocabulary."
status: proposed
last_updated: 2026-08-04
date: 2026-08-04
related:
  - ./0004-facets-are-evaluated-bodies-are-read.md
  - ./0005-agents-may-author-never-decide.md
  - ../architecture.md
---

## Context

Two consumers exist today and their vocabularies do not overlap at all. maestro has opportunities,
business cases, specifications and intake assessments, moving through Explore, Assess, specification
and release gates. maestro v1 has charters, functional specs, technical designs and implementations,
moving through functional and technical gates.

The mechanics *are* the same — a typed artifact, an immutable version, typed links to other
artifacts, evaluable units with attributes, and a gate where a named human decides and an agent
cannot. Only the nouns differ.

Hard-coding either vocabulary produces a service that fits one consumer and is contorted for the
other. Hard-coding a union of both produces a service that fits neither and grows a third set of
concepts every time someone new arrives.

## Decision

**A workspace declares its own model, as data.** The service ships:

- **No artifact type names.** A type is `{ id, facet_schema, body_format, links[] }`.
- **No gate names.** A gate is `{ id, decides_on, owner resolver, outcomes, requirements }`.
- **No lifecycle.** Phases and legal transitions are declared, and a transition names the gate that
  authorises it.
- **No attribution vocabulary.** An attribution profile declares required fields and what each must
  resolve to (architecture §2.6).

What the service *does* own, and will never make configurable:

- Drafts are mutable and versions are immutable (ADR-0003)
- Only a gate decision accepts a version, and only a named human decides (ADR-0005)
- A required attribution field is enforced at write time
- Isolation is by binding, never by filtering (ADR-0006)

**The definition is versioned and stamped on every version written under it.** Applying a new
definition never rewrites history — an accepted version stays readable under the schema in force when
it was accepted. A breaking facet change therefore creates a **new type**, not a new version of one.

## Consequences

**The good.** Two consumers with no shared words run one engine. A third consumer needs a YAML file,
not a fork. And the model is inspectable — "what does approval mean here" is answerable by reading
configuration rather than source.

**The cost, and it is real.** Configuration-driven systems fail in a specific way: the configuration
grows into a programming language, badly. Two guards, both of which must hold:

1. **Declarations describe structure and constraints, never behaviour.** No expressions, no
   conditionals, no hooks. A gate declares *what must be true*; it does not compute anything. Where
   a consumer needs judgement, it calls out through the evaluator port (architecture §4) and the
   service records the verdict.
2. **A new declaration field needs two consumers.** The same rule that justified extracting this
   service justifies each addition to it. One consumer's need is a fork of the schema, not a feature.

**Errors move to load time.** A malformed workspace definition must fail loudly when applied, not on
the first artifact written against it. Validation of the definition is as important as validation of
the data.
