# agent-service — the record of runs

**Repository:** `fps4/maestro` · **Status:** to build · **Decision:** [ADR-0008](../decisions/0008-agent-service-record-half-first.md)

What agents did: every run, its plan, its steps, its ceiling, the next human touchpoint, and its outcome — with the full transcript kept as a classified payload. It executes nothing. The runner is a GitHub Actions workflow per run kind, invoking Claude Code under an agent principal.

## The run

```yaml
run:
  run_id:             run-01J9F2K5…
  workspace_id:       ws-aannemer-x
  kind:               rca                  # rca | fix | bump | explain — a workflow per kind
  construct:          skills/rca@7         # the skill set at a version; never exported
  construct_digest:   sha256:1f0c…

  raised_by:          work-service
  subject:            wrk-8841             # the item or draft this run is about
  trigger:            signal

  accountable:        prn-h-jdekker        # a human, always
  acting:             prn-a-remed-2        # the agent principal
  service_account:    gha-runner-3         # the runner's workload principal
  seat:               operations
  oversight_level:    O2                   # copied on
  onboarding_level:   n2                   # of the subject application

  ceiling:
    steps:            40
    wall_clock:       PT30M
    cost_eur:         12.00
    acts:             [ read, propose, draft_pr ]   # never merge on this run kind

  plan:               [ "read the item and the alarm", "pull logs for the window", "propose cause_analysis" ]
  current_step:       2
  next_touchpoint:    "decision: accept cause_analysis"   # the next thing a person must do
  state:              running              # pending | running | waiting | completed | refused | failed | expired
  outcome:            null                 # done | proposed | refused | exhausted | failed — write-once

  transcript_ref:     s3://…/transcripts/run-01J9F2K5…jsonl
  transcript_digest:  sha256:6b90…
  classification:     internal-personal    # a transcript routinely names people
```

Rules: `accountable` is a human and never moves; the authority fields are resolved from work-service and runtime-service, never accepted from the runner; a run with no `plan` before its first act is refused; `outcome` is write-once. **`proposed` is distinct from `done`**: a run whose product is a version awaiting a decision has not done anything yet.

## The run-event contract

The runner emits JSON lines against a small contract; agent-service validates and records:

| Event | Carries | Rule |
|---|---|---|
| `run.started` | run envelope | authority fields resolved here |
| `plan` | ordered steps | mandatory before the first `tool_call`; may be revised, each revision recorded |
| `step` | index, intent, `next_touchpoint` | what "what's next" is built from |
| `tool_call` | tool, arguments digest, result digest | arguments are transcript, not record |
| `decision_point` | what a person must decide, where | surfaces on Today |
| `refused` | which check stopped it: schema · catalogue · ceiling · oversight · capability · budget | **a refusal is not a failure**; its rate per construct or seat is a signal |
| `run.ended` | outcome | closes the run |

Hooks in Claude Code emit these; the contract is versioned; the runner is substitutable.

## What is an event and what is a payload

Four spine events: `RunStarted · ActionRefused · RunEscalated · RunClosed`. Everything else — steps, reasoning, tool traffic, retries — is the transcript, one S3 object per run, classified, retained by policy, erasable, readable only by a role. Drop the runner's state entirely and every governance question about a historical run is still answerable from the archive and the transcript store.

## The runner

- A GitHub Actions workflow per run kind in the application's or the estate's repository, triggered by work-service through a repository dispatch carrying the item id.
- Authenticates to maestro as an **agent principal** (identity-service client credentials); the accountable human is resolved from the item.
- Holds a **GitHub App token scoped to draft PRs** and read; never a merge token. Merge is a person's act, or — for green patch-level bumps on N2 — work-service's under policy.
- Six-hour limit, job isolation, the repository's own secrets. Lambda's fifteen minutes do not fit an analysis.

## Sampling

A recurring `review` item in work-service selects one run in N per seat for a person to read; N decays with sustained agreement toward a floor that is never zero. The reviewer's finding is recorded against the seat.

## Interfaces

| Operation | Surface |
|---|---|
| `events` (the contract) | API — runner only |
| `get`, `list`, `timeline`, `refusals(seat|construct)` | console, API, MCP |
| `transcript(run)` | API — reader role only; never MCP |
| `export(workspace)` | API — runs and outcomes; transcripts only with the reader role |

## Acceptance

The MVP's acceptance scenarios A1, A3, A4 and A5 ([roadmap](../roadmap.md#acceptance)).

1. A `bump` run on a red CI: every step, the plan and the next human touchpoint visible while it runs; the transcript readable afterwards by the reader role and by nobody else.
2. A run that attempts an act outside its ceiling records `ActionRefused` with the check named, and the run continues or closes `refused` per the construct.
3. Drop the runner's state; every run's history reads back from the archive and the transcript store.
4. One run in N lands in a person's review queue; the floor cannot be configured to zero.
