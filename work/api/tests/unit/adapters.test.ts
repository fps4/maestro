/**
 * The translators: a source's own message in, maestro's envelope or a fact out, or nothing with the
 * reason. The payloads are trimmed to the fields the translators read, in GitHub's and AWS's shapes.
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  bump,
  bumpedPackage,
  fromEventBridge,
  fromGitHub,
  fromQueue,
  fromSns,
  instanceOfTopic,
} from '../../src/domain/adapters.js';
import { parseWorkspaceDefinition } from '../../src/domain/definition.js';
import { verifyGitHub } from '../../src/http/routes.js';

const definition = parseWorkspaceDefinition(
  parse(readFileSync(resolvePath(__dirname, '../../../config/workspaces/aannemer-x.yaml'), 'utf8')),
);

const alert = (action: string, over: Record<string, unknown> = {}) => ({
  action,
  alert: {
    number: 7,
    updated_at: '2026-09-28T08:00:00Z',
    fixed_at: '2026-09-28T11:00:00Z',
    dependency: { package: { name: 'lodash' } },
    security_advisory: { ghsa_id: 'GHSA-aaaa-bbbb-cccc', severity: 'critical' },
    ...over,
  },
  repository: { full_name: 'aannemer-x/app1' },
});

describe('GitHub', () => {
  it('turns a Dependabot alert into an advisory against its application, and its fix into the re-scan', () => {
    const created = fromGitHub(definition, 'dependabot_alert', 'g1', alert('created'));
    expect(created).toMatchObject({
      kind: 'signal',
      signal: {
        source: 'github',
        delivery_id: 'g1',
        application: 'app1',
        environment: 'prod',
        kind: 'advisory',
        fingerprint: 'GHSA-aaaa-bbbb-cccc:aannemer-x/app1:lodash',
        detail: { severity: 'critical', id: 'GHSA-aaaa-bbbb-cccc' },
      },
    });
    expect(fromGitHub(definition, 'dependabot_alert', 'g2', alert('fixed'))).toMatchObject({
      signal: { state: 'ok', occurred_at: '2026-09-28T11:00:00Z' },
    });
    expect(
      fromGitHub(
        definition,
        'dependabot_alert',
        'g3',
        alert('created', { security_advisory: { ghsa_id: 'G', severity: 'moderate' } }),
      ),
    ).toMatchObject({ signal: { detail: { severity: 'medium' } } });
  });

  it('ignores what maestro does not act on, and says why', () => {
    expect(fromGitHub(definition, 'dependabot_alert', 'g', alert('dismissed'))).toMatchObject({
      kind: 'ignored',
      reason: expect.stringContaining('dismissed'),
    });
    expect(
      fromGitHub(definition, 'dependabot_alert', 'g', {
        ...alert('created'),
        repository: { full_name: 'someone/else' },
      }),
    ).toMatchObject({ kind: 'ignored', reason: expect.stringContaining('no application') });
    expect(fromGitHub(definition, 'ping', 'g', {})).toMatchObject({ kind: 'ignored' });
    expect(fromGitHub(definition, 'issues', 'g', {})).toMatchObject({ kind: 'ignored' });
  });

  it('turns a merge into a merged_change fact, and Dependabot’s pull request into a link', () => {
    const pr = (action: string, over: Record<string, unknown> = {}) => ({
      action,
      pull_request: {
        number: 42,
        merged: true,
        merged_at: '2026-09-28T10:00:00Z',
        title: 'Bump lodash from 4.17.20 to 4.17.21',
        user: { login: 'dependabot[bot]' },
        ...over,
      },
      repository: { full_name: 'aannemer-x/app1' },
    });
    expect(fromGitHub(definition, 'pull_request', 'g', pr('closed'))).toEqual({
      kind: 'fact',
      fact: {
        kind: 'merged_change',
        key: 'merged_change#aannemer-x/app1#42',
        ref: 'aannemer-x/app1#42',
        occurred_at: '2026-09-28T10:00:00Z',
      },
    });
    expect(fromGitHub(definition, 'pull_request', 'g', pr('closed', { merged: false }))).toMatchObject({
      kind: 'ignored',
    });
    expect(fromGitHub(definition, 'pull_request', 'g', pr('opened'))).toEqual({
      kind: 'link',
      repository: 'aannemer-x/app1',
      application: 'app1',
      package: 'lodash',
      pull_request: 'aannemer-x/app1#42',
    });
    expect(
      fromGitHub(definition, 'pull_request', 'g', pr('opened', { user: { login: 'someone' } })),
    ).toMatchObject({ kind: 'ignored' });
    expect(bumpedPackage('Bump @babel/core from 7.1.0 to 7.2.0 in /api')).toBe('@babel/core');
    expect(bumpedPackage('Bump the npm_and_yarn group across 1 directory with 2 updates')).toBeUndefined();
  });

  it('maps a repository that builds several applications by the manifest’s directory', () => {
    const doc = parse(
      readFileSync(resolvePath(__dirname, '../../../config/workspaces/aannemer-x.yaml'), 'utf8'),
    );
    doc.applications[0].repositories = [
      { repository: 'aannemer-x/mono', environment: 'prod', path: 'svc-a/' },
    ];
    doc.applications[1].repositories = [
      { repository: 'aannemer-x/mono', environment: 'prod', path: 'svc-b/' },
      { repository: 'aannemer-x/mono', environment: 'prod', path: 'svc-b/deep/' },
    ];
    const mono = parseWorkspaceDefinition(doc);
    const at = (manifest: string) =>
      fromGitHub(mono, 'dependabot_alert', 'g', {
        ...alert('created', { dependency: { package: { name: 'lodash' }, manifest_path: manifest } }),
        repository: { full_name: 'aannemer-x/mono' },
      });
    expect(at('svc-a/api/package-lock.json')).toMatchObject({
      signal: { application: 'app1', fingerprint: 'GHSA-aaaa-bbbb-cccc:aannemer-x/mono/svc-a/api:lodash' },
    });
    expect(at('svc-b/deep/package-lock.json')).toMatchObject({ signal: { application: 'app2' } });
    expect(at('tools/package-lock.json')).toMatchObject({
      kind: 'ignored',
      reason: expect.stringContaining('tools/package-lock.json'),
    });

    // Dependabot names the directory in its title; the link carries it, as the fingerprint does.
    expect(bump('Bump lodash from 4.17.20 to 4.17.21 in /svc-a/api')).toEqual({
      package: 'lodash',
      dir: 'svc-a/api',
    });
    expect(bump('Bump lodash from 4.17.20 to 4.17.21')).toEqual({ package: 'lodash', dir: '' });
    expect(
      fromGitHub(mono, 'pull_request', 'g', {
        action: 'opened',
        pull_request: {
          number: 5,
          title: 'Bump lodash from 4.17.20 to 4.17.21 in /svc-a/api',
          user: { login: 'dependabot[bot]' },
        },
        repository: { full_name: 'aannemer-x/mono' },
      }),
    ).toEqual({
      kind: 'link',
      repository: 'aannemer-x/mono/svc-a/api',
      application: 'app1',
      package: 'lodash',
      pull_request: 'aannemer-x/mono#5',
    });

    doc.applications[0].repositories.push({
      repository: 'aannemer-x/mono',
      environment: 'prod',
      path: 'svc-b/',
    });
    expect(() => parseWorkspaceDefinition(doc)).toThrow(/belongs to two applications/);
  });

  it('checks the webhook’s signature over the exact bytes, in constant time', () => {
    const body = '{"zen":"Keep it logically awesome."}';
    const sig = `sha256=${createHmac('sha256', 'a-secret-of-16-chars').update(body).digest('hex')}`;
    expect(verifyGitHub('a-secret-of-16-chars', body, sig)).toBe(true);
    expect(verifyGitHub('a-secret-of-16-chars', body + ' ', sig)).toBe(false);
    expect(verifyGitHub('another-secret-16ch', body, sig)).toBe(false);
    expect(verifyGitHub('a-secret-of-16-chars', body, undefined)).toBe(false);
  });
});

describe('SNS and EventBridge', () => {
  const sns = (message: unknown, topic = 'arn:aws:sns:eu-central-1::app1-prod-ops-signals') => ({
    Type: 'Notification',
    MessageId: 'm-1',
    TopicArn: topic,
    Message: JSON.stringify(message),
  });
  const alarm = (state: string, description = 'API 5xx above 1% — P2') => ({
    AlarmName: 'app1 api 5xx',
    AlarmDescription: description,
    NewStateValue: state,
    StateChangeTime: '2026-09-28T08:00:00.123+0000',
  });

  it('reads the instance from the signals module’s topic name', () => {
    expect(instanceOfTopic('arn:aws:sns:r:a:identity-service-production-ops-signals')).toEqual({
      application: 'identity-service',
      environment: 'production',
    });
    expect(instanceOfTopic('arn:aws:sns:r:a:some-topic')).toBeUndefined();
  });

  it('turns an alarm into a signal with the hint its description carries, and its OK into the all-clear', () => {
    expect(fromSns(sns(alarm('ALARM')))).toMatchObject({
      kind: 'signal',
      signal: {
        source: 'cloudwatch-alarm',
        application: 'app1',
        environment: 'prod',
        kind: 'alarm_state',
        state: 'alarm',
        severity_hint: 'P2',
        fingerprint: 'app1/prod/app1-api-5xx',
        occurred_at: '2026-09-28T08:00:00Z',
      },
    });
    expect(fromSns(sns(alarm('OK')))).toMatchObject({ signal: { state: 'ok' } });
    expect(fromSns(sns(alarm('INSUFFICIENT_DATA')))).toMatchObject({ kind: 'ignored' });
    expect(fromSns(sns(alarm('ALARM', '')))).not.toMatchObject({
      signal: { severity_hint: expect.anything() },
    });
  });

  it('takes an application’s own envelope as it is', () => {
    const own = {
      signal_version: 1,
      source: 'app-monitor',
      application: 'app1',
      environment: 'prod',
      kind: 'dlq',
      state: 'alarm',
      fingerprint: 'app1/prod/dlq',
      occurred_at: '2026-09-28T08:00:00Z',
    };
    expect(fromSns(sns(own))).toMatchObject({ kind: 'signal', signal: { ...own, delivery_id: 'm-1' } });
  });

  it('turns a deploy event into the deploy fact, and dispatches a queue record by its shape', () => {
    const deploy = {
      id: 'e-1',
      source: 'maestro.deploy',
      'detail-type': 'Deployment',
      time: '2026-09-28T10:30:00Z',
      detail: { application: 'app1', environment: 'prod', digest: 'sha256:abc123' },
    };
    expect(fromEventBridge(deploy)).toEqual({
      kind: 'fact',
      fact: {
        kind: 'deploy_event',
        key: 'deploy_event#app1#prod',
        ref: 'sha256:abc123',
        occurred_at: '2026-09-28T10:30:00Z',
      },
    });
    expect(fromQueue(JSON.stringify(deploy))).toMatchObject({ kind: 'fact' });
    expect(fromQueue(JSON.stringify(sns(alarm('ALARM'))))).toMatchObject({ kind: 'signal' });
    expect(fromQueue('not json')).toMatchObject({ kind: 'ignored' });
    expect(fromEventBridge({ ...deploy, source: 'aws.inspector2' })).toMatchObject({ kind: 'ignored' });
  });
});
