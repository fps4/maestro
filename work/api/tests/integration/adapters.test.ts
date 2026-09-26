/**
 * The advisory lane through the adapters, against DynamoDB Local: GitHub's webhook as GitHub sends
 * it (signed), and the deploy event as the queue delivers it. Nobody calls the API by hand.
 */

import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromQueue } from '../../src/domain/adapters.js';
import { AdapterService, intakeScope } from '../../src/services/adapters.js';
import { WorkItemService } from '../../src/services/work-items.js';
import { WorkspaceRegistry } from '../../src/services/workspaces.js';
import { payloadStoreFor } from '../../src/relay/relay.js';
import { bearer, demoWorkspace, harness, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const OWNER = 'prn-h-demo-owner';
const INTAKE = 'prn-w-intake';
const SECRET = 'a-webhook-secret-of-some-length';
const T0 = '2026-09-28T08:00:00Z';

describe('the adapters', () => {
  let h: Harness;
  let n = 0;
  const hook = async (event: string, payload: unknown, secret = SECRET) => {
    const body = JSON.stringify(payload);
    const res = await h.app.server.inject({
      method: 'POST',
      url: `/v1/workspaces/${WS}/adapters/github`,
      headers: {
        'content-type': 'application/json',
        'x-github-event': event,
        'x-github-delivery': `72d3162e-cc78-11e3-81ab-${String(++n).padStart(12, '0')}`,
        'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      },
      payload: body,
    });
    return { status: res.statusCode, body: res.json() };
  };
  const alert = (action: string) => ({
    action,
    alert: {
      number: 3,
      updated_at: '2026-09-28T08:00:00Z',
      fixed_at: '2026-09-28T11:00:00Z',
      html_url: 'https://github.com/aannemer-x/app1/security/dependabot/3',
      dependency: { package: { name: 'lodash' } },
      security_advisory: { ghsa_id: 'GHSA-aaaa-bbbb-cccc', severity: 'high' },
    },
    repository: { full_name: 'aannemer-x/app1' },
  });
  const pr = (action: string) => ({
    action,
    pull_request: {
      number: 57,
      merged: action === 'closed',
      merged_at: action === 'closed' ? '2026-09-28T10:00:00Z' : null,
      title: 'Bump lodash from 4.17.20 to 4.17.21',
      user: { login: 'dependabot[bot]' },
    },
    repository: { full_name: 'aannemer-x/app1' },
  });

  beforeAll(async () => {
    h = await harness('adapters', T0, { env: { GITHUB_WEBHOOK_SECRET: SECRET, INTAKE_PRINCIPAL: INTAKE } });
    await demoWorkspace(h.app, [
      { principal: OWNER, roles: ['owner', 'operations'] },
      { principal: INTAKE, roles: ['intake'], accountable: OWNER },
    ]);
  });
  afterAll(async () => h.close());

  it('refuses a webhook it cannot verify', async () => {
    expect((await hook('ping', {}, 'not-the-secret-at-all')).status).toBe(401);
    expect((await hook('ping', {})).body).toMatchObject({ outcome: 'ignored' });
  });

  it('runs the advisory lane from GitHub and the queue alone, to done', async () => {
    const raised = await hook('dependabot_alert', alert('created'));
    expect(raised).toMatchObject({ status: 202, body: { outcome: 'raised' } });
    const id = raised.body.items[0];

    // Dependabot opens its pull request: the adapter links it; a person merges it.
    expect((await hook('pull_request', pr('opened'))).body).toEqual({ outcome: 'linked', items: [id] });
    h.setNow('2026-09-28T10:01:00Z');
    expect((await hook('pull_request', pr('closed'))).body).toEqual({ outcome: 'satisfied', items: [id] });

    // The pipeline's deploy event arrives through the queue, as the intake Lambda applies it.
    const items = new WorkItemService({
      store: h.app.store,
      payloads: payloadStoreFor(h.config),
      workspaces: new WorkspaceRegistry(h.app.store),
      now: () => '2026-09-28T10:31:00Z',
    });
    const scope = await intakeScope(h.app.store, WS, INTAKE);
    const deploy = JSON.stringify({
      id: 'e-1',
      source: 'maestro.deploy',
      'detail-type': 'Deployment',
      time: '2026-09-28T10:30:00Z',
      detail: { application: 'app1', environment: 'prod', digest: 'sha256:0123abcd' },
    });
    expect(await new AdapterService(items).apply(scope, fromQueue(deploy))).toEqual({
      outcome: 'satisfied',
      items: [id],
    });

    // Dependabot reports the alert fixed: the re-scan's all-clear, and the item is done.
    h.setNow('2026-09-28T11:01:00Z');
    expect((await hook('dependabot_alert', alert('fixed'))).body).toEqual({
      outcome: 'satisfied',
      items: [id],
    });
    const done = await h.app.server.inject({
      method: 'GET',
      url: `/v1/workspaces/${WS}/items/${id}`,
      headers: bearer(OWNER),
    });
    expect(done.json().item).toMatchObject({
      state: 'closed',
      outcome: 'done',
      links: { pull_request: 'aannemer-x/app1#57' },
      raised_by: 'signal',
      raised_by_principal: INTAKE,
    });
  });

  it('acts only as an intake workload the workspace admitted', async () => {
    await expect(intakeScope(h.app.store, WS, 'prn-w-stranger')).rejects.toThrow(/no `intake` seat/);
  });
});
