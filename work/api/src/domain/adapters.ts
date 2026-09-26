/**
 * The source adapters, as pure translators (maestro docs/signals.md, "Two channels, one intake"):
 * a source's own message in, maestro's envelope or a fact out — or nothing, with the reason. What
 * the transport is (a webhook, an SQS record) is the caller's; what the message means is here.
 *
 *   GitHub          dependabot_alert  → an advisory signal; `fixed` → its re-scan all-clear
 *                   pull_request      → merged: a `merged_change` fact; opened by Dependabot: a link
 *   SNS             a CloudWatch alarm → an alarm signal, the instance from the topic's name
 *                   a message already in the envelope → itself
 *   EventBridge     `maestro.deploy` → a `deploy_event` fact
 */

import { applicationOfRepository, type WorkspaceDefinition } from './definition.js';
import { factKeys, type Fact } from './evidence.js';
import { signalSchema, type Signal } from './intake.js';

export type Translation =
  | { kind: 'signal'; signal: Signal }
  | { kind: 'fact'; fact: Fact }
  | { kind: 'link'; repository: string; application: string; package: string; pull_request: string }
  | { kind: 'ignored'; reason: string };

const ignored = (reason: string): Translation => ({ kind: 'ignored', reason });
const toSecond = (t: string): string => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The fingerprint of an advisory against an artifact: one CVE from two scanners is one item. */
export const advisoryFingerprint = (ghsa: string, repository: string, pkg: string): string =>
  `${ghsa}:${repository}:${pkg}`;

interface GitHubAlert {
  action?: string;
  alert?: {
    number?: number;
    state?: string;
    fixed_at?: string | null;
    updated_at?: string;
    created_at?: string;
    html_url?: string;
    dependency?: { package?: { name?: string } };
    security_advisory?: { ghsa_id?: string; severity?: string };
  };
  repository?: { full_name?: string };
}

interface GitHubPullRequest {
  action?: string;
  pull_request?: {
    number?: number;
    merged?: boolean;
    merged_at?: string | null;
    title?: string;
    user?: { login?: string };
  };
  repository?: { full_name?: string };
}

/** Dependabot titles its bumps "Bump <package> from <old> to <new>[ in /dir]". Groups are not linked. */
export function bumpedPackage(title: string): string | undefined {
  return /^Bump (\S+) from \S+ to \S+/.exec(title)?.[1];
}

export function fromGitHub(
  definition: WorkspaceDefinition,
  event: string,
  delivery: string,
  payload: unknown,
): Translation {
  if (event === 'ping') return ignored('ping');

  if (event === 'dependabot_alert') {
    const p = payload as GitHubAlert;
    const repository = p.repository?.full_name;
    const ghsa = p.alert?.security_advisory?.ghsa_id;
    const pkg = p.alert?.dependency?.package?.name;
    const severity = p.alert?.security_advisory?.severity;
    if (!repository || !ghsa || !pkg || !severity)
      return ignored('a dependabot_alert without its repository, advisory, package or severity');
    const home = applicationOfRepository(definition, repository);
    if (!home) return ignored(`${repository} belongs to no application in this workspace`);
    const base = {
      signal_version: 1 as const,
      source: 'github' as const,
      delivery_id: delivery,
      application: home.application.id,
      environment: home.environment,
      kind: 'advisory' as const,
      fingerprint: advisoryFingerprint(ghsa, repository, pkg),
      ...(p.alert?.html_url ? { link: p.alert.html_url } : {}),
      detail: {
        severity: severity === 'moderate' ? 'medium' : severity,
        id: ghsa,
        package: pkg,
        alert: p.alert?.number ?? 0,
      },
    };
    switch (p.action) {
      case 'created':
      case 'reopened':
      case 'reintroduced':
        return {
          kind: 'signal',
          signal: signalSchema.parse({
            ...base,
            occurred_at: toSecond(p.alert?.updated_at ?? p.alert?.created_at ?? new Date().toISOString()),
          }),
        };
      case 'fixed':
        // The alert no longer reported against the manifest: the re-scan's all-clear.
        return {
          kind: 'signal',
          signal: signalSchema.parse({
            ...base,
            state: 'ok',
            occurred_at: toSecond(p.alert?.fixed_at ?? p.alert?.updated_at ?? new Date().toISOString()),
          }),
        };
      default:
        // `dismissed` is a person's call (the VEX case): they close the item `refused` with the reason.
        return ignored(`dependabot_alert ${p.action ?? '(no action)'} is not a fact maestro acts on`);
    }
  }

  if (event === 'pull_request') {
    const p = payload as GitHubPullRequest;
    const repository = p.repository?.full_name;
    const number = p.pull_request?.number;
    if (!repository || !number) return ignored('a pull_request without its repository or number');
    if (p.action === 'closed' && p.pull_request?.merged && p.pull_request.merged_at) {
      return {
        kind: 'fact',
        fact: {
          kind: 'merged_change',
          key: factKeys.merged_change(repository, number),
          ref: `${repository}#${number}`,
          occurred_at: toSecond(p.pull_request.merged_at),
        },
      };
    }
    if (
      (p.action === 'opened' || p.action === 'reopened') &&
      p.pull_request?.user?.login === 'dependabot[bot]'
    ) {
      const home = applicationOfRepository(definition, repository);
      const pkg = bumpedPackage(p.pull_request.title ?? '');
      if (!home || !pkg)
        return ignored('a Dependabot pull request that names no single package of a known application');
      return {
        kind: 'link',
        repository,
        application: home.application.id,
        package: pkg,
        pull_request: `${repository}#${number}`,
      };
    }
    return ignored(`pull_request ${p.action ?? '(no action)'} is not a fact maestro acts on`);
  }

  return ignored(`GitHub event \`${event}\` is not one maestro subscribes to`);
}

