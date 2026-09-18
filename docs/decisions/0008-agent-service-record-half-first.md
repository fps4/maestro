# ADR-0008 · agent-service ships its record half first; the runner is GitHub Actions + Claude Code

**Status:** accepted · 2026-09-18

## Context

"Which agent is doing what, what comes next, with the reasoning kept" needs a run record. Nothing built records a run. Executing agents inside the platform needs a durable execution engine and does not fit Lambda's limits; GitHub Actions has the repository, the secrets, job isolation and a six-hour limit.

## Decision

**agent-service holds the record** — runs, steps, declared next step, ceiling in force, next human touchpoint, outcome — and the transcript as a classified payload in S3. It executes nothing. **The runner is a GitHub Actions workflow per run kind**, invoking Claude Code under an agent principal from identity-service, emitting run events against a small contract (`run.started · plan · step · tool_call · decision_point · refused · run.ended`), with a plan mandatory before the first act. A GitHub App token scoped to draft PRs is the only write the runner holds on a repository.

## Consequences

- Execution state may be lost; every governance question about a historical run must be answerable from the archive and the transcript store alone.
- The runner is substitutable; the contract is not.
- Agent constructs (prompts, skills, workflows) are never exported to a tenant; the record is.

## What would reopen it

A run kind that cannot complete in six hours, or a tenant that cannot allow GitHub-hosted execution.
