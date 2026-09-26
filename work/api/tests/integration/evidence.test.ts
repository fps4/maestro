/**
 * Evidence and intake, against DynamoDB Local: maestro's acceptance scenario W5 as a test.
 *
 * 5. The advisory lane end to end without an agent: advisory → item → Dependabot's PR → a person's
 *    merge → deploy event → re-scan → `done` on evidence; medium and low findings fold into one
 *    weekly obligation.
 *
 * The adapters (GitHub, EventBridge) are the next slice; here the envelopes and facts they will
 * produce are posted as they will post them, by a workload holding the `intake` seat.
 */

import { sealBefore } from '@fps4/maestro-spine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RECORD_KINDS } from '../../src/db/keys.js';
import { KIND } from '../../src/db/table.js';
import { payloadStoreFor } from '../../src/relay/relay.js';
import { RebuildService } from '../../src/services/rebuild.js';
import { bearer, demoWorkspace, harness, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const OWNER = 'prn-h-demo-owner';
const STEWARD = 'prn-h-demo-steward';
const INTAKE = 'prn-w-intake';
const T0 = '2026-09-28T08:00:00Z'; // a Monday: ISO week 2026-W40
const GHSA = 'GHSA-abcd-1234-wxyz';
const MEMBERS = [
  { principal: OWNER, roles: ['owner', 'operations'] },
  { principal: INTAKE, roles: ['intake'], accountable: OWNER },
];

describe('evidence and intake', () => {
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
  const signal = (fields: Record<string, unknown>, id = `d-${++delivery}`) =>
    call(INTAKE, 'POST', '/signals', {
      signal_version: 1,
      source: 'github',
      delivery_id: id,
      application: 'app1',
      environment: 'prod',
      occurred_at: T0,
      ...fields,
    });
  const fact = (body: Record<string, unknown>) => call(INTAKE, 'POST', '/facts', body);
  const item = async (id: string) => (await call(OWNER, 'GET', `/items/${id}`)).body.item;

  beforeAll(async () => {
    h = await harness('evidence', T0);
    await demoWorkspace(h.app, MEMBERS);
  });
  afterAll(async () => h.close());

  it('runs the advisory lane to done on evidence alone, in the order of the world (W5)', async () => {
    const advisory = {
      kind: 'advisory',
      fingerprint: `${GHSA}:app1`,
      detail: { severity: 'critical', id: GHSA },
    };
    const raised = await signal(advisory, 'gh-1');
    expect(raised).toMatchObject({ status: 201, body: { outcome: 'raised' } });
    const id = raised.body.items[0];
    expect(await item(id)).toMatchObject({
      class: 'remediation',
      remediation_class: 'patch',
      raised_by: 'signal',
      accountable: OWNER,
      severity: 'sev1',
      resolve_by: '2026-09-30T08:00:00Z', // critical: resolve within P2D
      fingerprint: `${GHSA}:app1`,
      evidence_plan: [
        { kind: 'merged_change' },
        { kind: 'deploy_event' },
        { kind: 'rescan_clear', fingerprint: `${GHSA}:app1` },
      ],
    });

    // The same delivery again is answered with what it became; the same advisory again, from another
    // scanner inside the window, is one item.
    expect((await signal(advisory, 'gh-1')).body).toMatchObject({
      outcome: 'raised',
      items: [id],
      replayed: true,
    });
    expect((await signal(advisory, 'gh-2')).body).toMatchObject({ outcome: 'attached', items: [id] });

    // A deploy before anything is merged meets nothing: the plan's order is the world's.
    h.setNow('2026-09-28T09:00:00Z');
    expect(
      (
        await fact({
          kind: 'deploy_event',
          application: 'app1',
          environment: 'prod',
          occurred_at: '2026-09-28T08:59:00Z',
        })
      ).body.outcome,
    ).toBe('unmatched');

    // Dependabot's pull request is linked; a person merges it.
    expect((await call(INTAKE, 'POST', `/items/${id}/link`, { pull_request: 'acme/app1#42' })).status).toBe(
      200,
    );
    expect(
      (
        await fact({
          kind: 'merged_change',
          repository: 'acme/app1',
          pull_number: 41,
          merged_at: '2026-09-28T10:00:00Z',
        })
      ).body.outcome,
    ).toBe('unmatched');
    expect(
      (
        await fact({
          kind: 'merged_change',
          repository: 'acme/app1',
          pull_number: 42,
          merged_at: '2026-09-28T10:00:00Z',
        })
      ).body,
    ).toEqual({ outcome: 'satisfied', items: [id] });

    // Dependabot re-scans the repository once the fix is on the default branch, which is usually
    // before the deploy finishes: it counts, because it follows the merge (ADR-0024). A deploy that
    // predates the merge does not count; the one after it closes the item.
    h.setNow('2026-09-28T10:10:00Z');
    expect(
      (await signal({ ...advisory, state: 'ok', occurred_at: '2026-09-28T10:05:00Z' }, 'gh-rescan')).body,
    ).toEqual({ outcome: 'satisfied', items: [id] });
    expect((await item(id)).state).toBe('open');
    expect(
      (
        await fact({
          kind: 'deploy_event',
          application: 'app1',
          environment: 'prod',
          occurred_at: '2026-09-28T09:59:00Z',
        })
      ).body.outcome,
    ).toBe('unmatched');

    // The deploy after the merge: done, and nobody ever claimed it.
    h.setNow('2026-09-28T11:00:00Z');
    expect(
      (
        await fact({
          kind: 'deploy_event',
          application: 'app1',
          environment: 'prod',
          occurred_at: '2026-09-28T10:30:00Z',
          digest: 'sha256:0123abcd',
        })
      ).body,
    ).toEqual({ outcome: 'satisfied', items: [id] });
    const done = await item(id);
    expect(done).toMatchObject({ state: 'closed', outcome: 'done', accountable: OWNER, signals: 1 });
    expect(done.assigned_to).toBeUndefined();
    expect(done.evidence_plan.map((e: { satisfied_by: string }) => e.satisfied_by)).toEqual([
      'acme/app1#42',
      'sha256:0123abcd',
      'github:gh-rescan',
    ]);
  });

  it('folds medium and low findings into one weekly obligation, done when each is re-scanned clear (W5)', async () => {
    h.setNow('2026-09-29T08:00:00Z');
    const medium = (n: number, severity = 'medium') => ({
      kind: 'advisory',
      fingerprint: `GHSA-mmmm-000${n}:app1`,
      detail: { severity, id: `GHSA-mmmm-000${n}` },
    });
    const first = await signal(medium(1));
    expect(first.body.outcome).toBe('raised');
    const id = first.body.items[0];
    expect((await signal(medium(2, 'low'))).body).toMatchObject({ outcome: 'folded', items: [id] });
    expect((await signal(medium(3))).body).toMatchObject({ outcome: 'folded', items: [id] });
    expect((await signal(medium(3))).body).toMatchObject({ outcome: 'folded', items: [id] }); // no second entry

    // Another application's finding that week is its own obligation, answered for by its own owner
    // (ADR-0025) — not a line on app1's.
    const other = await signal({ ...medium(5), application: 'app2', fingerprint: 'GHSA-mmmm-0005:app2' });
    expect(other.body.outcome).toBe('raised');
    expect(other.body.items[0]).not.toBe(id);
    expect(await item(other.body.items[0])).toMatchObject({
      about: { application: 'app2', environment: 'prod' },
      fold: 'weekly_dependency_hygiene#app2#prod#2026-W40',
    });

    const obligation = await item(id);
    expect(obligation).toMatchObject({
      class: 'obligation',
      fold: 'weekly_dependency_hygiene#app1#prod#2026-W40',
      resolve_by: '2026-10-05T00:00:00Z',
    });
    expect(obligation.evidence_plan.map((e: { fingerprint: string }) => e.fingerprint)).toEqual([
      'GHSA-mmmm-0001:app1',
      'GHSA-mmmm-0002:app1',
      'GHSA-mmmm-0003:app1',
    ]);

    // Cleared in any order; the last one closes the week's obligation.
    await signal({ ...medium(3), state: 'ok' });
    await signal({ ...medium(1), state: 'ok' });
    expect((await item(id)).state).not.toBe('closed');
    await signal({ ...medium(2, 'low'), state: 'ok' });
    expect(await item(id)).toMatchObject({ state: 'closed', outcome: 'done' });

    // A finding later that week raises the week's next obligation rather than reopening a closed one.
    const later = await signal(medium(4));
    expect(later.body.outcome).toBe('raised');
    expect(later.body.items[0]).not.toBe(id);
  });

  it('correlates an alarm storm into one item, and closes it on the next all-clear', async () => {
    h.setNow('2026-09-30T08:00:00Z');
    const alarm = {
      source: 'cloudwatch-alarm',
      kind: 'alarm_state',
      state: 'alarm',
      severity_hint: 'P2',
      fingerprint: 'app1/prod/api/ErrorRate',
    };
    const first = await signal(alarm);
    const id = first.body.items[0];
    expect(await item(id)).toMatchObject({
      class: 'remediation',
      severity: 'sev2',
      evidence_plan: [{ kind: 'signal_ok' }],
    });
    h.setNow('2026-09-30T08:05:00Z');
    expect((await signal(alarm)).body).toMatchObject({ outcome: 'attached', items: [id] });
    h.setNow('2026-09-30T08:12:00Z');
    expect((await signal(alarm)).body).toMatchObject({ outcome: 'attached', items: [id] }); // the window moved on
    expect((await signal({ ...alarm, state: 'ok', occurred_at: '2026-09-30T08:20:00Z' })).body.outcome).toBe(
      'satisfied',
    );
    expect(await item(id)).toMatchObject({ state: 'closed', outcome: 'done', signals: 2 });

    // The same fingerprint after its item closed raises a new one.
    expect((await signal(alarm)).body.outcome).toBe('raised');
  });

  it('raises a low review item for a signal about nothing the workspace declares — never nothing', async () => {
    const res = await signal({
      kind: 'alarm_state',
      state: 'alarm',
      application: 'app9',
      fingerprint: 'app9/prod/x',
    });
    expect(res.status).toBe(201);
    expect(await item(res.body.items[0])).toMatchObject({
      class: 'review',
      severity: 'sev4',
      accountable: STEWARD,
    });
    expect((await call(OWNER, 'POST', '/signals', {})).status).toBe(403); // the intake seat only
  });

  it('rebuilds the windows, the folds and what each item waits on from the archive alone', async () => {
    const records = async () => {
      const out: Array<Record<string, unknown>> = [];
      for await (const row of h.app.store.dump(WS)) {
        if (!RECORD_KINDS.includes(row[KIND] as never)) continue;
        const { delivered_at: _at, ...rest } = row;
        out.push(rest);
      }
      return out.sort((a, b) => `${a.pk}|${a.sk}`.localeCompare(`${b.pk}|${b.sk}`));
    };
    expect((await h.app.relay!.drain()).refused).toEqual([]);
    await sealBefore(h.app.relay!.archive, '2099-01-01');
    const before = await records();
    expect(before.some((r) => r[KIND] === 'expectation')).toBe(true);
    expect(before.some((r) => r[KIND] === 'fingerprint')).toBe(true);
    expect(before.some((r) => r[KIND] === 'fold')).toBe(true);
    await new RebuildService(h.app.store).rebuild({
      workspace: WS,
      archive: h.app.relay!.archive,
      payloads: payloadStoreFor(h.config),
      force: true,
    });
    expect(await records()).toEqual(before);
  });
});
