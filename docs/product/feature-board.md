---
kanban-plugin: basic
title: maestro feature board
status: current
last_updated: 2026-05-25
owners: [architect]
---

## Draft

- [ ] **[[US-0001-platform-setup|US-0001 — Platform setup: connect GitHub, Slack, Claude]]** #platform-scaffold `(0)`
- [ ] **[[US-0010-draft-functional-spec|US-0010 — Draft a functional spec and post it to the functional gate]]** #delivery-loop `(0)`
- [ ] **[[US-0013-produce-technical-design|US-0013 — Produce a technical design and post it to the design gate]]** #delivery-loop `(0)`
- [ ] **[[US-0011-implement-and-open-pr|US-0011 — Implement an approved design and open a PR]]** #delivery-loop `(0)`
- [ ] **[[US-0014-generate-spec-derived-tests|US-0014 — Generate and run spec-derived tests]]** #delivery-loop `(0)`
- [ ] **[[US-0015-independent-reviewer-agent|US-0015 — Critique the diff with an independent reviewer agent]]** #delivery-loop `(0)`
- [ ] **[[US-0016-docs-agent-updates-docs|US-0016 — Update affected docs in the same PR]]** #delivery-loop `(0)`
- [ ] **[[US-0012-route-review-by-product-type|US-0012 — Route each gate to the right reviewer]]** #delivery-loop `(0)`
- [ ] **[[US-0017-group-surface-gate-approval|US-0017 — Approve a gate from a group surface (Slack / per-product Telegram)]]** #delivery-loop `(0)`
- [ ] **[[US-0020-orchestrate-delivery-task|US-0020 — Orchestrate a delivery task through its stages and gates]]** #engine-foundation `(0)`
- [ ] **[[US-0021-modelclient-single-egress|US-0021 — Route every LLM call through the audited ModelClient]]** #engine-foundation `(0)`
- [ ] **[[US-0022-audit-and-event-log|US-0022 — Record an append-only, correlated audit & event log]]** #engine-foundation `(0)`
- [ ] **[[US-0023-artifact-store-and-sharing|US-0023 — Store and share artefacts via an S3-compatible ArtifactStore]]** #engine-foundation `(0)`


## Accepted


## In Progress


## Done


## Blocked


%% kanban:settings
```
{"kanban-plugin":"basic"}
```
%%

> **Conventions** (see [`../guides/documentation-standards.md`](../guides/documentation-standards.md)): one card per user story; `status:` frontmatter equals the column. `Draft → Accepted` is human-only (the architect locks scope). `In Progress → Done` is CI-only on green merge — never an agent or human claim. `(n)` is the count of defined test scenarios. No stories are `Accepted` yet — scope is still being refined.
