/**
 * The work item end to end, against DynamoDB Local: maestro's M2 build gates 1 and 2 as tests.
 *
 * 1. An item is raised, assigned, closed with an outcome, and read back identically after the
 *    workspace is dropped and rebuilt from the archive.
 * 2. A patch-class claim on an N1 application is refused at claim, closes `escalated_out`, and the
 *    rate is queryable in one call.
 */

import { sealBefore } from '@fps4/maestro-spine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIND } from '../../src/db/table.js';
import { RECORD_KINDS } from '../../src/db/keys.js';
import { payloadStoreFor } from '../../src/relay/relay.js';
import { RebuildRefused, RebuildService } from '../../src/services/rebuild.js';
import { bearer, demoWorkspace, harness, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const ALICE = 'prn-h-alice';
const BOB = 'prn-h-bob';
const OWNER = 'prn-h-demo-owner';
const AGENT = 'prn-a-remed';
const NOW = '2026-09-25T07:00:00Z';
const MEMBERS = [
  { principal: ALICE, roles: ['operations'] },
  { principal: BOB, roles: ['operations'] },
  { principal: OWNER, roles: ['owner', 'operations'] },
  { principal: AGENT, roles: ['operations'], accountable: ALICE },
];

describe('work items', () => {
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

  beforeAll(async () => {
    h = await harness('items');
    await demoWorkspace(h.app, MEMBERS);
  });
  afterAll(async () => h.close());

  it('raises an item with its authority fields resolved, and refuses a caller who sets one', async () => {
    const res = await call(ALICE, 'POST', '/items', {
      class: 'remediation',
      title: 'Parser advisory on app1',
      application: 'app1',
      environment: 'prod',
      remediation_class: 'patch',
      severity_hint: 'P2',
    });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({
      item_id: 'wrk-1',
      accountable: OWNER,
      severity: 'sev2',
      onboarding_level: 'n2',
      respond_by: '2026-09-25T10:00:00Z',
      state: 'open',
    });

    const refused = await call(ALICE, 'POST', '/items', { class: 'support', title: 'x', severity: 'sev1' });
    expect(refused.status).toBe(422);
    expect(refused.body.message).toContain('`severity` is resolved by the service');
  });

  it('answers a publish retried with the same key with the same item', async () => {
    const body = { class: 'support', title: 'Retried', key: 'req-42' };
    const first = await call(BOB, 'POST', '/items', body);
    const second = await call(BOB, 'POST', '/items', body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ replayed: true, item: { item_id: first.body.item.item_id } });
  });

  it('lets the first of two racing claims win and refuses the second with a sentence', async () => {
    const { body } = await call(ALICE, 'POST', '/items', {
      class: 'remediation',
      title: 'Race',
      application: 'app1',
    });
    const id = body.item.item_id;
    const [a, b] = await Promise.all([
      call(ALICE, 'POST', `/items/${id}/claim`),
      call(BOB, 'POST', `/items/${id}/claim`),
    ]);
    const results = [a.body.result, b.body.result].sort();
    expect(results).toEqual(['claimed', 'refused']);
    const loser = a.body.result === 'refused' ? a.body : b.body;
    expect(loser.check).toBe('held');
    expect(loser.sentence).toContain('the first claim won');
  });

  it('refuses a patch-class claim on an N1 application, closes it escalated_out, and counts it (gate 2)', async () => {
    const { body } = await call(ALICE, 'POST', '/items', {
      class: 'remediation',
      title: 'Advisory on app2',
      application: 'app2',
      remediation_class: 'patch',
    });
    const claim = await call(AGENT, 'POST', `/items/${body.item.item_id}/claim`);
    expect(claim.status).toBe(200);
    expect(claim.body).toMatchObject({
      result: 'refused',
      check: 'onboarding',
      item: { state: 'closed', outcome: 'escalated_out', accountable: OWNER },
    });

    const rates = await call(OWNER, 'GET', '/rates?application=app2');
    expect(rates.body).toMatchObject({
      application: 'app2',
      closed: { escalated_out: 1 },
      refusals: { onboarding_patch: 1 },
      escalated_out_rate: 1,
    });
  });

  it('refuses an agent above its ceiling and leaves the item open for a person', async () => {
    const { body } = await call(ALICE, 'POST', '/items', {
      class: 'remediation',
      title: 'A code change',
      application: 'app1',
      remediation_class: 'code_change',
    });
    const id = body.item.item_id;
    expect((await call(AGENT, 'POST', `/items/${id}/claim`)).body).toMatchObject({
      result: 'refused',
      check: 'ceiling',
      item: { state: 'open' },
    });
    expect((await call(ALICE, 'POST', `/items/${id}/claim`)).body.result).toBe('claimed');
    expect((await call(OWNER, 'GET', '/rates?application=app1')).body.refusals).toEqual({
      ceiling_code_change: 1,
    });
  });

  it('shows a person what they owe on the frontier, soonest first', async () => {
    const mine = await call(ALICE, 'GET', '/frontier?for=me');
    expect(mine.body.rows.every((r: { acting?: string }) => r.acting === ALICE)).toBe(true);
    const all = await call(OWNER, 'GET', '/frontier');
    const dues = all.body.rows.map((r: { due: string }) => r.due);
    expect(dues).toEqual([...dues].sort());
    expect((await call(OWNER, 'GET', '/frontier?application=app2')).body.rows).toEqual([]);
  });

  it('raises, assigns and closes an item, and reads back identically after a rebuild from the archive (gate 1)', async () => {
    const { body } = await call(ALICE, 'POST', '/items', {
      class: 'remediation',
      title: 'Restore the queue consumer',
      application: 'app1',
      environment: 'staging',
      remediation_class: 'restore',
    });
    const id = body.item.item_id;
    h.setNow('2026-09-25T08:05:00Z');
    expect((await call(AGENT, 'POST', `/items/${id}/claim`)).body.result).toBe('claimed');
    await call(AGENT, 'POST', `/items/${id}/transition`, { state: 'in_progress' });
    h.setNow('2026-09-25T08:20:00Z');
    const closed = await call(AGENT, 'POST', `/items/${id}/resolve`, {
      outcome: 'done',
      reason: 'Consumer restarted',
    });
    expect(closed.body.item).toMatchObject({
      state: 'closed',
      outcome: 'done',
      accountable: OWNER,
      reason: 'Consumer restarted',
    });

    const reads = async () => ({
      items: await Promise.all(
        ['wrk-1', 'wrk-2', 'wrk-3', 'wrk-4', 'wrk-5', id].map((i) => call(OWNER, 'GET', `/items/${i}`)),
      ),
      frontier: await call(OWNER, 'GET', '/frontier'),
      rates: [
        await call(OWNER, 'GET', '/rates?application=app1'),
        await call(OWNER, 'GET', '/rates?application=app2'),
      ],
    });
    const records = async () => {
      const out: Array<Record<string, unknown>> = [];
      for await (const item of h.app.store.dump(WS)) {
        if (!RECORD_KINDS.includes(item[KIND] as never)) continue;
        const { delivered_at: _at, ...rest } = item;
        out.push(rest);
      }
      return out.sort((a, b) => `${a.pk}|${a.sk}`.localeCompare(`${b.pk}|${b.sk}`));
    };

    const report = await h.app.relay!.drain();
    expect(report.refused).toEqual([]);
    // The day is sealed, as the sealer does at 00:07 UTC; an unsealed day is not a record yet.
    // (The relay files under the real day it ran; seal everything up to a day that is surely later.)
    expect((await sealBefore(h.app.relay!.archive, '2099-01-01')).length).toBeGreaterThan(0);
    const before = { reads: await reads(), records: await records() };

    const rebuild = new RebuildService(h.app.store);
    const payloads = payloadStoreFor(h.config);
    await expect(
      rebuild.rebuild({ workspace: WS, archive: h.app.relay!.archive, payloads }),
    ).rejects.toBeInstanceOf(RebuildRefused);
    const result = await rebuild.rebuild({
      workspace: WS,
      archive: h.app.relay!.archive,
      payloads,
      force: true,
    });
    expect(result).toMatchObject({ items: before.records.filter((r) => r[KIND] === 'item').length });

    // Memberships are grants, not record: the operator re-applies them after a rebuild.
    const handle = await h.app.store.handle(WS);
    for (const m of MEMBERS)
      await handle.memberships.put({ ...m, granted_at: NOW, granted_by: 'prn-h-operator' });

    const after = { reads: await reads(), records: await records() };
    expect(after).toEqual(before);

    // The counters were restored: the next item is the next number, and its first event the
    // workspace's next seq.
    const last = before.records.filter((r) => r[KIND] === 'outbox').length;
    const next = await call(ALICE, 'POST', '/items', { class: 'support', title: 'After the rebuild' });
    expect(next.body.item.item_id).toBe(`wrk-${Number(id.slice(4)) + 1}`);
    expect((await handle.outbox.pending(10)).map((r) => r.seq)).toEqual([last + 1]);
  });
});
