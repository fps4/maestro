/**
 * The M1 gate (ADR-0020): a workspace's items are dropped and rebuilt from the archive and the
 * payloads alone, and every read returns identically.
 *
 * The loop is driven over HTTP the way people and agents drive it — an agent proposes under a
 * sponsor's accountability, verdicts are recorded, questions are asked, answered and closed, a
 * decision accepts with reasoning, a second version supersedes the first, a specification pins
 * to it, a version is withdrawn with a reason, a decision is refused and recorded, another asks
 * for changes and reopens a draft. Then the relay drains, the sealer seals, every record kind of
 * item is snapshotted — keys and index attributes included — the workspace's prefix is dropped,
 * the rebuilder runs, memberships are re-granted (they are grants, not record — §5), and the
 * snapshots are compared: equal.
 */

import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsArchive, canonicalize, sealBefore } from '@fps4/maestro-spine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectionBehind, Store } from '../../src/db/client.js';
import { PROJECTION_VERSION } from '../../src/db/handle.js';
import { RECORD_KINDS } from '../../src/db/keys.js';
import { spineWorkspaceId } from '../../src/domain/ids.js';
import { RebuildRefused, RebuildService } from '../../src/services/rebuild.js';
import { call, grantMembership, startHarness, token, type Harness } from './helpers.js';

let harness: Harness;
let sponsor: string;
let author: string;

const AUTHOR = token('p-visser', 'human', 'author');
const SPONSOR = token('j-dekker', 'human', 'author,reviewer');
const AGENT = token('agt-drafter', 'agent', 'author');

