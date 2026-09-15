/**
 * The git-native path, end to end: a markdown file with front-matter becomes a proposed version, a
 * second push withdraws the first proposal and proposes again, a human decides from the command
 * line — and an agent's token marks its facets as extracted.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { facetsFrom, main, splitFrontMatter } from '../../src/cli/specs.js';
import { call, grantMembership, startHarness, token, type Harness } from './helpers.js';

let harness: Harness;
let dir: string;
let sponsor: string;
let baseUrl: string;
let acceptedCase: string;

const AUTHOR = token('p-visser', 'human', 'author');
const SPONSOR = token('j-dekker', 'human', 'author,reviewer');
const AGENT = token('agt-writer', 'agent', 'author');

const CASE = `---
type: business_case
title: Faster materiaalstaat
classification: { lawful_basis: legitimate_interest, retention: 7y, personal_data: true }
declared_outcome: { statement: Materiaalstaat sneller samenstellen, baseline: 14.2, target: 8, unit: days, baseline_source: measured }
beneficiary: { role: werkvoorbereider, count_estimate: 6 }
personal_data_in_scope: true
consequence_class: c3
decider: usr-j-dekker
---
## Why

Six projects of planning history say fourteen days.
`;

/** `SPEC` is a template; the test fills in the case it rests on once one is accepted. */
const specResting = (on: string) => `---
type: specification
title: Materiaalstaat generator
classification: { lawful_basis: contract, retention: 7y, personal_data: false }
links: [{ type: justified_by, target: ${on} }]
facets:
  class: generative
  acceptance_criteria:
    - { id: AC-1, text: "When a project is selected, the system shall generate the staat", priority: must, verify: test }
  personal_data_in_scope: false
  consequence_class: c2
---
## Scope

When a project is selected, the system shall generate the materiaalstaat.
`;
let SPEC = '';

/** Run the CLI in-process with captured stdout, as a given principal. */
async function specs(as: string, ...argv: string[]): Promise<{ out: string; err?: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.env.SPECS_TOKEN = as;
  process.env.SPECS_URL = baseUrl;
  try {
    await main([...argv, '--workspace', harness.tenant]);
    return { out: chunks.join('') };
  } catch (error) {
    return { out: chunks.join(''), err: (error as Error).message };
  } finally {
    process.stdout.write = original;
  }
}

const lastJson = (out: string) =>
  JSON.parse(out.trim().split('\n').at(-1)!) as { artifact: string; ordinal: number };

beforeAll(async () => {
  harness = await startHarness('cli');
  await grantMembership(harness, harness.tenant, 'p-visser', ['author']);
  sponsor = await grantMembership(harness, harness.tenant, 'j-dekker', ['author', 'sponsor', 'owner']);
  await grantMembership(harness, harness.tenant, 'agt-writer', ['author']);
  // The CLI speaks HTTP, so the harness has to actually listen.
  await harness.server.listen({ port: 0, host: '127.0.0.1' });
  const address = harness.server.server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
  dir = await mkdtemp(join(tmpdir(), 'specs-cli-'));

  // The whole git-native loop, once, to produce the business case every specification rests on:
  // propose the file, decide from the command line.
  const caseFile = join(dir, 'case.md');
  await writeFile(caseFile, CASE);
  const proposed = await specs(AUTHOR, 'propose', caseFile);
  expect(proposed.err).toBeUndefined();
  acceptedCase = lastJson(proposed.out).artifact;
  const decided = await specs(
    SPONSOR,
    'decide',
    'explore',
    `${acceptedCase}@1`,
    '--outcome',
    'approve',
    '--reasoning',
    'Measured baseline.',
    '--attr',
    'seat=sponsor',
    '--attr',
    'oversight_level=O2',
  );
  expect(decided.err).toBeUndefined();
  SPEC = specResting(acceptedCase);
}, 60_000);

afterAll(async () => {
  await harness?.stop();
});

