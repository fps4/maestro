/**
 * The record sink end to end (ADR-0019): what the service emits is the spine's envelope, the
 * relay carries it unchanged into the archive, and the spine's verifier — with the service off —
 * passes on what was sealed. This is maestro's acceptance scenario R1 from this side of the seam.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sealBefore, sha256, verifyRange, parseEventLine, type SpineEvent } from '@fps4/maestro-spine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spineWorkspaceId } from '../../src/domain/ids.js';
import { readPayload } from '../../src/record/payload-store.js';
import type { VersionPayload } from '../../src/services/artifacts.js';
import { call, grantMembership, startHarness, token, type Harness } from './helpers.js';

let harness: Harness;
let sponsor: string;

const AUTHOR = token('p-visser', 'human', 'author');
const SPONSOR = token('j-dekker', 'human', 'author,reviewer');
const AGENT = token('agt-drafter', 'agent', 'author');
const STRAY = token('agt-stray', 'agent', 'author');

const classification = { lawful_basis: 'legitimate_interest', retention: '7y', personal_data: true };
const declared = (fields: object) =>
  Object.fromEntries(
    Object.keys(fields).map((f) => [f, { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' }]),
  );
const facets = {
  declared_outcome: {
    statement: 'Materiaalstaat sneller samenstellen',
    baseline: 14.2,
    target: 8,
    unit: 'days',
    baseline_source: 'measured',
  },
  beneficiary: { role: 'werkvoorbereider', count_estimate: 6 },
  personal_data_in_scope: true,
  consequence_class: 'c3',
  decider: 'usr-j-dekker',
};

beforeAll(async () => {
  harness = await startHarness('record');
  await grantMembership(harness, harness.tenant, 'p-visser', ['author']);
  sponsor = await grantMembership(harness, harness.tenant, 'j-dekker', ['author', 'sponsor', 'owner']);
  await grantMembership(harness, harness.tenant, 'agt-drafter', ['author'], sponsor);
  await grantMembership(harness, harness.tenant, 'agt-stray', ['author']); // no answerable human
}, 60_000);

afterAll(async () => {
  await harness?.stop();
});

const base = () => `/v1/workspaces/${harness.tenant}`;

async function propose(as: string, title: string) {
  const created = await call<{ draft: { id: string } }>(harness, 'POST', `${base()}/drafts`, {
    as,
    body: { type: 'business_case', title, facets, provenance: declared(facets), classification },
  });
  expect(created.status).toBe(201);
  const proposed = await call<{ version: { artifact: string; ordinal: number; digest: string } }>(
    harness,
    'POST',
    `${base()}/drafts/${created.body.draft.id}/propose`,
    { as },
  );
  return proposed;
}

async function outbox(): Promise<SpineEvent[]> {
  const handle = await harness.app.store.handle(harness.tenant);
  return handle.outbox.list();
}

describe('the record', () => {
  it('an agent’s proposal is answerable to the human its membership names, at the seat’s level', async () => {
    const proposed = await propose(AGENT, 'By an agent');
    expect(proposed.status).toBe(201);
    const events = await outbox();
    const event = events.find(
      (e) => e.type === 'VersionProposed' && e.subject_id.startsWith(proposed.body.version.artifact),
    )!;
    expect(event.acting).toMatch(/^prn-a-/);
    expect(event.accountable).toBe(sponsor);
    expect(event.seat).toBe('author');
    expect(event.oversight_level).toBe('O1');
    expect(event.consequence_class).toBe('c2');
    expect(event.workspace_id).toBe(spineWorkspaceId(harness.tenant));
    expect(event.subject_type).toBe('version');
    expect(event.subject_id).toBe(`${proposed.body.version.artifact}@${proposed.body.version.ordinal}`);
    expect(event.subject_seq).toBe(1);
    expect(event.body).toMatchObject({ type: 'business_case', digest: proposed.body.version.digest });
  });

  it('a proposal names its payload — the version under a file:/// ref whose bytes hash to the digest (ADR-0020)', async () => {
    const proposed = await propose(AUTHOR, 'With a payload');
    expect(proposed.status).toBe(201);
    const events = await outbox();
    const event = events.find(
      (e) => e.type === 'VersionProposed' && e.subject_id.startsWith(proposed.body.version.artifact),
    )!;
    expect(event.payload_ref).toMatch(
      new RegExp(
        `^file:///.+/${spineWorkspaceId(harness.tenant)}/version/${event.subject_id}/version\\.json$`,
      ),
    );
    expect(event.payload_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    // The payload holds more than the subject, so its digest is not the subject digest.
    expect(event.payload_digest).not.toBe(proposed.body.version.digest);

    const bytes = await readFile(fileURLToPath(event.payload_ref!));
    expect(sha256(bytes)).toBe(event.payload_digest);
    const payload = await readPayload<VersionPayload>(harness.app.payloads, {
      ref: event.payload_ref!,
      digest: event.payload_digest!,
    });
    expect(payload.title).toBe('With a payload');
    expect(payload.digest).toBe(proposed.body.version.digest);
    expect(payload).not.toHaveProperty('state');
    expect(payload).not.toHaveProperty('workspace');

    // The builtin verdict recorded at propose is an event too, with its findings as the payload.
    const evaluated = events.find(
      (e) => e.type === 'EvaluationRecorded' && e.subject_id === event.subject_id,
    )!;
    expect(evaluated.body).toMatchObject({ evaluator: 'sufficiency', verdict: 'pass', findings: 5 });
    expect(evaluated.seat).toBe('author');
    expect(evaluated.payload_ref).toMatch(/\/evaluation\/sufficiency\/[0-9a-f]{64}\.json$/);
    const findings = await readPayload<{ findings: unknown[] }>(harness.app.payloads, {
      ref: evaluated.payload_ref!,
      digest: evaluated.payload_digest!,
    });
    expect(findings.findings).toHaveLength(5);
  });

  it('an agent with no answerable human cannot propose, and the refusal names why', async () => {
    const refused = await propose(STRAY, 'Stray');
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toMatch(/no answerable human/);
  });

  it('a decision and its consequences share a correlation and chain by causation', async () => {
    const proposed = await propose(AUTHOR, 'Decided');
    const decided = await call(harness, 'POST', `${base()}/gates/explore/decisions`, {
      as: SPONSOR,
      body: {
        artifact: proposed.body.version.artifact,
        ordinal: proposed.body.version.ordinal,
        outcome: 'approve',
        attribution: { accountable: sponsor, acting: sponsor, seat: 'sponsor', oversight_level: 'O2' },
      },
    });
    expect(decided.status).toBe(201);
    const events = await outbox();
    const decision = events.find(
      (e) =>
        e.type === 'DecisionRecorded' &&
        e.subject_id === `${proposed.body.version.artifact}@${proposed.body.version.ordinal}`,
    )!;
    expect(decision.seat).toBe('decider');
    expect(decision.accountable).toBe(sponsor);
    expect(decision.oversight_level).toBe('O2');
    expect(decision.causation_id).toBeNull();
    expect(decision.body).toMatchObject({
      gate: 'explore',
      outcome: 'approve',
      subject_digest: proposed.body.version.digest,
    });
    // Its proposal was event 1 of that subject, the builtin verdict event 2; the decision is 3.
    expect(decision.subject_seq).toBe(3);
    // The reasoning and the evaluations snapshot are the decision's payload (ADR-0020 §2).
    expect(decision.payload_ref).toMatch(/\/decision\/dec-[a-z0-9]+\.json$/);
    const followers = events.filter((e) => e.causation_id === decision.event_id);
    for (const f of followers) expect(f.correlation_id).toBe(decision.correlation_id);
  });

  it('the relay carries the envelope into the archive unchanged, and the verifier passes with the service off', async () => {
    const relay = harness.app.relay!;
    const report = await relay.drain();
    expect(report.refused).toEqual([]);
    expect(report.acked).toBeGreaterThan(0);

    const pending = (await outbox()).filter(
      (e) => (e as SpineEvent & { delivered: boolean }).delivered === false,
    );
    expect(pending).toEqual([]);

    const ws = spineWorkspaceId(harness.tenant);
    const days = await relay.archive.listDays(ws);
    expect(days.length).toBe(1);
    const parts = await relay.archive.listParts(ws, days[0]!);
    const lines = (await Promise.all(parts.map((p) => relay.archive.readPart(ws, days[0]!, p)))).flat();
    const archived = lines.map(parseEventLine);
    const emitted = await outbox();
    expect(archived.map((e) => e.seq)).toEqual(emitted.map((e) => e.seq));
    expect(archived[0]).toEqual(
      Object.fromEntries(
        Object.entries(emitted[0]!).filter(
          ([k]) => !['workspace', 'delivered', 'delivered_at', 'attempts'].includes(k),
        ),
      ),
    );

    // Seal as the sealer would, then verify as an auditor would: the pure verifier over the store.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const sealed = await sealBefore(relay.archive, tomorrow);
    expect(sealed.map((m) => m.workspace_id)).toContain(ws);
    const verdict = await verifyRange(relay.archive, ws);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.last_seq).toBe(emitted.length);
  });

  it('a second drain changes nothing', async () => {
    const again = await harness.app.relay!.drain();
    expect(again).toEqual({ archived: 0, published: 0, acked: 0, refused: [] });
  });
});
