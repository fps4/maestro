import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App, Duration, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { describe, expect, it } from 'vitest';
import { OpsSignals } from '../src/index';
import type { OpsSignalsProps } from '../src/index';

// Twelve zeros, computed rather than written: the guard in scripts/check-public.sh refuses a
// twelve-digit literal on any line that also names an account, and nothing here needs one.
const MAESTRO = '0'.repeat(12);

const props: OpsSignalsProps = {
  application: 'app1',
  environment: 'production',
  tier: 'tier1',
  maestroAccountId: MAESTRO,
};

function synth(
  overrides: Partial<OpsSignalsProps> = {},
  extra?: (stack: Stack, signals: OpsSignals) => void,
) {
  const stack = new Stack(new App(), 'App1Production');
  const signals = new OpsSignals(stack, 'Signals', { ...props, ...overrides });
  extra?.(stack, signals);
  return { stack, signals, template: Template.fromStack(stack) };
}

const topicRef = { Ref: Match.stringLikeRegexp('^SignalsTopic') };
const maestroTags = Match.arrayWith([
  { Key: 'maestro:application', Value: 'app1' },
  { Key: 'maestro:environment', Value: 'production' },
  { Key: 'maestro:tier', Value: 'tier1' },
]);

describe('the topic', () => {
  it('is <application>-<environment>-ops-signals and carries the three tags', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'app1-production-ops-signals',
      Tags: maestroTags,
    });
  });

  it('lets CloudWatch alarms in this account publish', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'CloudWatchAlarmsPublish',
            Effect: 'Allow',
            Principal: { Service: 'cloudwatch.amazonaws.com' },
            Action: 'sns:Publish',
            Condition: { StringEquals: { 'aws:SourceAccount': { Ref: 'AWS::AccountId' } } },
          }),
        ]),
      },
    });
  });

  it('lets the maestro account subscribe and look, and nothing more', () => {
    const { template } = synth();
    const [policy] = Object.values(template.findResources('AWS::SNS::TopicPolicy'));
    const statement = policy?.Properties.PolicyDocument.Statement.find(
      (s: { Sid: string }) => s.Sid === 'MaestroSubscribes',
    );
    expect(statement).toBeDefined();
    expect(statement.Action).toEqual([
      'sns:Subscribe',
      'sns:GetTopicAttributes',
      'sns:ListSubscriptionsByTopic',
    ]);
    // arn:<partition>:iam::<maestro>:root, joined at deploy time from the partition — never a literal.
    expect(JSON.stringify(statement.Principal.AWS)).toContain(`:iam::${MAESTRO}:root`);
    expect(JSON.stringify(statement.Principal.AWS)).toContain('AWS::Partition');
  });

  it('lets anything else in this account publish and subscribe: the topic is the public ops interface', () => {
    const { template } = synth();
    template.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'ThisAccountPublishesAndSubscribes',
            Action: [
              'sns:Publish',
              'sns:Subscribe',
              'sns:GetTopicAttributes',
              'sns:ListSubscriptionsByTopic',
            ],
          }),
        ]),
      },
    });
  });

  it('names its principals; nothing is granted to everyone', () => {
    const { template } = synth();
    expect(JSON.stringify(template.findResources('AWS::SNS::TopicPolicy'))).not.toContain('"Principal":"*"');
    expect(JSON.stringify(template.findResources('AWS::SNS::TopicPolicy'))).not.toContain('"AWS":"*"');
  });
});

describe('the tags', () => {
  it('are the schema, exposed for the application to spread', () => {
    const { signals } = synth();
    expect(signals.tags).toEqual({
      'maestro:application': 'app1',
      'maestro:environment': 'production',
      'maestro:tier': 'tier1',
    });
  });
});

