/**
 * An application's tier and onboarding level as runtime-service sets them (maestro ADR-0027 §4):
 * projected from its events, read in place of the definition's from then on, replayed as nothing,
 * and restored by a rebuild from this service's own archive.
 */

import { sealBefore, uuidv7 } from '@fps4/maestro-spine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadStoreFor } from '../../src/relay/relay.js';
import { RebuildService } from '../../src/services/rebuild.js';
import { bearer, demoWorkspace, harness, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const OWNER = 'prn-h-demo-owner';
const ALICE = 'prn-h-alice';
const AGENT = 'prn-a-remed';
const INTAKE = 'prn-w-intake';
const MEMBERS = [
  { principal: ALICE, roles: ['operations'] },
  { principal: OWNER, roles: ['owner', 'operations'] },
  { principal: AGENT, roles: ['operations'], accountable: ALICE },
  { principal: INTAKE, roles: ['intake'], accountable: OWNER },
];

/** runtime-service's event as the spine delivers it: its stream, its seq, the person who set it. */
function runtimeEvent(
  seq: number,
  type: 'InstanceLevelSet' | 'InstanceTierSet',
  body: Record<string, string>,
) {
  return {
    event_id: uuidv7(),
    workspace_id: `ws-${WS}`,
    seq,
    subject_type: 'application',
    subject_id: body.application,
    subject_seq: seq,
    type,
    type_version: 1,
    occurred_at: '2026-09-27T09:00:00Z',
    recorded_at: '2026-09-27T09:00:00Z',
    accountable: OWNER,
    acting: OWNER,
    seat: 'owner',
    oversight_level: 'O0',
    consequence_class: 'c2',
    causation_id: null,
    correlation_id: uuidv7(),
    body,
  };
}

describe('projected authority', () => {
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
  const project = (event: unknown) => call(INTAKE, 'POST', '/authority', event);
  const patch = async () =>
    (
      await call(ALICE, 'POST', '/items', {
        class: 'remediation',
        title: 'Bump a dependency',
        application: 'app1',
        environment: 'prod',
        remediation_class: 'patch',
        severity_hint: 'P2',
      })
    ).body.item;

  beforeAll(async () => {
    h = await harness('authority', '2026-09-27T09:00:00Z');
    await demoWorkspace(h.app, MEMBERS);
  });
  afterAll(async () => h.close());

  it('reads a projected level and tier in place of the definition’s, for what is raised after', async () => {
    // app1 is declared N2 and tier2: an agent's patch claim is within its ceiling.
    const before = await patch();
    expect(before).toMatchObject({ onboarding_level: 'n2', tier: 'tier2' });
    expect((await call(AGENT, 'POST', `/items/${before.item_id}/claim`)).body.result).toBe('claimed');

    const level = runtimeEvent(1, 'InstanceLevelSet', { application: 'app1', onboarding_level: 'n1' });
    expect(await project(level)).toMatchObject({
      status: 200,
      body: { outcome: 'projected', application: 'app1', field: 'onboarding_level' },
    });
    expect(
      (await project(runtimeEvent(2, 'InstanceTierSet', { application: 'app1', tier: 'tier3' }))).body,
    ).toMatchObject({ outcome: 'projected', field: 'tier' });

    // Now N1 and tier3: the same patch is the owner's act, and the clocks are tier3's.
    const after = await patch();
    expect(after).toMatchObject({ onboarding_level: 'n1', tier: 'tier3' });
    expect(after.resolve_by).toBe('2026-10-02T09:00:00Z');
    const refused = (await call(AGENT, 'POST', `/items/${after.item_id}/claim`)).body;
    expect(refused).toMatchObject({ result: 'refused', check: 'onboarding' });

    // An item raised before keeps what it was raised under.
    expect((await call(ALICE, 'GET', `/items/${before.item_id}`)).body.item.onboarding_level).toBe('n2');

    // A redelivery, or an older event, moves nothing and records nothing.
    expect((await project(level)).body.outcome).toBe('unchanged');
    const stale = runtimeEvent(1, 'InstanceLevelSet', { application: 'app1', onboarding_level: 'n2' });
    expect((await project(stale)).body.outcome).toBe('unchanged');
    expect((await patch()).onboarding_level).toBe('n1');
  });

  it('refuses what it cannot read, and anyone but the intake', async () => {
    expect(
      await project(runtimeEvent(3, 'InstanceLevelSet', { application: 'app9', onboarding_level: 'n1' })),
    ).toMatchObject({ status: 422, body: { message: expect.stringContaining('`app9`') } });
    expect(
      (await project(runtimeEvent(3, 'InstanceTierSet', { application: 'app1', tier: 'tier9' }))).status,
    ).toBe(422);
    expect(
      (
        await call(
          ALICE,
          'POST',
          '/authority',
          runtimeEvent(3, 'InstanceLevelSet', { application: 'app1', onboarding_level: 'n2' }),
        )
      ).status,
    ).toBe(403);
  });

  it('restores the projection on a rebuild from the archive', async () => {
    await h.app.relay!.drain();
    await sealBefore(h.app.relay!.archive, '2099-01-01');
    await new RebuildService(h.app.store).rebuild({
      workspace: WS,
      archive: h.app.relay!.archive,
      payloads: payloadStoreFor(h.config),
      force: true,
    });
    const handle = await h.app.store.handle(WS);
    for (const m of MEMBERS)
      await handle.memberships.put({
        ...m,
        granted_at: '2026-09-27T07:00:00Z',
        granted_by: 'prn-h-operator',
      });

    expect(await handle.authorities.list()).toEqual([
      expect.objectContaining({ application: 'app1', onboarding_level: 'n1', tier: 'tier3', revision: 2 }),
    ]);
    expect(await patch()).toMatchObject({ onboarding_level: 'n1', tier: 'tier3' });
  });
});
