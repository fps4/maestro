/**
 * Acceptance scenario T1 (maestro docs/roadmap.md): a deploy event creates the artifact and the
 * instance; a second deploy shifts `rollback_target`; a rebuild from the archive is identical. And
 * the intake's edges: a redelivery recorded once, what is not this service's ignored with a reason.
 */

import { sealBefore } from '@fps4/maestro-spine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sbomStoreFor } from '../../src/relay/relay.js';
import { RebuildService } from '../../src/services/rebuild.js';
import { bearer, busEvent, demoWorkspace, digestOf, harness, uploadSbom, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const OWNER = 'prn-h-demo-owner';
const INTAKE = 'prn-w-runtime-intake';
const MEMBERS = [
  { principal: OWNER, roles: ['owner'] },
  { principal: INTAKE, roles: ['intake'], accountable: OWNER },
];

describe('the register (T1)', () => {
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
  const take = (event: object) => call(INTAKE, 'POST', '/intake', event);

  beforeAll(async () => {
    h = await harness('register');
    await demoWorkspace(h.app, MEMBERS);
  });
  afterAll(async () => h.close());

  it('records a build, a deploy creates the instance, a second deploy shifts the rollback target, and a rebuild reads identically', async () => {
    const first = digestOf('a1');
    const second = digestOf('b2');
    for (const [digest, commit, version] of [
      [first, 'c0ffee1', '1.0.0'],
      [second, 'c0ffee2', '1.1.0'],
    ] as const) {
      const sbom = await uploadSbom(h, 'app1', digest, [{ purl: `pkg:npm/lodash@4.17.21` }]);
      const built = await take(
        busEvent('maestro.build', { application: 'app1', digest, commit, version, sbom }),
      );
      expect(built).toMatchObject({
        status: 201,
        body: { outcome: 'recorded', events: ['ArtifactRecorded'] },
      });
    }

    const deployed = await take(
      busEvent('maestro.deploy', {
        application: 'app1',
        environment: 'prod',
        digest: first,
        commit: 'c0ffee1',
      }),
    );
    expect(deployed).toMatchObject({
      status: 201,
      body: { outcome: 'recorded', events: ['ArtifactDeployed'], mismatch: false },
    });
    let view = (await call(OWNER, 'GET', '/instances/app1/prod')).body;
    expect(view.instance).toMatchObject({
      instance_id: 'ins-app1-prod',
      digest: first,
      deployed_by: INTAKE,
      state: 'running',
      revision: 1,
    });
    expect(view.instance.rollback_target).toBeUndefined();
    expect(view.artifact).toMatchObject({ digest: first, built: true, version: '1.0.0' });

    await take(
      busEvent('maestro.deploy', {
        application: 'app1',
        environment: 'prod',
        digest: second,
        commit: 'c0ffee2',
      }),
    );
    view = (await call(OWNER, 'GET', '/instances/app1/prod')).body;
    expect(view.instance).toMatchObject({ digest: second, rollback_target: first, revision: 2 });
    expect(view.deploys.map((d: { digest: string }) => d.digest)).toEqual([second, first]);

    // A redeploy of what runs keeps the rollback target it had: copied, never computed.
    await take(
      busEvent('maestro.deploy', {
        application: 'app1',
        environment: 'prod',
        digest: second,
        commit: 'c0ffee2',
      }),
    );
    view = (await call(OWNER, 'GET', '/instances/app1/prod')).body;
    expect(view.instance).toMatchObject({ digest: second, rollback_target: first, revision: 3 });

    const read = async () => ({
      estate: (await call(OWNER, 'GET', '/instances')).body,
      prod: (await call(OWNER, 'GET', '/instances/app1/prod')).body,
      artifact: (await call(OWNER, 'GET', `/artifacts/app1/${first}`)).body,
      carries: (await call(OWNER, 'GET', '/carries?dependency=pkg:npm/lodash')).body,
    });
    const before = await read();
    expect(before.estate.instances).toHaveLength(1);

    await h.app.relay!.drain();
    await sealBefore(h.app.relay!.archive, '2099-01-01');
    const report = await new RebuildService(h.app.store).rebuild({
      workspace: WS,
      archive: h.app.relay!.archive,
      sboms: sbomStoreFor(h.config),
      force: true,
    });
    expect(report).toMatchObject({ artifacts: 2, instances: 1 });
    const handle = await h.app.store.handle(WS);
    for (const m of MEMBERS)
      await handle.memberships.put({
        ...m,
        granted_at: '2026-09-27T07:00:00Z',
        granted_by: 'prn-h-operator',
      });
    expect(await read()).toEqual(before);
  });

  it('records a redelivered event once, and answers it with the first result', async () => {
    const digest = digestOf('c3');
    const event = busEvent('maestro.build', { application: 'app2', digest, commit: 'abc1234' });
    expect((await take(event)).body).toMatchObject({ outcome: 'recorded' });
    expect(await take(event)).toMatchObject({
      status: 202,
      body: { outcome: 'recorded', replayed: true, events: [] },
    });
    // A second build record of a known build, under a new delivery, records nothing.
    expect(
      (await take(busEvent('maestro.build', { application: 'app2', digest, commit: 'abc1234' }))).body,
    ).toMatchObject({ outcome: 'known', events: [] });
  });

  it('ignores, with a reason, what is not a declared application and environment', async () => {
    const digest = digestOf('d4');
    expect(
      (
        await take(
          busEvent('maestro.deploy', { application: 'app9', environment: 'prod', digest, commit: 'x1' }),
        )
      ).body,
    ).toMatchObject({ outcome: 'ignored', reason: expect.stringContaining('app9') });
    expect(
      (
        await take(
          busEvent('maestro.deploy', { application: 'app2', environment: 'staging', digest, commit: 'x1' }),
        )
      ).body,
    ).toMatchObject({ outcome: 'ignored', reason: expect.stringContaining('staging') });
    expect((await take({ ...busEvent('maestro.deploy', {}), source: 'aws.ec2' })).body).toMatchObject({
      outcome: 'ignored',
    });
    expect((await call(OWNER, 'GET', '/instances/app2/staging')).status).toBe(404);
    // Malformed is refused, not ignored: the pipeline has a bug to fix.
    expect(
      (await take(busEvent('maestro.deploy', { application: 'app1', environment: 'prod' }))).status,
    ).toBe(400);
  });

  it('takes in only from a principal holding intake', async () => {
    const event = busEvent('maestro.build', { application: 'app1', digest: digestOf('e5'), commit: 'x1' });
    expect((await call(OWNER, 'POST', '/intake', event)).status).toBe(403);
  });
});
