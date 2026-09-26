/**
 * The clocks, against DynamoDB Local: maestro's M2 build gates 3 and 4 as tests. The sweep is run by
 * hand at chosen instants, as the schedule would run it once a minute.
 *
 * 3. A deadline-bearing item chases, escalates and breaches on schedule; every step's delivery is
 *    recorded.
 * 4. An agent claims an item; its lease expires; the item returns to `open` with a reason;
 *    `accountable` unchanged throughout.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, demoWorkspace, harness, RecordingNotifier, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const ALICE = 'prn-h-alice';
const OWNER = 'prn-h-demo-owner';
const STEWARD = 'prn-h-demo-steward';
const AGENT = 'prn-a-remed';
const SWEEP = 'prn-w-work-sweep-local';
const T0 = '2026-09-25T08:00:00Z';

describe('clocks', () => {
  let h: Harness;
  const notifier = new RecordingNotifier();
  const call = async (principal: string, method: 'GET' | 'POST', url: string, payload?: unknown) => {
    const res = await h.app.server.inject({
      method,
      url: `/v1/workspaces/${WS}${url}`,
      headers: bearer(principal),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.json() };
  };
  const at = async (iso: string) => {
    h.setNow(iso);
    return h.app.sweep.once();
  };
  const eventsOf = async (id: string) =>
    (await (await h.app.store.handle(WS)).outbox.list()).filter((e) => e.subject_id === id);

  beforeAll(async () => {
    h = await harness('clocks', T0, { notifier });
    await demoWorkspace(h.app, [
      { principal: ALICE, roles: ['operations'] },
      { principal: OWNER, roles: ['owner', 'operations'] },
      { principal: AGENT, roles: ['operations'], accountable: ALICE },
    ]);
    notifier.unreachable.add(STEWARD);
  });
  afterAll(async () => h.close());

  it('chases, escalates and breaches a deadline-bearing item on schedule, recording every delivery (gate 3)', async () => {
    h.setNow(T0);
    // sev1 on a tier2 application: respond within 30 minutes, resolve within 8 hours.
    const { body } = await call(ALICE, 'POST', '/items', {
      class: 'remediation',
      title: 'Queue consumer down',
      application: 'app1',
      environment: 'prod',
      remediation_class: 'restore',
      severity_hint: 'P1',
    });
    const id = body.item.item_id;
    expect(body.item).toMatchObject({
      respond_by: '2026-09-25T08:30:00Z',
      resolve_by: '2026-09-25T16:00:00Z',
      chase: {
        ladder: 'standard',
        steps: ['reminder', 'chase', 'escalate_accountable', 'escalate_steward'],
        next: 0,
      },
    });

    // Nothing is due before its time.
    expect((await at('2026-09-25T08:29:00Z')).events).toEqual({});

    // Nobody responded in 30 minutes: the breach is recorded, and the item stays open.
    expect((await at('2026-09-25T08:31:00Z')).events).toEqual({ WorkItemBreached: 1 });
    // The steps fall at 1/5, 2/5, 3/5 and 4/5 of the window; the breach at its end.
    expect((await at('2026-09-25T09:36:00Z')).events).toEqual({ WorkItemChased: 1 });
    expect((await at('2026-09-25T11:12:00Z')).events).toEqual({ WorkItemChased: 1 });
    expect((await at('2026-09-25T12:48:00Z')).events).toEqual({ WorkItemChased: 1 });
    // A sweep that missed a step fires it late, in order, alongside what else is due.
    expect((await at('2026-09-25T16:00:00Z')).events).toEqual({ WorkItemChased: 1, WorkItemBreached: 1 });
    // And once the ladder is spent, nothing more until the review date.
    expect((await at('2026-09-25T18:00:00Z')).due).toBe(0);

    const events = await eventsOf(id);
    const chased = events.filter((e) => e.type === 'WorkItemChased').map((e) => e.body);
    expect(chased).toEqual([
      { step: 'reminder', index: 0, to: OWNER, delivery: 'delivered' },
      { step: 'chase', index: 1, to: OWNER, delivery: 'delivered' },
      { step: 'escalate_accountable', index: 2, to: OWNER, delivery: 'delivered' },
      { step: 'escalate_steward', index: 3, to: STEWARD, delivery: 'failed' },
    ]);
    expect(notifier.notices.filter((n) => n.item_id === id).map((n) => [n.step, n.to])).toEqual([
      ['reminder', OWNER],
      ['chase', OWNER],
      ['escalate_accountable', OWNER],
      ['escalate_steward', STEWARD],
    ]);
    expect(events.filter((e) => e.type === 'WorkItemBreached').map((e) => e.body)).toEqual([
      { clock: 'respond_by', due: '2026-09-25T08:30:00Z' },
      { clock: 'resolve_by', due: '2026-09-25T16:00:00Z' },
    ]);
    // Every act of the sweep is its own, and answered for by the item's accountable human.
    for (const e of events.slice(1)) expect(e).toMatchObject({ acting: SWEEP, accountable: OWNER });

    const item = (await call(OWNER, 'GET', `/items/${id}`)).body.item;
    expect(item).toMatchObject({ state: 'open', breached: ['respond_by', 'resolve_by'] });
    expect(item.outcome).toBeUndefined();
    expect((await call(OWNER, 'GET', '/rates?application=app1')).body.months).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: 'breached_respond_by', count: 1 }),
        expect.objectContaining({ metric: 'breached_resolve_by', count: 1 }),
      ]),
    );

    // Past its review date it closes `expired` — recorded, never a disappearance.
    await at('2026-10-25T08:00:00Z');
    expect((await call(OWNER, 'GET', `/items/${id}`)).body.item).toMatchObject({
      state: 'closed',
      outcome: 'expired',
    });
  });

  it('returns an agent’s item to open when its lease expires, accountable unchanged (gate 4)', async () => {
    h.setNow('2026-11-01T08:00:00Z');
    const { body } = await call(ALICE, 'POST', '/items', {
      class: 'remediation',
      title: 'Rotate the key',
      application: 'app1',
      remediation_class: 'configure',
    });
    const id = body.item.item_id;
    const claimed = await call(AGENT, 'POST', `/items/${id}/claim`);
    expect(claimed.body).toMatchObject({ result: 'claimed', lease_expires_at: '2026-11-01T08:30:00Z' });

    // A heartbeat moves the lease; the claim and the state stand.
    h.setNow('2026-11-01T08:20:00Z');
    const beat = await call(AGENT, 'POST', `/items/${id}/heartbeat`);
    expect(beat.body).toMatchObject({
      lease_expires_at: '2026-11-01T08:50:00Z',
      item: { state: 'assigned', claimed_at: '2026-11-01T08:00:00Z' },
    });
    expect((await call(ALICE, 'POST', `/items/${id}/heartbeat`)).status).toBe(422);

    await at('2026-11-01T08:31:00Z');
    expect((await call(OWNER, 'GET', `/items/${id}`)).body.item).toMatchObject({
      state: 'assigned',
      assigned_to: AGENT,
    });

    // The agent went quiet: the lease expires and the item returns to open with the reason.
    await at('2026-11-01T08:51:00Z');
    const item = (await call(OWNER, 'GET', `/items/${id}`)).body.item;
    expect(item).toMatchObject({ state: 'open', accountable: OWNER, responded_at: '2026-11-01T08:00:00Z' });
    expect(item.assigned_to).toBeUndefined();

    const events = await eventsOf(id);
    expect(events.map((e) => e.type)).toEqual([
      'WorkItemRaised',
      'WorkItemAssigned',
      'WorkItemAssigned',
      'WorkItemReleased',
    ]);
    expect(events.at(-1)).toMatchObject({
      acting: SWEEP,
      accountable: OWNER,
      body: { released: AGENT, reason: 'lease_expired' },
    });
    expect(new Set(events.map((e) => e.accountable))).toEqual(new Set([OWNER]));

    // Open again for a principal who may; the respond clock was met by the first claim.
    expect((await call(ALICE, 'POST', `/items/${id}/claim`)).body.result).toBe('claimed');
  });

  it('rebuilds the clocks from the archive exactly as they were', async () => {
    const { sealBefore } = await import('@fps4/maestro-spine');
    const { RebuildService } = await import('../../src/services/rebuild.js');
    const { payloadStoreFor } = await import('../../src/relay/relay.js');
    const read = async () => (await call(OWNER, 'GET', '/frontier')).body.rows;
    expect((await h.app.relay!.drain()).refused).toEqual([]);
    await sealBefore(h.app.relay!.archive, '2099-01-01');
    const before = await read();
    await new RebuildService(h.app.store).rebuild({
      workspace: WS,
      archive: h.app.relay!.archive,
      payloads: payloadStoreFor(h.config),
      force: true,
    });
    const handle = await h.app.store.handle(WS);
    await handle.memberships.put({
      principal: OWNER,
      roles: ['owner'],
      granted_at: T0,
      granted_by: 'prn-h-operator',
    });
    expect(await read()).toEqual(before);
  });
});
