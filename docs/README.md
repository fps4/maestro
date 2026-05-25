---
title: maestro documentation index
status: current
last_updated: 2026-05-25
owners: [architect]
---

# maestro docs

Documentation index. maestro is **spec-driven**: product intent precedes architecture precedes code.

## Start here

- [`../README.md`](../README.md) — what maestro is, the product concept, the spec-driven loop
- [`principles.md`](principles.md) — the charter: the durable rules
- [`../CODEBASE.md`](../CODEBASE.md) — repo orientation map
- [`../GLOSSARY.md`](../GLOSSARY.md) — domain terms

## Product — what we're building and why

- [`product/vision.md`](product/vision.md) — problem, users, goals, non-goals
- [`product/prd/0001-architect-directed-delivery-loop.md`](product/prd/0001-architect-directed-delivery-loop.md) — the founding delivery loop
- [`product/user-stories/`](product/user-stories/) — discrete capabilities with acceptance criteria (EARS)
- [`product/feature-board.md`](product/feature-board.md) — live status of each story

## Architecture — how it's built

- [`architecture/overview.md`](architecture/overview.md) — C4 system context + containers + the agent crew
- [`architecture/data-model.md`](architecture/data-model.md) — product / repo / participant / task model
- [`architecture/components/orchestrator.md`](architecture/components/orchestrator.md) — the conductor (C4 L3)

### Decisions (ADRs)

| ADR | Decision |
|---|---|
| [0001](architecture/decisions/0001-architect-directed-agentic-delivery.md) | Architect-directed agentic delivery (the founding posture) |
| [0002](architecture/decisions/0002-claude-api-direct-via-modelclient.md) | Claude API direct via a single `ModelClient` |
| [0003](architecture/decisions/0003-split-review-routing-matrix.md) | Split functional/technical review routing |
| [0004](architecture/decisions/0004-agents-propose-via-pr-humans-merge.md) | Agents propose via PR; humans merge |
| [0005](architecture/decisions/0005-product-domain-model.md) | Product as the core domain object (multi-repo, multi-participant) |
| [0006](architecture/decisions/0006-spec-driven-sdlc.md) | Spec-driven SDLC + Definition of Done |
| [0007](architecture/decisions/0007-per-product-deployment-targets.md) | Per-product deployment targets |

## Guides

- [`guides/sdlc.md`](guides/sdlc.md) — **the spec-driven SDLC maestro runs and follows** (artifacts, gates, DoD, traceability, the human/agent protocol)
- [`guides/documentation-standards.md`](guides/documentation-standards.md) — how docs are structured (frontmatter, naming, ADRs)
- [`guides/setup.md`](guides/setup.md) — local setup

## Standards

- [`../standards/`](../standards/) — machine-readable SDLC standards injected into agent prompts

## Issues

- [`issues/README.md`](issues/README.md) — conventions for issues and known limitations
