---
title: maestro documentation index
status: current
last_updated: 2026-05-27
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
- [`product/user-stories/`](product/user-stories/) — discrete capabilities with acceptance criteria (EARS); per-story status lives in the workspace UI, not a Markdown board
- [`roadmap.md`](roadmap.md) — milestone-level build track (M0–M4) + the adoption ladder; per-milestone scoping docs land in [`roadmap/`](roadmap/) as each milestone opens

## Architecture — how it's built

- [`architecture/overview.md`](architecture/overview.md) — C4 system context + containers + the agent crew
- [`architecture/data-model.md`](architecture/data-model.md) — product / repo / participant / task model
- [`architecture/components/orchestrator.md`](architecture/components/orchestrator.md) — the conductor (C4 L3)
- [`architecture/components/workspace-backend.md`](architecture/components/workspace-backend.md) — workspace read API + GitHub sync + frontmatter spec index (C4 L3)
- [`architecture/contracts/workspace-read-api.md`](architecture/contracts/workspace-read-api.md) — the workspace ↔ orchestrator HTTP/JSON contract (S1, read-only)

### Decisions (ADRs)

| ADR | Decision |
|---|---|
| [0001](architecture/decisions/0001-architect-directed-agentic-delivery.md) | Architect-directed agentic delivery (the founding posture) |
| [0002](architecture/decisions/0002-claude-api-direct-via-modelclient.md) | Claude API direct via a single `ModelClient` |
| [0003](architecture/decisions/0003-split-review-routing-matrix.md) | Split functional/technical review routing |
| [0004](architecture/decisions/0004-agents-propose-via-pr-humans-merge.md) | Agents propose via PR; humans merge *(superseded by 0016)* |
| [0005](architecture/decisions/0005-product-domain-model.md) | Product as the core domain object (multi-repo, multi-participant) |
| [0006](architecture/decisions/0006-spec-driven-sdlc.md) | Spec-driven SDLC + Definition of Done |
| [0007](architecture/decisions/0007-per-product-deployment-targets.md) | Per-product deployment targets |
| [0008](architecture/decisions/0008-system-of-record-and-persistence.md) | System of record & persistence (register as config; event-sourced operational store; GitHub for code) |
| [0009](architecture/decisions/0009-audit-logging-and-observability.md) | Audit, logging & observability (four stores, one correlation ID) |
| [0010](architecture/decisions/0010-public-engine-private-instance-data.md) | Open-core — public engine, private instance data |
| [0011](architecture/decisions/0011-multi-surface-human-control.md) | Multi-surface human control — Slack for architects, Telegram (per-product bots) for functional reviewers *(proposed)* |
| [0012](architecture/decisions/0012-artifact-storage-and-sharing.md) | Artefact storage & sharing — **MinIO on ds1** (S3-compatible) the chosen default; AWS S3 per-product opt-in |
| [0013](architecture/decisions/0013-web-control-ui-for-reviewers.md) | A web control UI for reviewers — two-axis surfaces; revisits the no-bespoke-UI non-goal *(superseded by 0015)* |
| [0014](architecture/decisions/0014-orchestration-runtime-langgraph.md) | Orchestration runtime — LangGraph + interrupts; `ModelClient` egress and the event log stay authoritative |
| [0015](architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md) | Reviewer surfaces — repo-linked docs wiki + a maestro chat webapp (Minimal/Next.js); OpenProject/XWiki rejected |
| [0016](architecture/decisions/0016-merge-after-workspace-approval.md) | Merge after workspace approval — the human decides, the agent executes the merge *(supersedes 0004)* |
| [0017](architecture/decisions/0017-github-app-and-webhook-ingestion.md) | GitHub App + webhook ingestion — GitHub-origin facts become events; installation-token client for the adapter |
| [0018](architecture/decisions/0018-workspace-read-api-and-frontmatter-index.md) | Workspace read API + frontmatter spec index — the surface contract (status × content join) |
| [0019](architecture/decisions/0019-workspace-identity-component-auth-google-sso.md) | Workspace identity — `component-auth` (Google SSO) at the edge, authorization from the register |

> **Decided via spike:** the orchestration runtime is **LangGraph** (ADR-0014), validated in [`spikes/langgraph/`](../spikes/langgraph/). The reviewer-surface direction is now decided too: a **repo-linked docs wiki + a maestro chat webapp** (ADR-0015, after evaluating and rejecting OpenProject/XWiki).

## Guides

- [`guides/sdlc.md`](guides/sdlc.md) — **the spec-driven SDLC maestro runs and follows** (artifacts, gates, DoD, traceability, the human/agent protocol)
- [`guides/documentation-standards.md`](guides/documentation-standards.md) — how docs are structured (frontmatter, naming, ADRs)
- [`guides/setup.md`](guides/setup.md) — local setup
- [`guides/onboarding-a-product.md`](guides/onboarding-a-product.md) — register a product and ready its repos
- [`guides/repo-controls.md`](guides/repo-controls.md) — the merge boundary ([ADR-0016](architecture/decisions/0016-merge-after-workspace-approval.md)): maestro-internal and event-gated; GitHub-side controls are not relied upon as the lock
- [`guides/testing-agent-protocol.md`](guides/testing-agent-protocol.md) — how the test agent derives scenarios, runs the layered tests, and records evidence

## Standards

- [`../standards/`](../standards/) — machine-readable SDLC standards injected into agent prompts

## Issues

- [`issues/README.md`](issues/README.md) — conventions for issues and known limitations