describe('the alarm-action helper', () => {
  it('wires ALARM and OK to the topic', () => {
    const { template } = synth({}, (stack, signals) => {
      signals.wireAlarm(
        new cloudwatch.Alarm(stack, 'ApiErrors', {
          alarmName: 'app1-production-api-errors',
          metric: new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Errors',
            dimensionsMap: { FunctionName: 'app1-production-api' },
            statistic: 'Sum',
            period: Duration.minutes(1),
          }),
          threshold: 1,
          evaluationPeriods: 5,
        }),
      );
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'app1-production-api-errors',
      AlarmActions: [topicRef],
      OKActions: [topicRef],
    });
  });

  it('exposes alarmActions for an application that adds them itself', () => {
    const { template } = synth({}, (stack, signals) => {
      const alarm = new cloudwatch.Alarm(stack, 'Manual', {
        alarmName: 'app1-production-manual',
        metric: new cloudwatch.Metric({ namespace: 'x', metricName: 'y' }),
        threshold: 1,
        evaluationPeriods: 1,
      });
      for (const action of signals.alarmActions) alarm.addAlarmAction(action);
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'app1-production-manual',
      AlarmActions: [topicRef],
    });
  });
});

describe('the heartbeat', () => {
  it('is on by default: a Node 22 arm64 function on a five-minute schedule', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'app1-production-heartbeat',
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Handler: 'index.handler',
      Environment: { Variables: { APPLICATION: 'app1', ENVIRONMENT: 'production' } },
      Code: { ZipFile: Match.stringLikeRegexp('maestro/heartbeat') },
      Tags: maestroTags,
    });
    template.resourceCountIs('AWS::Scheduler::Schedule', 1);
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'app1-production-heartbeat',
      ScheduleExpression: 'rate(5 minutes)',
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: Match.objectLike({ RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 240 } }),
    });
  });

  it('may put a metric in its own namespace, and nothing else', () => {
    const { template } = synth();
    const roles = template.findResources('AWS::IAM::Role', {
      Properties: { RoleName: 'app1-production-heartbeat' },
    });
    expect(Object.keys(roles)).toHaveLength(1);
    const [role] = Object.values(roles);
    expect(role?.Properties.ManagedPolicyArns).toBeUndefined();
    const policies = JSON.stringify(role?.Properties.Policies);
    expect(policies).toContain('cloudwatch:PutMetricData');
    expect(policies).toContain('"cloudwatch:namespace":"maestro/heartbeat"');
    expect(policies).not.toContain('logs:');
    expect(policies).not.toContain('sns:');
  });

  it('inlines the same handler the Terraform module zips', () => {
    const { template } = synth();
    const [fn] = Object.values(template.findResources('AWS::Lambda::Function'));
    const terraformCopy = readFileSync(
      join(__dirname, '..', '..', 'terraform', 'heartbeat', 'index.js'),
      'utf8',
    );
    expect(fn?.Properties.Code.ZipFile).toBe(terraformCopy);
  });

  it('raises the silence alarm: fewer than one beat in fifteen minutes, no data breaching, both transitions to the topic', () => {
    const { template, signals } = synth();
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'app1-production-silence',
      Namespace: 'maestro/heartbeat',
      MetricName: 'Heartbeat',
      Dimensions: Match.arrayWith([
        { Name: 'application', Value: 'app1' },
        { Name: 'environment', Value: 'production' },
      ]),
      Statistic: 'Sum',
      Period: 900,
      EvaluationPeriods: 1,
      Threshold: 1,
      ComparisonOperator: 'LessThanThreshold',
      TreatMissingData: 'breaching',
      AlarmActions: [topicRef],
      OKActions: [topicRef],
      Tags: maestroTags,
    });
    expect(signals.heartbeatMetric?.namespace).toBe('maestro/heartbeat');
    expect(signals.silenceAlarm).toBeDefined();
  });

  it('can be switched off: no function, role, schedule or alarm', () => {
    const { template, signals } = synth({ heartbeat: false });
    template.resourceCountIs('AWS::Lambda::Function', 0);
    template.resourceCountIs('AWS::Scheduler::Schedule', 0);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
    template.resourceCountIs('AWS::IAM::Role', 0);
    template.resourceCountIs('AWS::SNS::Topic', 1);
    expect(signals.heartbeatMetric).toBeUndefined();
    expect(signals.silenceAlarm).toBeUndefined();
  });
});

describe('the inputs', () => {
  it('refuse an account id that is not twelve digits', () => {
    expect(() => synth({ maestroAccountId: '12345' })).toThrow(/twelve-digit/);
  });

  it('refuse an application name that is not a token', () => {
    expect(() => synth({ application: 'App 1' })).toThrow(/application is a lower-case token/);
  });
});