describe('front-matter', () => {
  it('splits meta from body and treats every unreserved key as a facet', () => {
    const { meta, body } = splitFrontMatter(SPEC);
    expect(meta.type).toBe('specification');
    expect(body.trim()).toMatch(/^## Scope/);
    expect(Object.keys(facetsFrom(meta)).sort()).toEqual([
      'acceptance_criteria',
      'class',
      'consequence_class',
      'personal_data_in_scope',
    ]);
    expect(facetsFrom({ title: 'x', consequence_class: 'c1', facets: { class: 'generative' } })).toEqual({
      consequence_class: 'c1',
      class: 'generative',
    });
    expect(splitFrontMatter('no front matter\n')).toEqual({ meta: {}, body: 'no front matter\n' });
  });
});

describe('specs propose / withdraw / decide', () => {
  it('proposes a file, re-proposes it withdrawing the earlier proposal, and lets a human decide', async () => {
    const file = join(dir, 'spec.md');
    await writeFile(file, SPEC);

    const first = await specs(AUTHOR, 'propose', file);
    expect(first.err).toBeUndefined();
    expect(first.out).toMatch(/^proposed art-[a-z0-9]+@1 \(sha256:/);
    expect(first.out).toMatch(/conformance: unavailable — endpoint names `EVALUATOR_BASE`/);
    const v1 = lastJson(first.out);

    // A second push: same lineage, changed text. The first proposal is withdrawn, not left hanging.
    await writeFile(
      file,
      SPEC.replace(
        'title: Materiaalstaat generator',
        `title: Materiaalstaat generator\nartifact: ${v1.artifact}`,
      ).replace('generate the materiaalstaat.', 'generate the materiaalstaat per contract.'),
    );
    const second = await specs(AUTHOR, 'propose', file);
    expect(second.err).toBeUndefined();
    const v2 = lastJson(second.out);
    expect(v2.artifact).toBe(v1.artifact);
    expect(v2.ordinal).toBe(2);

    const read = await call<{ versions: Array<{ ordinal: number; state: string }> }>(
      harness,
      'GET',
      `/v1/workspaces/${harness.tenant}/artifacts/${v1.artifact}`,
      { as: AUTHOR },
    );
    expect(read.body.versions.map((v) => [v.ordinal, v.state])).toEqual([
      [2, 'proposed'],
      [1, 'withdrawn'],
    ]);

    // The packet reads as text, for a person at a terminal or a PR comment.
    const packet = await specs(SPONSOR, 'packet', 'specification_gate', `${v2.artifact}@2`);
    expect(packet.out).toMatch(/^# Specification: Materiaalstaat generator/);
    expect(packet.out).toMatch(/You are being asked: Is this exactly what should be built/);
    expect(packet.out).toMatch(/\*\*Approve for build\*\*/);
    expect(packet.out).toMatch(/The gate is not open yet\./);

    // Record the conformance verdict the endpoint could not, then decide from the command line.
    const version = await call<{ version: { digest: string } }>(
      harness,
      'GET',
      `/v1/workspaces/${harness.tenant}/artifacts/${v2.artifact}/versions/2`,
      { as: SPONSOR },
    );
    await call(harness, 'POST', `/v1/workspaces/${harness.tenant}/evaluations`, {
      as: SPONSOR,
      body: {
        evaluator: 'conformance',
        artifact: v2.artifact,
        ordinal: 2,
        verdict: 'pass',
        subject_digest: version.body.version.digest,
      },
    });
    const decided = await specs(
      SPONSOR,
      'decide',
      'specification_gate',
      `${v2.artifact}@2`,
      '--outcome',
      'approve',
      '--reasoning',
      'Reviewed in the pull request.',
      '--attr',
      'seat=owner',
      '--attr',
      'oversight_level=O2',
    );
    expect(decided.err).toBeUndefined();
    expect(decided.out).toMatch(/^decided .*@2: approve \(dec-/);

    const after = await call<{
      artifact: { accepted_ordinal: number };
      decisions: Array<{ attribution: Record<string, string> }>;
    }>(harness, 'GET', `/v1/workspaces/${harness.tenant}/artifacts/${v2.artifact}`, { as: SPONSOR });
    expect(after.body.artifact.accepted_ordinal).toBe(2);
    expect(after.body.decisions[0]!.attribution.accountable).toBe(sponsor);
  });

  it('refuses a file that is not proposable, naming what is missing, and leaves no draft behind', async () => {
    const file = join(dir, 'half.md');
    await writeFile(file, '---\ntype: business_case\ntitle: Half\nconsequence_class: c2\n---\nA line.\n');
    const result = await specs(AUTHOR, 'propose', file);
    expect(result.err).toMatch(/cannot be proposed yet/);
    expect(result.err).toMatch(/Declared outcome/);
    expect(result.err).toMatch(/Data classification/);
    const drafts = await call<{ drafts: Array<{ title: string }> }>(
      harness,
      'GET',
      `/v1/workspaces/${harness.tenant}/drafts`,
      {
        as: AUTHOR,
      },
    );
    expect(drafts.body.drafts.some((d) => d.title === 'Half')).toBe(false);
  });

  it('marks facets as extracted when the token is an agent’s, so the gate asks for confirmation', async () => {
    const file = join(dir, 'agent.md');
    await writeFile(file, SPEC.replace('Materiaalstaat generator', 'Written by an agent'));
    const result = await specs(AGENT, 'propose', file);
    expect(result.err).toBeUndefined();
    expect(result.out).toMatch(/the gate will still ask for:/);
    const { artifact } = lastJson(result.out);
    const version = await call<{ version: { provenance: Record<string, { source: string }> } }>(
      harness,
      'GET',
      `/v1/workspaces/${harness.tenant}/artifacts/${artifact}/versions/1`,
      { as: AUTHOR },
    );
    expect(new Set(Object.values(version.body.version.provenance).map((p) => p.source))).toEqual(
      new Set(['extracted']),
    );
  });

  it('refuses a withdraw from anyone but the proposer', async () => {
    const file = join(dir, 'mine.md');
    await writeFile(file, SPEC.replace('Materiaalstaat generator', 'Mine to withdraw'));
    const { artifact } = lastJson((await specs(AUTHOR, 'propose', file)).out);
    const refused = await specs(SPONSOR, 'withdraw', `${artifact}@1`);
    expect(refused.err).toMatch(/Only the proposer withdraws/);
    const ok = await specs(AUTHOR, 'withdraw', `${artifact}@1`, '--reason', 'changed my mind');
    expect(ok.err).toBeUndefined();
  });
});
