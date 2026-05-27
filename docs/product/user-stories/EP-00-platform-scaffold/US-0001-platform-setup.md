---
title: "US-0001: Platform setup — connect GitHub, Slack, and Claude"
persona: architect
status: draft
complexity: M
last_updated: 2026-05-25
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
---

## Story

As the architect,
I want maestro connected to a GitHub repository, a Slack workspace, and the Claude API,
so that the crew can read/write code, talk to me, and reason — before any delivery task runs.

## Context

Prerequisite for every other story. First run must establish the three external connections and verify the safety boundary — that maestro **refuses to merge without a recorded, role-authorized approval event** ([ADR-0016](../../../architecture/decisions/0016-merge-after-workspace-approval.md)).

## Acceptance criteria (EARS)

- WHEN maestro starts with GitHub credentials scoped to branch-create, PR-open, and merge, THE SYSTEM SHALL create a branch and open a PR on the target repo.
- IF a merge is attempted without a valid, role-authorized, unconsumed merge-approval event (none, forged, or already consumed), THEN THE SYSTEM SHALL refuse the merge and log it ([ADR-0016](../../../architecture/decisions/0016-merge-after-workspace-approval.md)).
- WHEN maestro starts with a valid Slack app token, THE SYSTEM SHALL post a message to the configured channel and receive an interactive action (button click) back.
- WHEN the `ModelClient` makes a test call to the Anthropic API, THE SYSTEM SHALL return a completion and record the call (agent, tokens, cost, cache hits) in the audit log.
- IF credentials for any required connection are missing or invalid, THEN THE SYSTEM SHALL fail startup with a message naming the failed connection, and SHALL NOT start in a partially-connected state.

## Out of scope

- Multiple target repos or multiple Slack workspaces.

## Notes

The merge boundary is the load-bearing safety check ([ADR-0016](../../../architecture/decisions/0016-merge-after-workspace-approval.md), superseding ADR-0004): verify maestro **refuses to merge without a valid approval event** as part of acceptance — a negative test of an unapproved / forged / replayed merge, not just configuration intent.
