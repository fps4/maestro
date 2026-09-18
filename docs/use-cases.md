# Use cases

The flows the MVP exists for, walked through the components. Where a component was missing, that is a gap (G-numbers); the [roadmap](roadmap.md) is ordered by which gaps each use case needs. The first application throughout is a serverless integration adapter on AWS with its own P1–P4 failure monitor and a drift-detection workflow.

## UC1 · Human-gated ops on a serverless application

Detect, classify, record, analyse, fix, deploy — with a person at exactly three points. [Figure 2](diagrams.md#figure-2--human-gated-ops-use-case-1).

| Step | How | Who |
|---|---|---|
| **Detect** | Deterministically, as the trigger: an alarm state, a queue depth, a failed run row, an advisory id — a fact a reader can re-derive, because everything downstream is attributed to it. The application's own monitor, CloudWatch alarms for errors and DLQ depth, GitHub advisories, the drift job, EventBridge health. A periodic agent sweep may raise a *signal* with the agent as raiser and a low default severity; it never raises an incident on its own and never replaces the deterministic detectors. | application → [signals](signals.md) |
| **Classify** | Severity is resolved from policy — signal kind × application tier → SEV, and SEV × tier → `respond_by` / `resolve_by`. An agent may propose a reclassification; a person confirms it as a recorded fact. One scale ([ADR-0009](decisions/0009-one-severity-scale.md)). | work-service |
| **Record** | A `remediation` item raised by signal in work-service — the component whose job is *who owes what, by when, under whose authority, and did it happen*. specs-service holds the analysis; GitHub holds the fix. GitHub is not the record of the incident: it has no answerable human, no derived clocks, no authority at claim, no closure outcome. | work-service |
| **Alert** | The notifier port with a Slack adapter, fired at raise for SEV ≤ 2 (policy), carrying the one link that matters: the item. | work-service |
| **Analyse** | A run claims the item; the authority check passes because *analyse* is within any agent's ceiling. It produces a `cause_analysis` artifact — cause, blast radius, contributing factors, fix plan as facets; narrative as body — and proposes it. **Gate 1: a person validates the analysis** on the decision page. Acceptance unlocks the fix. | agent-service, specs-service, **a person** |
| **Fix** | A second run, unlocked by the accepted analysis, opens a draft PR under a GitHub App token that can create draft PRs and nothing else. The item links the PR; runtime-service records the artifact when it builds. **Gate 2: PR review and merge** under CODEOWNERS. The merger is the acting principal; the answerable person does not change. | agent-service, GitHub, **a person** |
| **Close** | The evidence plan is three facts: a merged change with CI green, a deploy event for that artifact, the alarm back to OK. Each is satisfied by an event, not by typing "done". `escalated_out` when authority was short — **Gate 3: a person takes the act the agent was refused, or grants it.** | work-service, runtime-service, **a person** |

**Gaps:** G1 signal intake with SNS, EventBridge and GitHub adapters · G2 policy in work-service's definition and a criticality tier per application in runtime-service · G3 the runner · G4 the `cause_analysis` type and gate · G5 evidence resolved from events · G6 notifier adapters.

## UC1b · The advisory lane

Dependabot, code-scanning, Trivy-in-CI and Inspector findings → remediation. Same mechanism as UC1; five things differ, and it is the acceptance gate of M2 and M3.

| Differs in | The lane |
|---|---|
| **Sources** | GitHub webhooks (`dependabot_alert`, `code_scanning_alert` — Trivy in CI lands here as SARIF) and Inspector/ECR findings via EventBridge for deployed images. Keyed by advisory id × artifact, so one CVE from two scanners is one item. |
| **No analysis** | The cause is known and the fix is usually a version bump. No gate 1. A plain bump is deterministic: Dependabot's PR is the fix; the engine's job is the commitment, the merge decision, and what happens when CI goes red. A `bump` run is invoked only for the red case — the bump broke a test, make it pass. |
| **Clocks and noise** | Patch latency is a commitment: `resolve_by` from advisory severity × reachability × application tier. Critical and high → one item each, now. Medium and low → folded into a weekly `obligation`, or the board is nothing but bumps. Policy rows, not code. |
| **Authority at claim** | Merging a bump is a patch-class act. On an N2 application an agent with `merge · patch` in its ceiling may merge a green, patch-level bump; on N1 it is refused at claim and escalated to the answerable person. Minor and major bumps are always a person's merge. |
| **Evidence and the honest no** | `done` needs the merged change, the deploy event, and the advisory no longer reported against the deployed digest — a re-scan event. `refused` with a reason is the VEX case: not affected, unreachable — recorded, so the finding does not return next week. |
| **Fan-out** | One advisory touches every image carrying the dependency. Per repository Dependabot does this; across the estate it needs the SBOMs runtime-service holds. Until M4 the lane is per repository; after, one parent item with a child per affected instance. |

## UC2 · Every run visible

Which agent is doing what, what comes next, the reasoning kept.

- **The record:** agent-service holds the run — principal, subject, started, current step, declared next step, ceiling in force, next human touchpoint, outcome. It executes nothing; the runner emits events against a contract, with a plan declared before the first act, which is why "what's next" exists.
- **The reasoning:** kept in full as a classified payload in S3, one object per run, with retention, an erasure path, and a reader role. Never an event.
- **The UI:** "Agents at work" on Today; a run page with the timeline, the tool calls, the ceiling, any refusal, and the next human touchpoint; a sampling queue so a person reads one run in N — the floor never zero.

**Gaps:** G7 the run record · G8 the run-event contract (hooks in Claude Code) · G9 transcript custody.

## UC3 · Others the engine already has a class for

| Use | Mechanism |
|---|---|
| **Recurring obligations** | Secret and token rotation, certificate expiry, backup-restore rehearsal, quarterly access review — `obligation` and `review` items on recurrence, a person answerable, an agent doing the restore-class part. |
| **Infrastructure drift** | The drift job already runs and ends in a log. Make it a signal: drift → `objective` item → an agent proposes the plan → a person approves the apply. |
| **Cost anomalies** | AWS Cost Anomaly Detection → signal → `remediation · scale` or `review`. |
| **A change record for production** | Every deploy is an event; a production deploy of a high-tier application is a `change` item with a gate — a change advisory board of one page, and the seam the regulated branch needs. |
| **Onboarding an application** | The first application is the first observed instance. An `intake_assessment` type exists; runtime-service holds the onboarding level; the level is what the authority check reads. |
| **Answering from runbooks** | An explainer agent over MCP in Slack: *what does this alarm mean, who is answerable* — reads the spec, the item, the runbook; answers, never closes. |
| **Post-incident review and SLO reporting** | A `review` item raised on every SEV ≤ 2 closure; escalated-out rate, time-to-respond and time-to-resolve as the numbers the portfolio reads. |

## Post-MVP

The Slack intake agent (gaps G10–G13) and customer-facing tenants (G14–G16) are described once in [beyond-mvp.md](beyond-mvp.md).