interface SnsNotification {
  Type?: string;
  MessageId?: string;
  TopicArn?: string;
  Message?: string;
}

interface CloudWatchAlarm {
  AlarmName?: string;
  AlarmDescription?: string | null;
  NewStateValue?: string;
  StateChangeTime?: string;
  AlarmArn?: string;
}

/** `<application>-<environment>-ops-signals`, the signals module's topic: the environment is the last word. */
export function instanceOfTopic(topicArn: string): { application: string; environment: string } | undefined {
  const name = topicArn.split(':').at(-1) ?? '';
  const m = /^(.+)-([a-z0-9]+)-ops-signals$/.exec(name);
  return m ? { application: m[1]!, environment: m[2]! } : undefined;
}

/**
 * An SNS notification from an application's `ops-signals` topic: a CloudWatch alarm's state change,
 * or the application's own monitor publishing the envelope itself. An alarm's severity hint is a
 * `P1`–`P4` in its description, where the application put one; policy decides either way.
 */
export function fromSns(n: SnsNotification): Translation {
  if (n.Type !== 'Notification' || !n.MessageId || !n.TopicArn || !n.Message)
    return ignored('not an SNS notification');
  let message: unknown;
  try {
    message = JSON.parse(n.Message);
  } catch {
    return ignored('an SNS message that is not JSON');
  }
  const m = message as Record<string, unknown>;
  if (m.signal_version === 1) {
    return { kind: 'signal', signal: signalSchema.parse({ delivery_id: n.MessageId, ...m }) };
  }
  const alarm = message as CloudWatchAlarm;
  if (!alarm.AlarmName || !alarm.NewStateValue)
    return ignored('an SNS message that is neither an alarm nor an envelope');
  const where = instanceOfTopic(n.TopicArn);
  if (!where) return ignored(`topic ${n.TopicArn} is not an <application>-<environment>-ops-signals topic`);
  if (alarm.NewStateValue === 'INSUFFICIENT_DATA')
    return ignored('INSUFFICIENT_DATA is not a state maestro acts on');
  const hint = /\bP[1-4]\b/.exec(alarm.AlarmDescription ?? '')?.[0];
  return {
    kind: 'signal',
    signal: signalSchema.parse({
      signal_version: 1,
      source: 'cloudwatch-alarm',
      delivery_id: n.MessageId,
      ...where,
      kind: 'alarm_state',
      state: alarm.NewStateValue === 'OK' ? 'ok' : 'alarm',
      ...(hint ? { severity_hint: hint } : {}),
      fingerprint: `${where.application}/${where.environment}/${alarm.AlarmName}`.replace(
        /[^A-Za-z0-9._:@/+=#-]/g,
        '-',
      ),
      ...(alarm.AlarmArn ? { resource: alarm.AlarmArn } : {}),
      occurred_at: toSecond(alarm.StateChangeTime ?? new Date().toISOString()),
      detail: {},
    }),
  };
}

interface EventBridgeEvent {
  id?: string;
  source?: string;
  'detail-type'?: string;
  time?: string;
  detail?: { application?: string; environment?: string; digest?: string; commit?: string };
}

/**
 * An EventBridge event. `maestro.deploy` is what an application's pipeline puts when it deploys:
 * `detail: { application, environment, digest, commit }` — the deploy fact an item waits on.
 */
export function fromEventBridge(e: EventBridgeEvent): Translation {
  if (e.source === 'maestro.deploy') {
    const d = e.detail ?? {};
    if (!d.application || !d.environment || !e.time)
      return ignored('a deploy event without its application, environment or time');
    return {
      kind: 'fact',
      fact: {
        kind: 'deploy_event',
        key: factKeys.deploy_event(d.application, d.environment),
        ref: d.digest ?? `deploy:${d.application}:${d.environment}:${e.id ?? e.time}`,
        occurred_at: toSecond(e.time),
      },
    };
  }
  return ignored(`EventBridge source \`${e.source ?? '(none)'}\` is not one maestro reads yet`);
}

/** One SQS record's body: an SNS notification (raw delivery off) or an EventBridge event. */
export function fromQueue(body: string): Translation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return ignored('a queue message that is not JSON');
  }
  const o = parsed as Record<string, unknown>;
  if (o.Type === 'Notification') return fromSns(o as SnsNotification);
  if (typeof o['detail-type'] === 'string') return fromEventBridge(o as EventBridgeEvent);
  return ignored('a queue message that is neither SNS nor EventBridge');
}
