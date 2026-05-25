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
- [`product/roadmap.md`](product/roadmap.md) — building it up (M0–M4) and adopting it stepwise (the adoption ladder)

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
| [0008](architecture/decisions/0008-system-of-record-and-persistence.md) | System of record & persistence (register as config; event-sourced operational store; GitHub for code) |
| [0009](architecture/decisions/0009-audit-logging-and-observability.md) | Audit, logging & observability (four stores, one correlation ID) |
| [0010](architecture/decisions/0010-public-engine-private-instance-data.md) | Open-core — public engine, private instance data |
| [0011](architecture/decisions/0011-multi-surface-human-control.md) | Multi-surface human control — Slack for architects, Telegram (per-product bots) for functional reviewers *(proposed)* |
| [0012](architecture/decisions/0012-artifact-storage-and-sharing.md) | Artefact storage & sharing — S3-compatible ArtifactStore, MinIO on ds1 default, AWS S3 per-product opt-in *(proposed)* |
| [0013](architecture/decisions/0013-web-control-ui-for-reviewers.md) | A web control UI for reviewers — two-axis surfaces; revisits the no-bespoke-UI non-goal *(proposed)* |
| [0014](architecture/decisions/0014-orchestration-runtime-langgraph.md) | Orchestration runtime — LangGraph + interrupts; `ModelClient` egress and the event log stay authoritative |

> **Decided via spike:** the orchestration runtime is **LangGraph** (ADR-0014), validated in [`spikes/langgraph/`](../spikes/langgraph/). Still open: the reviewer surface / web-UI direction (ADR-0013).

## Guides

- [`guides/sdlc.md`](guides/sdlc.md) — **the spec-driven SDLC maestro runs and follows** (artifacts, gates, DoD, traceability, the human/agent protocol)
- [`guides/documentation-standards.md`](guides/documentation-standards.md) — how docs are structured (frontmatter, naming, ADRs)
- [`guides/setup.md`](guides/setup.md) — local setup
- [`guides/onboarding-a-product.md`](guides/onboarding-a-product.md) — register a product and ready its repos
- [`guides/repo-controls.md`](guides/repo-controls.md) — enforcing the merge boundary in GitHub (CODEOWNERS, branch protection, merge-less token)
- [`guides/testing-agent-protocol.md`](guides/testing-agent-protocol.md) — how the test agent derives scenarios, runs the layered tests, and records evidence

## Standards

- [`../standards/`](../standards/) — machine-readable SDLC standards injected into agent prompts

## Issues

- [`issues/README.md`](issues/README.md) — conventions for issues and known limitations
