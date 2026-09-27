/**
 * Acceptance scenario T2 (maestro docs/roadmap.md): a deploy of a digest with no build record raises
 * `DigestMismatchDetected` and a SEV item; the instance is marked, never silently corrected. The SEV
 * item is work-service's to raise: this service sends it a `digest_mismatch` signal (ADR-0027 §5).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signalOf } from '../../src/signals/sink.js';
import { bearer, busEvent, demoWorkspace, digestOf, harness, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const OWNER = 'prn-h-demo-owner';
const INTAKE = 'prn-w-runtime-intake';

describe('a digest with no build record (T2)', () => {
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
    h = await harness('mismatch');
    await demoWorkspace(h.app, [
      { principal: OWNER, roles: ['owner'] },
      { principal: INTAKE, roles: ['intake'], accountable: OWNER },
    ]);
  });
  afterAll(async () => h.close());

  it('records the mismatch, marks the instance, sends the signal, and clears only on a built deploy', async () => {
    const good = digestOf('g00d');
    const rogue = digestOf('bad0');
    await take(busEvent('maestro.build', { application: 'app1', digest: good, commit: 'aaa1' }));
    await take(
      busEvent('maestro.deploy', { application: 'app1', environment: 'prod', digest: good, commit: 'aaa1' }),
    );

    const event = busEvent('maestro.deploy', {
      application: 'app1',
      environment: 'prod',
      digest: rogue,
      commit: 'fff9',
    });
    const taken = await take(event);
    expect(taken.body).toEqual({
      outcome: 'recorded',
      events: ['ArtifactRecorded', 'ArtifactDeployed', 'DigestMismatchDetected'],
      mismatch: true,
      signal: 'delivered',
    });

    const view = (await call(OWNER, 'GET', '/instances/app1/prod')).body;
    expect(view.instance).toMatchObject({ digest: rogue, state: 'mismatched', rollback_target: good });
    expect(view.artifact).toMatchObject({ digest: rogue, built: false });
    expect(view.deploys[0]).toMatchObject({ digest: rogue, mismatch: true });
    expect(view.deploys[1]).toMatchObject({ digest: good, mismatch: false });

    // The signal work-service's intake reads: one fingerprint per instance and digest, severity a hint.
    expect(h.signals.sent).toHaveLength(1);
    expect(signalOf(h.signals.sent[0]!)).toMatchObject({
      signal_version: 1,
      source: 'maestro-runtime',
      kind: 'digest_mismatch',
      state: 'alarm',
      severity_hint: 'P2',
      application: 'app1',
      environment: 'prod',
      fingerprint: `app1#prod#${rogue}`,
      delivery_id: event.id,
    });

    // A build record announced afterwards teaches the ledger, and corrects nothing on the instance.
    await take(busEvent('maestro.build', { application: 'app1', digest: rogue, commit: 'fff9' }));
    expect((await call(OWNER, 'GET', '/instances/app1/prod')).body.instance.state).toBe('mismatched');
    expect((await call(OWNER, 'GET', `/artifacts/app1/${rogue}`)).body.artifact).toMatchObject({
      built: true,
      revision: 2,
    });

    // Only the next deploy of a built digest clears the mark; the mismatch stays on the record.
    const cleared = await take(
      busEvent('maestro.deploy', { application: 'app1', environment: 'prod', digest: good, commit: 'aaa1' }),
    );
    expect(cleared.body).toMatchObject({ events: ['ArtifactDeployed'], mismatch: false });
    const after = (await call(OWNER, 'GET', '/instances/app1/prod')).body;
    expect(after.instance).toMatchObject({ digest: good, state: 'running', rollback_target: rogue });
    expect(after.deploys.map((d: { mismatch: boolean }) => d.mismatch)).toEqual([false, true, false]);
    expect(h.signals.sent).toHaveLength(1);
  });

  it('marks a first deploy with no build record, with no rollback target to offer', async () => {
    const rogue = digestOf('f1r5');
    await take(
      busEvent('maestro.deploy', { application: 'app1', environment: 'staging', digest: rogue, commit: 'x' }),
    );
    const view = (await call(OWNER, 'GET', '/instances/app1/staging')).body;
    expect(view.instance).toMatchObject({ state: 'mismatched', revision: 2 });
    expect(view.instance.rollback_target).toBeUndefined();
  });
});
