/**
 * An application's onboarding level and tier: a person's act, never a pipeline's or a run's
 * (maestro ADR-0027 §4). And isolation: one workspace's register is not another's, whatever the
 * caller names.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, busEvent, demoWorkspace, digestOf, harness, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const OTHER = 'other-tenant';
const OWNER = 'prn-h-demo-owner';
const READER = 'prn-h-reader';
const AGENT = 'prn-a-bump';
const INTAKE = 'prn-w-runtime-intake';

describe('level, tier and isolation', () => {
  let h: Harness;
  const call = async (
    ws: string,
    principal: string,
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
  ) => {
    const res = await h.app.server.inject({
      method,
      url: `/v1/workspaces/${ws}${url}`,
      headers: bearer(principal),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.json() };
  };

  beforeAll(async () => {
    h = await harness('applications');
    await demoWorkspace(h.app, [
      { principal: OWNER, roles: ['owner'] },
      { principal: READER, roles: [] },
      { principal: AGENT, roles: ['owner'], accountable: OWNER },
      { principal: INTAKE, roles: ['intake', 'owner'], accountable: OWNER },
    ]);
    await demoWorkspace(h.app, [{ principal: READER, roles: ['owner'] }], OTHER);
  });
  afterAll(async () => h.close());

  it('lets a person holding owner set the level and tier, recorded once and shown on the estate', async () => {
    const level = await call(WS, OWNER, 'POST', '/applications/app1/level', { onboarding_level: 'n2' });
    expect(level).toMatchObject({
      status: 200,
      body: { application: { application: 'app1', onboarding_level: 'n2', revision: 1 } },
    });
    await call(WS, OWNER, 'POST', '/applications/app1/tier', { tier: 'tier1' });
    // Setting what is already set records nothing.
    const again = await call(WS, OWNER, 'POST', '/applications/app1/tier', { tier: 'tier1' });
    expect(again.body.application).toMatchObject({ tier: 'tier1', revision: 2 });

    await call(
      WS,
      INTAKE,
      'POST',
      '/intake',
      busEvent('maestro.build', { application: 'app1', digest: digestOf('l1'), commit: 'c' }),
    );
    await call(
      WS,
      INTAKE,
      'POST',
      '/intake',
      busEvent('maestro.deploy', {
        application: 'app1',
        environment: 'prod',
        digest: digestOf('l1'),
        commit: 'c',
      }),
    );
    expect((await call(WS, READER, 'GET', '/instances')).body.instances).toMatchObject([
      { instance_id: 'ins-app1-prod', onboarding_level: 'n2', tier: 'tier1' },
    ]);

    await h.app.relay!.drain();
    const recorded = await h.app.relay!.archive.listDays('ws-aannemer-x');
    expect(recorded.length).toBeGreaterThan(0);
  });

  it('refuses an agent, a workload and a person without owner, each with a sentence', async () => {
    for (const [principal, pattern] of [
      [AGENT, /an agent/],
      [INTAKE, /a workload/],
      [READER, /needs `owner`/],
    ] as const) {
      const refused = await call(WS, principal, 'POST', '/applications/app2/level', {
        onboarding_level: 'n2',
      });
      expect(refused.status).toBe(422);
      expect(refused.body.message).toMatch(pattern);
    }
    expect(
      (await call(WS, OWNER, 'POST', '/applications/app9/level', { onboarding_level: 'n1' })).status,
    ).toBe(422);
    expect(
      (await call(WS, OWNER, 'POST', '/applications/app2/level', { onboarding_level: 'n9' })).status,
    ).toBe(400);
  });

  it('keeps each workspace to itself', async () => {
    // A member of another workspace is not a member here, and here's instances are not there.
    expect((await call(WS, 'prn-h-stranger', 'GET', '/instances')).status).toBe(403);
    expect((await call(OTHER, READER, 'GET', '/instances')).body.instances).toEqual([]);
    expect((await call(OTHER, OWNER, 'GET', '/instances')).status).toBe(403);
    expect((await call(OTHER, READER, 'GET', '/instances/app1/prod')).status).toBe(404);
  });
});
