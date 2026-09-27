/**
 * Correlated outages and alarm order (maestro ADR-0028), against DynamoDB Local.
 *
 * Two sites behind one host's tunnel (`app3`, `app4`, failure domain `host1-tunnel`) and the probe that
 * watches them from outside (`probe`, the domain's detector). One outage in the domain is one item,
 * closed when every site in it is reachable again; while the probe's own alarm is open, the sites'
 * alarms are its; and an alarm's own time orders it, not its arrival.
 */

import { sealBefore } from '@fps4/maestro-spine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadStoreFor } from '../../src/relay/relay.js';
import { RebuildService } from '../../src/services/rebuild.js';
import { bearer, demoWorkspace, harness, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const OWNER = 'prn-h-demo-owner';
const INTAKE = 'prn-w-intake';
const MEMBERS = [
  { principal: OWNER, roles: ['owner', 'operations'] },
  { principal: INTAKE, roles: ['intake'], accountable: OWNER },
];

describe('correlated outages', () => {
  let h: Harness;
  let delivery = 0;
  const call = async (principal: string, method: 'GET' | 'POST', url: string, payload?: unknown) => {
    const res = await h.app.server.inject({
      method,
      url: `/v1/workspaces/${WS}${url}`,
      headers: bearer(principal),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.json() };
  };
  /** A probe's alarm as the SNS adapter delivers it: `<application>/prod/<application>-prod-unreachable`. */
  const alarm = (application: string, at: string, state: 'alarm' | 'ok' = 'alarm') =>
    call(INTAKE, 'POST', '/signals', {
      signal_version: 1,
      source: 'cloudwatch-alarm',
      delivery_id: `d-${++delivery}`,
      application,
      environment: 'prod',
      kind: 'alarm_state',
      state,
      fingerprint: `${application}/prod/${application}-prod-unreachable`,
      occurred_at: at,
    });
  const item = async (id: string) => (await call(OWNER, 'GET', `/items/${id}`)).body.item;

  beforeAll(async () => {
    h = await harness('outages', '2026-10-01T08:00:00Z');
    await demoWorkspace(h.app, MEMBERS);
  });
  afterAll(async () => h.close());

  it('makes one outage of two sites down together, and closes it when both are back', async () => {
    h.setNow('2026-10-01T08:00:00Z');
    const first = (await alarm('app3', '2026-10-01T08:00:00Z')).body;
    expect(first.outcome).toBe('raised');
    const id = first.items[0];
    expect(await item(id)).toMatchObject({
      class: 'remediation',
      about: { application: 'app3', environment: 'prod' },
      title: expect.stringContaining('failure domain host1-tunnel'),
    });

    h.setNow('2026-10-01T08:04:00Z');
    expect((await alarm('app4', '2026-10-01T08:04:00Z')).body).toMatchObject({
      outcome: 'attached',
      items: [id],
    });
    expect((await item(id)).evidence_plan).toEqual([
      { kind: 'signal_ok', fingerprint: 'app3/prod/app3-prod-unreachable' },
      { kind: 'signal_ok', fingerprint: 'app4/prod/app4-prod-unreachable' },
    ]);

    // One site back is not the outage over.
    h.setNow('2026-10-01T08:30:00Z');
    expect((await alarm('app3', '2026-10-01T08:30:00Z', 'ok')).body).toMatchObject({ outcome: 'satisfied' });
    expect((await item(id)).state).not.toBe('closed');
    expect((await alarm('app4', '2026-10-01T08:31:00Z', 'ok')).body).toMatchObject({ outcome: 'satisfied' });
    expect(await item(id)).toMatchObject({ state: 'closed', outcome: 'done' });
  });

  it('raises a new outage for an alarm outside the correlation window', async () => {
    h.setNow('2026-10-02T08:00:00Z');
    const one = (await alarm('app3', '2026-10-02T08:00:00Z')).body.items[0];
    h.setNow('2026-10-02T08:20:00Z'); // the window is PT15M
    const other = (await alarm('app4', '2026-10-02T08:20:00Z')).body;
    expect(other.outcome).toBe('raised');
    expect(other.items[0]).not.toBe(one);
    // Close both, for the next test.
    await alarm('app3', '2026-10-02T09:00:00Z', 'ok');
    await alarm('app4', '2026-10-02T09:00:00Z', 'ok');
  });

  it('attributes the sites’ alarms to the probe while the probe’s own alarm is open', async () => {
    h.setNow('2026-10-03T08:00:00Z');
    const probe = (await alarm('probe', '2026-10-03T08:00:00Z')).body.items[0];
    h.setNow('2026-10-03T09:00:00Z'); // long past the window: the probe's item holds while it is open
    expect((await alarm('app3', '2026-10-03T09:00:00Z')).body).toMatchObject({
      outcome: 'attached',
      items: [probe],
    });
    expect((await alarm('app4', '2026-10-03T09:00:00Z')).body).toMatchObject({
      outcome: 'attached',
      items: [probe],
    });

    // The probe back does not say the sites are: each site's own OK does.
    expect((await alarm('probe', '2026-10-03T09:30:00Z', 'ok')).body.outcome).toBe('satisfied');
    expect((await item(probe)).state).not.toBe('closed');
    await alarm('app3', '2026-10-03T09:31:00Z', 'ok');
    await alarm('app4', '2026-10-03T09:31:00Z', 'ok');
    expect(await item(probe)).toMatchObject({ state: 'closed', outcome: 'done' });
  });

  it('orders by the alarm’s own time: an OK that arrived first makes the older ALARM stale', async () => {
    h.setNow('2026-10-04T08:05:00Z');
    // The OK arrives first: nothing waits on it yet, and it is kept.
    expect((await alarm('app3', '2026-10-04T08:03:00Z', 'ok')).body.outcome).toBe('unmatched');
    // The ALARM it followed arrives after it, older: nothing is raised.
    expect((await alarm('app3', '2026-10-04T08:00:00Z')).body).toMatchObject({ outcome: 'stale', items: [] });
    // A later ALARM is a new outage.
    h.setNow('2026-10-04T08:10:00Z');
    const raised = (await alarm('app3', '2026-10-04T08:10:00Z')).body;
    expect(raised.outcome).toBe('raised');
    await alarm('app3', '2026-10-04T08:40:00Z', 'ok');
    expect((await item(raised.items[0])).state).toBe('closed');
  });

  it('rebuilds the outages from the archive: a later alarm still finds its domain’s', async () => {
    h.setNow('2026-10-05T08:00:00Z');
    const open = (await alarm('app3', '2026-10-05T08:00:00Z')).body.items[0];
    const read = async () => ({
      item: await item(open),
      frontier: (await call(OWNER, 'GET', '/frontier?application=app3')).body,
    });
    const before = await read();

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
        granted_at: '2026-10-01T07:00:00Z',
        granted_by: 'prn-h-operator',
      });

    expect(await read()).toEqual(before);
    expect(await handle.outages.get('site', 'host1-tunnel')).toMatchObject({ item_id: open });
    expect(await handle.outages.get('detector', 'host1-tunnel')).toMatchObject({ role: 'detector' });
    h.setNow('2026-10-05T08:05:00Z');
    expect((await alarm('app4', '2026-10-05T08:05:00Z')).body).toMatchObject({
      outcome: 'attached',
      items: [open],
    });
  });
});
