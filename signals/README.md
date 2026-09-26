# The signals module

The application-side half of the [signals contract](../docs/signals.md)
([ADR-0012](../docs/decisions/0012-the-application-owns-detection-maestro-owns-response.md)), in the
two languages an application's infrastructure is written in. What it is and why is in those two
documents; this file is how to apply it.

```
terraform/   the Terraform module; examples/app1 is app1's production environment applying it
cdk/         the same as a CDK construct, @fps4/maestro-signals, for an application that runs CDK
```

An application applies one copy per environment, from its own infrastructure code, in its own
account. maestro writes nothing into that account: it subscribes. Both halves create the same four
things and expose the same handles.

| It creates                                             | Notes                                                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<application>-<environment>-ops-signals`              | the SNS topic — the application's public ops interface. Its policy lets CloudWatch alarms in this account publish, lets anything in this account publish and subscribe, and lets the maestro account subscribe |
| the tag schema                                         | `maestro:application`, `maestro:environment`, `maestro:tier` on everything the module creates, and exported so the application spreads them onto its own resources — a signal then identifies its instance without a lookup |
| the alarm-action helper                                | Terraform: the `alarm_actions` and `ok_actions` outputs, put on an alarm as they are. CDK: `wireAlarm(alarm)`, or `alarmActions` for an application that adds them itself. ALARM **and** OK: the OK is what lets maestro close the item on evidence |
| the heartbeat, `<application>-<environment>-heartbeat` | optional, on by default — a metric so silence is detectable (below)                                                                                                                                           |

## Inputs and outputs

| Input                                   | Terraform            | CDK                | Meaning                                                                                                                                                          |
| --------------------------------------- | -------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| application                             | `application`        | `application`      | the application's name in maestro — `app1` in the docs                                                                                                           |
| environment                             | `environment`        | `environment`      | one of the application's: dev, test, acceptance, production                                                                                                      |
| tier                                    | `tier`               | `tier`             | the criticality tier as the tenant's policy names it — `tier1`, `tier2`, `tier3` in the docs; severity and clocks derive from it                                 |
| the maestro account                     | `maestro_account_id` | `maestroAccountId` | twelve digits, validated; **no default** — it comes from the application's tfvars or CDK context, never from a repository (the public-repository guards see to that) |
| heartbeat                               | `heartbeat`          | `heartbeat`        | default true                                                                                                                                                     |
| the application's own tags              | `tags`               | `Tags.of(...)`     | pass through; the three maestro tags win over them                                                                                                               |

| Output              | Terraform          | CDK                                | Meaning                                                                            |
| ------------------- | ------------------ | ---------------------------------- | ---------------------------------------------------------------------------------- |
| the topic           | `topic_arn`        | `topic`                            | what the tenant records in `applications/<application>.yaml` so maestro subscribes |
| the tags            | `tags`             | `tags`                             | the schema merged over the application's, to spread onto its own resources         |
| alarm actions       | `alarm_actions`    | `alarmActions`, `wireAlarm(alarm)` | the topic, in the shape an alarm takes                                             |
| OK actions          | `ok_actions`       | `wireAlarm(alarm)` sets both       | the same topic                                                                     |
| the heartbeat metric | `heartbeat_metric` | `heartbeatMetric`, `silenceAlarm`  | `maestro/heartbeat` · `Heartbeat` · dimensions application, environment; null/undefined when off |

### Terraform

```hcl
module "signals" {
  source             = "github.com/fps4/maestro//signals/terraform?ref=<tag>"
  application        = "app1"
  environment        = "production"
  tier               = "tier1"
  maestro_account_id = var.maestro_account_id   # from terraform.tfvars, outside any repository
}

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  # ... the application's own threshold and period ...
  alarm_actions = module.signals.alarm_actions
  ok_actions    = module.signals.ok_actions
  tags          = module.signals.tags
}
```

Terraform has no way to reach into an alarm the application declares, so the helper is a pair of
outputs and [`examples/app1/main.tf`](terraform/examples/app1/main.tf), which shows both
transitions wired. Terraform ≥ 1.6, providers `aws` ≥ 5.80 and `archive` ≥ 2.4; runs on OpenTofu
unchanged.

```sh
cd terraform && terraform init -backend=false && terraform test   # mocked provider; Terraform ≥ 1.11
```

### CDK

```ts
import { OpsSignals } from '@fps4/maestro-signals';

const signals = new OpsSignals(this, 'Signals', {
  application: 'app1',
  environment: 'production',
  tier: 'tier1',
  maestroAccountId: this.node.getContext('maestroAccountId'), // cdk.context.json or --context, outside any repository
});

signals.wireAlarm(
  new cloudwatch.Alarm(this, 'ApiErrors', {
    /* the application's own threshold and period */
  }),
);
```

`aws-cdk-lib` ≥ 2.186 and `constructs` ≥ 10 are peer dependencies — the application's own copies.
**The package is `private` and not yet published**: whether it goes to npm, GitHub Packages or is
vendored is a later decision; until then an application consumes it from a checkout of this
repository (`npm install ../maestro/signals/cdk` or a `file:` dependency).

```sh
cd cdk && npm ci && npm test
```

## The heartbeat

Silence is the one failure an application cannot report about itself, and nothing in an
application produces a metric on its own schedule. So the module does, in the cheapest way that is
honest about what it costs:

- a twenty-line Lambda (Node 22, arm64, the runtime's own AWS SDK — nothing bundled) puts one
  datapoint on `maestro/heartbeat` · `Heartbeat` with dimensions `application` and `environment`,
  invoked by an EventBridge Scheduler schedule every five minutes. Its role may do
  `cloudwatch:PutMetricData` in that namespace and nothing else; it has no log group, because the
  alarm is its observer and a beat that fails is a missed beat, not a log line;
- the silence alarm, `<application>-<environment>-silence`: `Sum` of the metric over 900 seconds,
  fewer than 1 is ALARM, **and a period with no datapoint at all is treated as breaching** — that is
  what makes an application that has stopped reporting visible. ALARM and OK both reach the topic.

The cost is one Lambda invocation every five minutes — 8,640 a month, inside the free tier and a few
cents outside it — plus the schedule and one alarm. `heartbeat = false` removes all of it, for an
environment nobody would page for.

Both halves carry the same handler file (`terraform/heartbeat/index.js`, `cdk/heartbeat/index.js`);
a test in `cdk/` fails if the two ever differ.

## Onboarding at N1

N1 — *operated* — is the module applied and maestro subscribed, and nothing else
([signals.md](../docs/signals.md), [governance-model.md](../docs/governance-model.md)). From the
application's side: apply the module in each environment, put the outputs on its alarms, and record
the topic ARN in the tenant's `applications/<application>.yaml`. maestro then subscribes its
signals intake to the topic, observes. The application keeps its own alert for the same signal: maestro alerts only in its
console in the MVP ([ADR-0023](../docs/decisions/0023-maestro-alerts-in-its-one-console.md)). Anything maestro does *to* the application waits for N2.

## Status

Built: the module is in code and tested against a mocked provider. The first application onboarded at
N1 proves it against an account.
