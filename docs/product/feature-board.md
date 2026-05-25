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
- [ ] **[[US-0011-implement-and-open-pr|US-0011 — Implement an approved design and open a PR]]** #delivery-loop `(0)`
- [ ] **[[US-0012-route-review-by-product-type|US-0012 — Route each gate to the right reviewer]]** #delivery-loop `(0)`


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
