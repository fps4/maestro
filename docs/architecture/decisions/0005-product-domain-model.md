---
title: "0005: Product as the core domain object"
status: accepted
date: 2026-05-25
related:
  - 0001-architect-directed-agentic-delivery.md
  - 0003-split-review-routing-matrix.md
  - ../data-model.md
---

## Context

Every mainstream agentic coding tool is **repo-scoped and single-operator-scoped**: one repo, one assigner, one PR. But a real software product spans several repositories (web, API, infra, libraries) and involves several people in different roles. Issue trackers overlay a "project" onto repos rather than modelling it as a first-class object: GitHub Projects has no native "this project owns these N repos"; Jira/Linear anchor work to a single team/repo and bolt cross-repo views on top.

maestro needs the product itself to be the organising object — so a single unit of intent can produce coordinated changes across repos, gates route to the right person, and "is it done?" aggregates across the whole product.

## Decision

The **product** is maestro's core domain object, modelled with explicit many-to-many relationships and per-product roles.

- **Product** — the top container. Holds the charter, one `product_type` (`commercial` | `technical`), and visibility (private by default).
- **Product ↔ Repository is many-to-many** (a product has many repos; a repo may serve more than one product) — modelled as a join, not a foreign key. This is the gap incumbents leave open.
- **Participant ↔ Product is many-to-many with a role** — a join carrying a role enum (`architect`, `functional_reviewer`, `stakeholder`, …). Roles are per-product; a person can hold different roles in different products. The architect participates in every product.
- **Work hierarchy:** `Product → Feature → Task`. A **Feature** is one functional spec + technical design; **Tasks** are the ordered implementation items. A Task **targets** a repo (it is owned by the Feature, not the repo), so one Feature can produce coordinated changes across several repos.
- **Traceability is first-class:** `Requirement → Task → PR/Commit`, and `PR → Repo`. This lets the functional reviewer confirm intent without reading code, and lets a product-level view aggregate done-ness across repos.
- **Reviewer assignment is derived** from the participant role (ADR-0003) plus, where useful, a CODEOWNERS-style path map per repo.

## Consequences

- **maestro's clearest differentiator becomes structural**, not cosmetic: the product object, the M:N joins, and cross-repo traceability are things no surveyed competitor models natively.
- **Gates route by product role**, so the same routing matrix (ADR-0003) works across a product's repos uniformly.
- **A persistent knowledge/context agent indexes all of a product's repos** as one mental model — the data model assumes this cross-repo view exists.
- **Mapping to GitHub is a sync concern, not the system of record.** If maestro syncs to GitHub Issues/Projects, prefer metadata that travels with the issue (sub-issues, issue fields) over GitHub Project custom fields, which do not. The maestro store is authoritative.
- **v1 simplification:** a single delivery task still targets one repo (PRD-0001); the multi-repo-per-feature capability is modelled here but realised in a later phase.
- **What this does not cover.** The concrete persistence (maestro-owned DB vs GitHub-as-store vs hybrid) is an open PRD-0001 question.
