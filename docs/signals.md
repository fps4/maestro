# Signals — what the application owns, what maestro owns

**Detection lives where the knowledge lives; response lives where the record lives.** The team that owns an application's SLO owns its alarms, in its own infrastructure code. maestro never writes an alarm into a tenant's account. What maestro owns starts the moment a signal arrives: severity, the commitment, the clocks, who is told, what an agent may do about it.

## The split

| The application side — in its own IaC | The maestro side |
|---|---|
| CloudWatch alarms: thresholds, periods, composite alarms, anomaly detectors | Subscribe to the topic; normalise into the `signal` envelope |
| DLQ depth, error-rate and latency alarms on its own functions and queues | Dedup by `fingerprint` within a window; correlate a storm into one item |
| Its own failure monitor, publishing with a severity hint | **Severity from policy**: hint × application tier → SEV1–4; maestro may raise or lower, and records why |
| **One SNS topic per application per environment, `ops-signals`** — the application's public ops interface. Alarm actions *and OK actions* target it; the subscription policy admits the maestro account; anything else may subscribe too | Clocks, chase ladders, ceilings, evidence plans — the work item |
| Resource tags `maestro:application`, `maestro:environment`, `maestro:tier` so a signal identifies its instance without a lookup | Routing to people once it is an item, with the item link. **One alert, one owner:** once maestro subscribes, the application's direct Slack alert for the same signal retires |
| Deploy events to EventBridge from the pipeline: artifact digest, environment, commit, actor | What the application cannot see about itself: **silence** (heartbeat expired), estate-wide drift, GitHub advisories, ECR/Inspector findings, cross-account patterns |
| — | Maintenance windows and suppression, declared here because maestro is what pages |

**Two channels, one intake.** SNS carries the application's own signals; EventBridge carries AWS-native state — deploys, scan findings, health events — cross-account into maestro's bus. Both land in work-service's signals intake.

## The module

maestro ships the application-side half as a Terraform module and a CDK construct in the public repository:

- the `ops-signals` topic with a subscription policy for the maestro account;
- the tag schema;
- an alarm-action helper that wires an alarm's ALARM and OK actions to the topic;
- an optional heartbeat metric the application emits, so silence is detectable.

Onboarding at **N1** = the module applied and maestro subscribed; observe only. **N2** = agents may act under ceilings ([governance-model.md](governance-model.md)).

## The envelope

Owned by maestro, versioned. Every source adapter produces exactly this.

```yaml
signal_version: 1
source: cloudwatch-alarm | app-monitor | eventbridge | github | maestro-drift | maestro-heartbeat
application: app1                 # from the tag or the topic
environment: production
kind: alarm_state | dlq | error_rate | latency | deploy | advisory | finding | drift | silence
state: alarm | ok                # OK closes or downgrades; deploy and advisory have no state
severity_hint: P2                # the application's opinion; policy decides
fingerprint: app1/prod/fn-pipeline/ErrorRate     # dedup key; advisory id × artifact for findings
resource: arn:aws:lambda:eu-west-1:<account>:function:app1-fn-pipeline
occurred_at: 2026-09-18T08:12:00Z
link: https://console.aws.amazon.com/cloudwatch/…
detail: {}                       # source-specific, classified
```

## What a signal becomes

| Signal kind | Class of item | Notes |
|---|---|---|
| `alarm_state`, `dlq`, `error_rate`, `latency` | `remediation` | `state: ok` on the same fingerprint satisfies the evidence plan or downgrades |
| `advisory`, `finding` | `remediation` (critical, high) or folded into a weekly `obligation` (medium, low) | keyed by advisory id × artifact, so two scanners reporting one CVE make one item |
| `deploy` | none — feeds runtime-service; a production deploy of a high-tier application raises a `change` item | the seam the regulated branch needs |
| `drift` | `objective` | an agent proposes the plan, a person approves the apply |
| `silence` | `remediation` | raised by maestro's own heartbeat clock |

The mapping is policy in the tenant's work-service definition, never code.
