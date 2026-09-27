/**
 * A deploy's build record is put first, but the queue between them does not keep the order: a deploy
 * of a digest the ledger has never seen waits the grace for its build record before it is a mismatch.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, busEvent, demoWorkspace, digestOf, harness, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const OWNER = 'prn-h-demo-owner';
const INTAKE = 'prn-w-runtime-intake';
const NOW = '2026-09-27T09:00:00Z';

describe('the build grace', () => {
  let h: Harness;
  const call = async (principal: string, method: 'GET' | 'POST', url: string, payload?: unknown) => {
    const res = await h.app.server.inject({
      method,
      url: `/v1/workspaces/${WS}${url}`,
      headers: bearer(principal),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.json() };
  };
  const at = (event: object, time: string) => ({ ...event, time });
  const take = (event: object) => call(INTAKE, 'POST', '/intake', event);

  beforeAll(async () => {
    h = await harness('grace', NOW, { BUILD_GRACE_SECONDS: '300' });
    await demoWorkspace(h.app, [
      { principal: OWNER, roles: ['owner'] },
      { principal: INTAKE, roles: ['intake'], accountable: OWNER },
    ]);
  });
  afterAll(async () => h.close());

  it('holds a young deploy of an unseen digest until its build record arrives', async () => {
    const digest = digestOf('1a7e');
    const deploy = at(
      busEvent('maestro.deploy', { application: 'app1', environment: 'prod', digest, commit: 'c1' }),
      '2026-09-27T08:58:00Z',
    );
    expect(await take(deploy)).toMatchObject({
      status: 425,
      body: { message: expect.stringContaining('300s') },
    });
    expect((await call(OWNER, 'GET', '/instances/app1/prod')).status).toBe(404);

    await take(
      at(busEvent('maestro.build', { application: 'app1', digest, commit: 'c1' }), '2026-09-27T08:57:30Z'),
    );
    // The retry, the same delivery: recorded, and no mismatch.
    expect((await take(deploy)).body).toMatchObject({ outcome: 'recorded', mismatch: false });
    expect((await call(OWNER, 'GET', '/instances/app1/prod')).body.instance.state).toBe('running');
    expect(h.signals.sent).toEqual([]);
  });

  it('calls an unseen digest a mismatch once the grace has passed', async () => {
    const rogue = digestOf('01d0');
    const deploy = at(
      busEvent('maestro.deploy', { application: 'app1', environment: 'prod', digest: rogue, commit: 'c2' }),
      '2026-09-27T08:50:00Z',
    );
    expect((await take(deploy)).body).toMatchObject({ outcome: 'recorded', mismatch: true });
    expect(h.signals.sent).toHaveLength(1);
  });
});
