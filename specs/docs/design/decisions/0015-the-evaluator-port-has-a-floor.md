---
title: "0015: The evaluator port has a floor — the facet schema, as findings — and an outbound call; a draft can ask what it still needs"
summary: "ADR-0002 made the evaluator a port with no default, so standalone a gate that required an evaluation could never open. The port now has two adapters chosen per evaluator in the definition: `builtin: facet_schema`, which reports each required facet of the type's schema as a finding in the schema's own words, and `endpoint`, an HTTP callout with `${VAR}` resolved from the environment at call time. Both run at propose. A draft's readiness turns the same schema into the questions the author still has to answer, before the 422."
status: proposed
last_updated: 2026-09-15
date: 2026-09-15
related:
  - ./0002-identity-service-is-the-only-dependency.md
  - ./0004-facets-are-evaluated-bodies-are-read.md
  - ./0013-the-decision-page-is-the-product.md
  - ../architecture.md
---

## Context

ADR-0002's port table gave the evaluator a local default of *absent — evaluations are optional*.
That was true of the port and false of the product: the committed definition's Explore gate
requires `sufficiency`, so on a deployment with nothing behind the port — every standalone
deployment — Explore could not open unless someone posted a verdict by hand. The endpoint half of
the port was never built either: `${EVALUATOR_BASE}` in the definition was a placeholder nothing
substituted. "Verdicts are recorded through the API but the service does not yet call out" was the
README's honest summary.

An author, meanwhile, learned what a draft still needed by pressing *propose* and reading a 422
with a JSON-schema path in it. The schema already knew the questions — every required facet has a
`description` written as one — and nobody was asking them.

## Decision

**An evaluator is declared as an `endpoint` or a `builtin`, never both, never neither.**

- `builtin: facet_schema` computes the verdict from the type's own facet schema: one finding per
  required facet, `met` or `unmet`, in the schema's title and description. Its findings are ids
  of the form `schema:<field>`, never a standard's id: it says what it is. It is the floor of
  sufficiency — *does this say enough* — and it is what lets a gate open with nothing behind the
  port.
- `endpoint` posts the version's workspace, artifact, ordinal, type, digest and facets, and records
  the `{ verdict, findings? }` it gets back against that digest. `${VAR}` segments resolve from the
  environment at call time, so the committed definition names the port and the deployment names the
  host. Unresolved, unreachable, slow, or malformed: nothing is recorded, and the run says why.

**Both run at propose**, over HTTP and over MCP, and the response reports each evaluator as
`recorded` or `unavailable` with a reason. `POST …/versions/:n/evaluate` and the `run_evaluations`
tool re-run them on demand — after an evaluator comes online, typically.

**The service still records and never decides.** The builtin is an adapter of the port, not a
policy engine: a gate reads verdicts exactly as before, and ADR-0004's rule that gates read facets
and never bodies is untouched. The committed definition makes `sufficiency` and
`intake_sufficiency` builtins and leaves `conformance` an endpoint, because conformance needs the
catalogue and a standards engine and pretending otherwise would be a fixture presented as a check.

**A draft can ask what it still needs.** `GET /drafts/:id/readiness` and the `draft_readiness`
tool return, in the schema's words and in schema order, every required facet not yet answered,
every invalid one, every agent extraction a person has not confirmed, a missing classification or
pinned link — split into what stops *propose* and what the gate will then refuse — plus what each
gate ahead will ask. The editor shows it and re-asks after every save.

## Consequences

**Standalone is now real for the whole loop.** Draft, propose, evaluate, decide, with nothing
configured beyond `identity-service`, which is the promise ADR-0002 made and the evaluator port was
quietly breaking.

**A builtin verdict is a weak verdict, and it says so.** `schema:declared_outcome: met` means the
facet is present and valid; it does not mean the baseline was measured. That judgement is what a
standards engine behind an endpoint is for, and the finding ids keep the two from being confused.

**The gate test changed meaning.** "The gate is shut until the evaluation is recorded" is now
demonstrated on the specification gate, whose conformance evaluator is unresolved on a test
deployment; the Explore gate is demonstrated opening on propose with the builtin's findings visible
in the packet.

**ADR-0002's table row is amended**: the evaluator's local default is `builtin: facet_schema`,
its production adapter the HTTP callout — and the callout now exists.

**What this does not do.** It does not run evaluations on a schedule, re-run them when a
definition changes, or run them against a draft. A draft asks *readiness*; a version is
*evaluated*. Keeping those apart is what keeps a verdict a fact about a digest.
