/**
 * The board, Today and `blocking` over HTTP: the frontier's set grouped by state and filtered, a
 * person's slice of it, and the edges a raise names — which a rebuild from the archive restores.
 */

import { sealBefore } from '@fps4/maestro-spine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadStoreFor } from '../../src/relay/relay.js';
import { RebuildService } from '../../src/services/rebuild.js';
import { bearer, demoWorkspace, harness, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const ALICE = 'prn-h-alice';
const OWNER = 'prn-h-demo-owner';
const AGENT = 'prn-a-remed';
const MEMBERS = [
  { principal: ALICE, roles: ['operations'] },
  { principal: OWNER, roles: ['owner', 'operations'] },
  { principal: AGENT, roles: ['operations'], accountable: ALICE },
];

describe('the board, Today and blocking', () => {
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
  const raise = async (body: Record<string, unknown>) =>
    (await call(ALICE, 'POST', '/items', body)).body.item;

  beforeAll(async () => {
    h = await harness('board', '2026-09-25T08:00:00Z');
    await demoWorkspace(h.app, MEMBERS);
  });
  afterAll(async () => h.close());

  it('groups the open set by state and lists what closed today, filtered by application and milestone', async () => {
    const milestone = await raise({ class: 'objective', title: 'Q4 hygiene', application: 'app1' });
    const open = await raise({
      class: 'remediation',
      title: 'Open',
      application: 'app1',
      milestone: milestone.item_id,
    });
    const held = await raise({
      class: 'remediation',
      title: 'Held',
      application: 'app1',
      milestone: milestone.item_id,
    });
    await call(ALICE, 'POST', `/items/${held.item_id}/claim`);
    const done = await raise({
      class: 'support',
      title: 'Done',
      application: 'app1',
      milestone: milestone.item_id,
    });
    await call(ALICE, 'POST', `/items/${done.item_id}/claim`);
    await call(ALICE, 'POST', `/items/${done.item_id}/resolve`, { outcome: 'done' });
    await raise({ class: 'support', title: 'Elsewhere', application: 'app2' });

    const board = (await call(ALICE, 'GET', `/board?milestone=${milestone.item_id}`)).body;
    expect(Object.keys(board.columns)).toEqual([
      'open',
      'assigned',
      'in_progress',
      'blocked',
      'resolved',
      'escalated',
    ]);
    expect(board.columns.open.map((r: { item_id: string }) => r.item_id)).toEqual([open.item_id]);
    expect(board.columns.assigned).toMatchObject([{ item_id: held.item_id, acting: ALICE }]);
    expect(board.closed_today).toMatchObject([{ item_id: done.item_id, outcome: 'done', state: 'closed' }]);

    const app2 = (await call(ALICE, 'GET', '/board?application=app2')).body;
    expect(app2.columns.open.map((r: { title: string }) => r.title)).toEqual(['Elsewhere']);
    expect(app2.closed_today).toEqual([]);

    expect((await call(ALICE, 'GET', '/board?owner=x')).status).toBe(400);
  });

  it('gives a person what they owe and the agents’ work they answer for', async () => {
    const mine = await raise({ class: 'support', title: 'Alice holds it' });
    await call(ALICE, 'POST', `/items/${mine.item_id}/claim`);
    const agents = await raise({
      class: 'remediation',
      title: 'The agent acts',
      application: 'app1',
      remediation_class: 'patch',
    });
    await call(AGENT, 'POST', `/items/${agents.item_id}/claim`);

    const alice = (await call(ALICE, 'GET', '/today')).body;
    expect(alice.principal).toBe(ALICE);
    expect(alice.owes.map((r: { item_id: string }) => r.item_id)).toContain(mine.item_id);
    expect(alice.oversees).toEqual([]);

    // The agent's item answers to app1's owner, whom the agent's claim does not relieve.
    const owner = (await call(OWNER, 'GET', '/today')).body;
    expect(owner.oversees).toMatchObject([{ item_id: agents.item_id, acting: AGENT }]);
    expect(owner.owes.map((r: { item_id: string }) => r.item_id)).not.toContain(agents.item_id);
  });

  it('records blocked_by at raise, refuses a closed or missing blocker, and restores the edges on a rebuild', async () => {
    const a = await raise({ class: 'support', title: 'A' });
    const b = await raise({ class: 'support', title: 'B' });
    const c = await raise({
      class: 'support',
      title: 'C waits on A and B',
      blocked_by: [a.item_id, b.item_id],
    });
    expect(c.blocked_by).toEqual([a.item_id, b.item_id]);

    const read = async () => ({
      c: (await call(ALICE, 'GET', `/items/${c.item_id}/blocking`)).body,
      a: (await call(ALICE, 'GET', `/items/${a.item_id}/blocking`)).body,
    });
    const before = await read();
    expect(before.c.blocked_by.map((r: { item_id: string }) => r.item_id).sort()).toEqual(
      [a.item_id, b.item_id].sort(),
    );
    expect(before.a).toMatchObject({
      blocked_by: [],
      blocks: [{ item_id: c.item_id, title: 'C waits on A and B' }],
    });

    expect(
      (await call(ALICE, 'POST', '/items', { class: 'support', title: 'x', blocked_by: ['wrk-9999'] }))
        .status,
    ).toBe(404);
    await call(ALICE, 'POST', `/items/${b.item_id}/claim`);
    await call(ALICE, 'POST', `/items/${b.item_id}/resolve`, { outcome: 'done' });
    const refused = await call(ALICE, 'POST', '/items', {
      class: 'support',
      title: 'x',
      blocked_by: [b.item_id],
    });
    expect(refused).toMatchObject({
      status: 422,
      body: { message: expect.stringContaining('blocks nothing') },
    });
    const afterClose = await read();
    expect(afterClose.c.blocked_by.map((r: { item_id: string }) => r.item_id)).toEqual([a.item_id]);

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
        granted_at: '2026-09-25T07:00:00Z',
        granted_by: 'prn-h-operator',
      });
    expect(await read()).toEqual(afterClose);
  });
});
