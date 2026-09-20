import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Duration, Stack, Tags } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export interface OpsSignalsProps {
  /** The application's name in maestro — `app1` in the docs. Names the topic, the heartbeat and the silence alarm. */
  readonly application: string;
  /** The environment this construct observes — one of the application's: dev, test, acceptance, production. */
  readonly environment: string;
  /** The application's criticality tier, as the tenant's policy names it — tier1, tier2, tier3 in the docs. */
  readonly tier: string;
  /**
   * The AWS account maestro's deployment runs in; the topic policy lets it subscribe. Twelve digits,
   * from the application's context or configuration, never a literal in a repository.
   */
  readonly maestroAccountId: string;
  /** Emit the heartbeat every five minutes and raise the silence alarm when it stops. Default true. */
  readonly heartbeat?: boolean;
}

const TOKEN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ACCOUNT_ID = /^[0-9]{12}$/;

export const HEARTBEAT_NAMESPACE = 'maestro/heartbeat';
export const HEARTBEAT_METRIC = 'Heartbeat';

/**
 * The application-side half of maestro's signals contract (docs/signals.md, ADR-0012): the
 * ops-signals topic and its policy, the tag schema, an alarm-action helper, and an optional
 * heartbeat so silence is detectable. One per application per environment, in the application's
 * own CDK app.
 */
export class OpsSignals extends Construct {
  /** `<application>-<environment>-ops-signals`: the application's public ops interface. */
  readonly topic: sns.Topic;
  /** The tag schema: maestro:application, maestro:environment, maestro:tier. Applied to everything here; spread onto the application's own resources. */
  readonly tags: Readonly<Record<string, string>>;
  /** For `alarm.addAlarmAction(...)` and `alarm.addOkAction(...)` — or use `wireAlarm`. */
  readonly alarmActions: readonly cloudwatch.IAlarmAction[];
  /** Where the heartbeat lands, for an application that wants its own view of it. Undefined when heartbeat is off. */
  readonly heartbeatMetric?: cloudwatch.Metric;
  /** `<application>-<environment>-silence`: fewer than one beat in fifteen minutes. Undefined when heartbeat is off. */
  readonly silenceAlarm?: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: OpsSignalsProps) {
    super(scope, id);

    const { application, environment, tier, maestroAccountId } = props;
    for (const [name, value] of [
      ['application', application],
      ['environment', environment],
      ['tier', tier],
    ] as const) {
      if (!TOKEN.test(value)) {
        throw new Error(
          `${name} is a lower-case token: letters, digits and hyphens, up to 64 characters; got ${JSON.stringify(value)}`,
        );
      }
    }
    if (!ACCOUNT_ID.test(maestroAccountId)) {
      throw new Error('maestroAccountId is a twelve-digit AWS account id');
    }

    const name = `${application}-${environment}`;
    const stack = Stack.of(this);

    // The tag schema. A signal identifies its instance from these without a lookup.
    this.tags = {
      'maestro:application': application,
      'maestro:environment': environment,
      'maestro:tier': tier,
    };
    for (const [key, value] of Object.entries(this.tags)) {
      Tags.of(this).add(key, value);
    }

    // --- the topic -----------------------------------------------------------------------------

    this.topic = new sns.Topic(this, 'Topic', { topicName: `${name}-ops-signals` });

    // Alarms in this account publish to it; the application's own monitor and anything else in
    // this account may publish and subscribe; the maestro account may subscribe and look. Nothing
    // outside these two accounts is admitted. The maestro principal is built from the partition
    // and the id, never written as a literal.
    this.topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchAlarmsPublish',
        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.topic.topicArn],
        conditions: { StringEquals: { 'aws:SourceAccount': stack.account } },
      }),
    );
    this.topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'ThisAccountPublishesAndSubscribes',
        principals: [new iam.AccountRootPrincipal()],
        actions: ['sns:Publish', 'sns:Subscribe', 'sns:GetTopicAttributes', 'sns:ListSubscriptionsByTopic'],
        resources: [this.topic.topicArn],
      }),
    );
    this.topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'MaestroSubscribes',
        principals: [new iam.AccountPrincipal(maestroAccountId)],
        actions: ['sns:Subscribe', 'sns:GetTopicAttributes', 'sns:ListSubscriptionsByTopic'],
        resources: [this.topic.topicArn],
      }),
    );

    this.alarmActions = [new cloudwatchActions.SnsAction(this.topic)];

    // --- the heartbeat -------------------------------------------------------------------------
    // Nothing in the application produces a metric on its own schedule, so the construct does: a
    // twenty-line function on EventBridge Scheduler puts one datapoint on maestro/heartbeat every
    // five minutes, and an alarm that treats a missing datapoint as breaching turns three missed
    // beats into a signal on the topic. One invocation per five minutes is the whole cost.

    if (props.heartbeat === false) return;

    const dimensions = { application, environment };

    // One action, one namespace. No log group: the silence alarm is the heartbeat's observer, and
    // a beat that fails is a missed beat, not a log line.
    const role = new iam.Role(this, 'HeartbeatRole', {
      roleName: `${name}-heartbeat`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        'put-heartbeat': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['cloudwatch:PutMetricData'],
              resources: ['*'],
              conditions: { StringEquals: { 'cloudwatch:namespace': HEARTBEAT_NAMESPACE } },
            }),
          ],
        }),
      },
    });

    const fn = new lambda.Function(this, 'Heartbeat', {
      functionName: `${name}-heartbeat`,
      description: `maestro heartbeat for ${application} ${environment}: one datapoint every five minutes`,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromInline(heartbeatHandler()),
      role,
      timeout: Duration.seconds(10),
      memorySize: 128,
      environment: { APPLICATION: application, ENVIRONMENT: environment },
    });

    new scheduler.Schedule(this, 'HeartbeatSchedule', {
      scheduleName: `${name}-heartbeat`,
      description: `maestro heartbeat for ${application} ${environment}`,
      schedule: scheduler.ScheduleExpression.rate(Duration.minutes(5)),
      // A beat retried past its own window is a late beat, not a heartbeat.
      target: new schedulerTargets.LambdaInvoke(fn, { retryAttempts: 2, maxEventAge: Duration.minutes(4) }),
    });

    this.heartbeatMetric = new cloudwatch.Metric({
      namespace: HEARTBEAT_NAMESPACE,
      metricName: HEARTBEAT_METRIC,
      dimensionsMap: dimensions,
      statistic: cloudwatch.Stats.SUM,
      period: Duration.minutes(15),
    });

    // Three beats fall in every period; fewer than one is an alarm, and no datapoint at all is the
    // same alarm — that is what makes an application that has stopped reporting visible.
    this.silenceAlarm = new cloudwatch.Alarm(this, 'Silence', {
      alarmName: `${name}-silence`,
      alarmDescription: `No heartbeat from ${application} ${environment} in fifteen minutes.`,
      metric: this.heartbeatMetric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    this.wireAlarm(this.silenceAlarm);
  }

  /**
   * The alarm-action helper: the alarm's ALARM and OK transitions both reach the topic. The OK is
   * what lets maestro close the item on evidence; an alarm without it never lets go.
   */
  wireAlarm<A extends cloudwatch.AlarmBase>(alarm: A): A {
    for (const action of this.alarmActions) {
      alarm.addAlarmAction(action);
      alarm.addOkAction(action);
    }
    return alarm;
  }
}

/** The handler's source, inlined into the function: signals/cdk/heartbeat/index.js, identical to the Terraform module's copy. */
function heartbeatHandler(): string {
  return readFileSync(join(__dirname, '..', 'heartbeat', 'index.js'), 'utf8');
}