const classification = { lawful_basis: 'legitimate_interest', retention: '7y', personal_data: true };
const caseFacets = {
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
const specFacets = {
  class: 'generative',
  acceptance_criteria: [
    { id: 'AC-1', text: 'De staat is per project te genereren', priority: 'must', verify: 'test' },
  ],
  personal_data_in_scope: true,
  consequence_class: 'c3',
};
const provenanceOf = (fields: object, source: 'declared' | 'extracted', by: string) =>
  Object.fromEntries(Object.keys(fields).map((f) => [f, { source, by, at: '2026-08-01T00:00:00Z' }]));

/** Every record kind of item, whole, less the one timestamp a rebuild sets anew. */
const RECORD = RECORD_KINDS;

async function grants() {
  author = await grantMembership(harness, harness.tenant, 'p-visser', ['author']);
  sponsor = await grantMembership(harness, harness.tenant, 'j-dekker', ['author', 'sponsor', 'owner']);
  await grantMembership(harness, harness.tenant, 'agt-drafter', ['author'], sponsor);
}

beforeAll(async () => {
  harness = await startHarness('rebuild');
  await grants();
}, 60_000);

afterAll(async () => {
  await harness?.stop();
});

const base = () => `/v1/workspaces/${harness.tenant}`;

type Proposed = { version: { artifact: string; ordinal: number; digest: string } };

async function createDraft(as: string, body: object) {
  const created = await call<{ draft: { id: string; revision: number } }>(
    harness,
    'POST',
    `${base()}/drafts`,
    {
      as,
      body,
    },
  );
  expect(created.status).toBe(201);
  return created.body.draft;
}

async function propose(as: string, draftId: string) {
  const proposed = await call<Proposed>(harness, 'POST', `${base()}/drafts/${draftId}/propose`, { as });
  expect(proposed.status).toBe(201);
  return proposed.body.version;
}

async function decide(
  as: string,
  gate: string,
  v: Proposed['version'],
  outcome: string,
  reasoning?: string,
  seat = 'sponsor',
) {
  return call<{ decision: { id: string } }>(harness, 'POST', `${base()}/gates/${gate}/decisions`, {
    as,
    body: {
      artifact: v.artifact,
      ordinal: v.ordinal,
      outcome,
      ...(reasoning ? { reasoning } : {}),
      attribution: { accountable: sponsor, acting: sponsor, seat, oversight_level: 'O2' },
    },
  });
}

async function recordVerdict(as: string, evaluator: string, v: Proposed['version']) {
  const recorded = await call(harness, 'POST', `${base()}/evaluations`, {
    as,
    body: { evaluator, artifact: v.artifact, ordinal: v.ordinal, verdict: 'pass', subject_digest: v.digest },
  });
  expect(recorded.status).toBe(201);
}

async function snapshot(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = Object.fromEntries(RECORD.map((k) => [k, []]));
  for await (const item of harness.app.store.dump(harness.tenant)) {
    const { kind, ...rest } = item as Record<string, unknown>;
    if (!out[kind as string]) continue;
    if (kind === 'outbox') delete rest.delivered_at;
    out[kind as string]!.push(rest);
  }
  for (const kind of RECORD) out[kind]!.sort((a, b) => (canonicalize(a) < canonicalize(b) ? -1 : 1));
  return out;
}

async function reads(refs: {
  spec: Proposed['version'];
  bc: Proposed['version'];
  withdrawn: Proposed['version'];
}) {
  const get = async (url: string) => {
    const response = await call(harness, 'GET', url, { as: SPONSOR });
    expect(response.status).toBe(200);
    return response.body;
  };
  return {
    version: await get(`${base()}/artifacts/${refs.spec.artifact}/versions/${refs.spec.ordinal}`),
    withdrawn: await get(`${base()}/artifacts/${refs.withdrawn.artifact}/versions/${refs.withdrawn.ordinal}`),
    artifact: await get(`${base()}/artifacts/${refs.bc.artifact}`),
    packet: await get(`${base()}/gates/specification_gate/${refs.spec.artifact}/${refs.spec.ordinal}/packet`),
    questions: await get(`${base()}/artifacts/${refs.bc.artifact}/versions/${refs.bc.ordinal}/questions`),
    lineage: await get(`${base()}/artifacts/${refs.spec.artifact}/lineage`),
    register: await get(`${base()}/register`),
  };
}

describe('the rebuild gate', () => {
  it('drops a workspace and rebuilds it from the archive and the payloads; every read returns identically', async () => {
    // --- the loop ---

    // An agent shapes a business case; a person confirms what it extracted; the agent proposes.
    const shaped = await createDraft(AGENT, {
      type: 'business_case',
      title: 'Materiaalstaat-generator',
      facets: caseFacets,
      provenance: provenanceOf(caseFacets, 'extracted', 'agent'),
      body: { format: 'markdown/v1', content: '## Scope\n\nDe generator stelt de materiaalstaat samen.' },
      classification,
    });
    const confirmed = await call(harness, 'POST', `${base()}/drafts/${shaped.id}/confirm`, {
      as: AUTHOR,
      body: { fields: Object.keys(caseFacets) },
    });
    expect(confirmed.status).toBe(200);
    const bc1 = await propose(AGENT, shaped.id);

    // A question, an agent's answer, a human closing it.
    const asked = await call<{ question: { id: string } }>(
      harness,
      'POST',
      `${base()}/artifacts/${bc1.artifact}/versions/${bc1.ordinal}/questions`,
      { as: SPONSOR, body: { text: 'Which unit is the target expressed in?' } },
    );
    expect(asked.status).toBe(201);
    const questionUrl = `${base()}/artifacts/${bc1.artifact}/versions/${bc1.ordinal}/questions/${asked.body.question.id}`;
    expect(
      (
        await call(harness, 'POST', `${questionUrl}/answers`, {
          as: AGENT,
          body: { text: 'Days, per `declared_outcome.unit`.' },
        })
      ).status,
    ).toBe(201);
    expect((await call(harness, 'POST', `${questionUrl}/resolve`, { as: SPONSOR })).status).toBe(200);

    // A person records the sufficiency verdict again, without findings: a re-run is a second event.
    await recordVerdict(SPONSOR, 'sufficiency', bc1);

    // The sponsor accepts, with reasoning.
    const accepted = await decide(
      SPONSOR,
      'explore',
      bc1,
      'approve',
      'Baseline is measured over six projects.',
    );
    expect(accepted.status).toBe(201);

    // A second version supersedes the first.
    const revised = await createDraft(AUTHOR, {
      type: 'business_case',
      title: 'Materiaalstaat-generator, revised',
      artifact: bc1.artifact,
      facets: { ...caseFacets, declared_outcome: { ...caseFacets.declared_outcome, target: 6 } },
      provenance: provenanceOf(caseFacets, 'declared', 'x'),
      classification,
    });
    const bc2 = await propose(AUTHOR, revised.id);
    expect((await decide(SPONSOR, 'explore', bc2, 'approve')).status).toBe(201);

    // A specification pinned to the case; the pin freezes at @2.
    const specDraft = await createDraft(AUTHOR, {
      type: 'specification',
      title: 'Pinned specification',
      facets: specFacets,
      provenance: provenanceOf(specFacets, 'declared', 'x'),
      body: {
        format: 'markdown/v1',
        content: '## Scope\n\nWhen a project is selected, generate the materiaalstaat.',
      },
      classification,
      links: [{ type: 'justified_by', target: bc1.artifact }],
    });
    const spec1 = await propose(AUTHOR, specDraft.id);
    await recordVerdict(SPONSOR, 'conformance', spec1);
    expect((await decide(SPONSOR, 'specification_gate', spec1, 'approve', undefined, 'owner')).status).toBe(
      201,
    );

    // A third version: someone who may not decide tries to (refused, recorded), then it is withdrawn.
    const third = await createDraft(AUTHOR, {
      type: 'business_case',
      title: 'Materiaalstaat-generator, third',
      artifact: bc1.artifact,
      facets: caseFacets,
      provenance: provenanceOf(caseFacets, 'declared', 'x'),
      classification,
    });
    const bc3 = await propose(AUTHOR, third.id);
    const refused = await call(harness, 'POST', `${base()}/gates/explore/decisions`, {
      as: AUTHOR,
      body: {
        artifact: bc3.artifact,
        ordinal: bc3.ordinal,
        outcome: 'approve',
        attribution: { accountable: author, acting: author, seat: 'sponsor', oversight_level: 'O2' },
      },
    });
    expect(refused.status).toBe(422);
    const withdrawn = await call(
      harness,
      'POST',
      `${base()}/artifacts/${bc3.artifact}/versions/${bc3.ordinal}/withdraw`,
      { as: AUTHOR, body: { reason: 'Proposed against the wrong baseline.' } },
    );
    expect(withdrawn.status).toBe(200);

    // Another case, sent back for changes: the decision reopens a draft.
    const otherDraft = await createDraft(AUTHOR, {
      type: 'business_case',
      title: 'Needs work',
      facets: caseFacets,
      provenance: provenanceOf(caseFacets, 'declared', 'x'),
      classification,
    });
    const other1 = await propose(AUTHOR, otherDraft.id);
    expect(
      (await decide(SPONSOR, 'explore', other1, 'request_changes', 'The beneficiary count is a guess.'))
        .status,
    ).toBe(201);

    // --- relay, seal, verify ---
    const relay = harness.app.relay!;
    const report = await relay.drain();
    expect(report.refused).toEqual([]);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await sealBefore(relay.archive, tomorrow);

    // --- snapshot ---
    const before = await snapshot();
    const readsBefore = await reads({ spec: spec1, bc: bc1, withdrawn: bc3 });
    const types = new Set((before.outbox as Array<{ type: string }>).map((e) => e.type));
    for (const t of [
      'VersionProposed',
      'EvaluationRecorded',
      'QuestionRaised',
      'QuestionAnswered',
      'QuestionResolved',
      'DecisionRecorded',
      'VersionSuperseded',
      'LinkPinned',
      'DecisionRefused',
      'VersionWithdrawn',
    ]) {
      expect(types, `the loop emitted ${t}`).toContain(t);
    }
    expect(before.draft).toHaveLength(1); // the reopened one
    expect((before.outbox as Array<{ delivered: boolean }>).every((e) => e.delivered)).toBe(true);
    // Delivered means off the pending index: the sparse attributes are gone, not merely false.
    expect(
      (before.outbox as Array<Record<string, unknown>>).every(
        (e) => !('pending_pk' in e) && !('pending_sk' in e),
      ),
    ).toBe(true);

    // --- a populated target is refused without --force ---
    const rebuilder = new RebuildService(harness.app.store);
    await expect(
      rebuilder.rebuild({
        workspace: harness.tenant,
        archive: relay.archive,
        payloads: harness.app.payloads,
      }),
    ).rejects.toThrow(/is not empty/);

    // --- drop, rebuild, re-grant ---
    await harness.app.store.dropWorkspace(harness.tenant);
    const result = await rebuilder.rebuild({
      workspace: harness.tenant,
      archive: relay.archive,
      payloads: harness.app.payloads,
    });
    expect(result).toMatchObject({
      workspace: harness.tenant,
      events: before.outbox!.length,
      artifacts: 3,
      versions: 5,
      decisions: 4,
      questions: 1,
      drafts_reopened: 1,
    });
    await grants();

    // --- equal ---
    const after = await snapshot();
    for (const name of RECORD) expect(after[name], name).toEqual(before[name]);
    expect(await reads({ spec: spec1, bc: bc1, withdrawn: bc3 })).toEqual(readsBefore);

    const handle = await harness.app.store.handle(harness.tenant);
    expect(await handle.meta.get()).toEqual({ projection_version: PROJECTION_VERSION });

    // --- and a populated target is refused again, now that the rebuild populated it ---
    await expect(
      rebuilder.rebuild({
        workspace: harness.tenant,
        archive: relay.archive,
        payloads: harness.app.payloads,
      }),
    ).rejects.toBeInstanceOf(RebuildRefused);
  }, 120_000);

  it('refuses a tampered archive, naming the period and the sequence', async () => {
    const original = harness.config.RECORD_ARCHIVE_DIR;
    const copy = mkdtempSync(join(tmpdir(), 'specs-archive-tampered-'));
    cpSync(original, copy, { recursive: true });

    // Flip one byte in the first part of the first day.
    const ws = spineWorkspaceId(harness.tenant);
    const day = readdirSync(join(copy, ws)).find((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))!;
    const part = readdirSync(join(copy, ws, day)).find((n) => n.startsWith('events-'))!;
    const path = join(copy, ws, day, part);
    const text = readFileSync(path, 'utf8');
    expect(statSync(path).size).toBeGreaterThan(0);
    writeFileSync(path, text.replace('"type":"VersionProposed"', '"type":"VersionPropose0"'));

    await expect(
      new RebuildService(harness.app.store).rebuild({
        workspace: harness.tenant,
        archive: new FsArchive(copy),
        payloads: harness.app.payloads,
        force: true,
      }),
    ).rejects.toThrow(new RegExp(`does not verify at ${day}, seq \\d+`));
  });

  it('refuses to serve a workspace whose projection is behind, until it is rebuilt', async () => {
    const handle = await harness.app.store.handle(harness.tenant);
    await handle.meta.put({ projection_version: 0 });
    // A fresh Store, as a restarted service would open one.
    const store = await Store.connect(harness.config);
    try {
      await expect(store.handle(harness.tenant)).rejects.toBeInstanceOf(ProjectionBehind);
    } finally {
      await store.close();
      await handle.meta.put({ projection_version: PROJECTION_VERSION });
    }
  });
});
