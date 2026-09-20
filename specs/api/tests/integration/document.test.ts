/**
 * One document (ADR-0017): a draft saved as a single markdown text, its facets derived from the
 * front-matter and from the type's declared blocks, provenance following the saver, a human's
 * confirmation surviving an unchanged facet — and the whole thing proposable and gate-readable
 * with no second form anywhere.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/auth/context.js';
import { createVerifier } from '../../src/auth/verify.js';
import { callTool } from '../../src/mcp/handler.js';
import { PrincipalDirectory } from '../../src/services/principals.js';
import { WorkspaceRegistry } from '../../src/services/workspaces.js';
import { call, grantMembership, startHarness, token, type Harness } from './helpers.js';

let harness: Harness;
let sponsor: string;
let acceptedCase: string;

const AUTHOR = token('p-visser', 'human', 'author');
const SPONSOR = token('j-dekker', 'human', 'author,reviewer');
const AGENT = token('agt-writer', 'agent', 'author');

const classification = { lawful_basis: 'legitimate_interest', retention: '7y', personal_data: true };
const declared = (fields: object) =>
  Object.fromEntries(
    Object.keys(fields).map((f) => [f, { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' }]),
  );

const specDocument = (on: string) => `---
title: Materiaalstaat generator
classification: { lawful_basis: contract, retention: 7y, personal_data: false }
links: [{ type: justified_by, target: ${on} }]
class: generative
personal_data_in_scope: false
consequence_class: c2
---
## Scope

When a project is selected, the system shall generate the materiaalstaat.

## Acceptance criteria

| id   | text                                                            | priority | verify |
|------|-----------------------------------------------------------------|----------|--------|
| AC-1 | When a project is selected, the system shall generate the staat | must     | test   |
| AC-2 | The staat shall list every item with a quantity                 | should   | inspection |
`;

beforeAll(async () => {
  harness = await startHarness('document');
  await grantMembership(harness, harness.tenant, 'p-visser', ['author']);
  sponsor = await grantMembership(harness, harness.tenant, 'j-dekker', ['author', 'sponsor', 'owner']);
  await grantMembership(harness, harness.tenant, 'agt-writer', ['author'], sponsor);

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
  const created = await call<{ draft: { id: string } }>(harness, 'POST', `${base()}/drafts`, {
    as: AUTHOR,
    body: { type: 'business_case', title: 'The case', facets, provenance: declared(facets), classification },
  });
  const { version } = (
    await call<{ version: { artifact: string; ordinal: number } }>(
      harness,
      'POST',
      `${base()}/drafts/${created.body.draft.id}/propose`,
      { as: AUTHOR },
    )
  ).body;
  await call(harness, 'POST', `${base()}/gates/explore/decisions`, {
    as: SPONSOR,
    body: {
      artifact: version.artifact,
      ordinal: version.ordinal,
      outcome: 'approve',
      attribution: { accountable: sponsor, acting: sponsor, seat: 'sponsor', oversight_level: 'O2' },
    },
  });
  acceptedCase = version.artifact;
}, 60_000);

afterAll(async () => {
  await harness?.stop();
});

const base = () => `/v1/workspaces/${harness.tenant}`;

describe('the document', () => {
  it('is saved as one text; facets come from front-matter and from the declared table; provenance follows the saver', async () => {
    const created = await call<{ draft: { id: string; revision: number } }>(
      harness,
      'POST',
      `${base()}/drafts`,
      {
        as: AUTHOR,
        body: { type: 'specification', title: 'placeholder' },
      },
    );
    const saved = await call<{
      draft: {
        title: string;
        revision: number;
        facets: Record<string, unknown>;
        provenance: Record<string, { source: string; by: string }>;
        links: unknown[];
        body: { content: string };
      };
      document: string;
    }>(harness, 'PUT', `${base()}/drafts/${created.body.draft.id}/document`, {
      as: AUTHOR,
      body: { revision: created.body.draft.revision, document: specDocument(acceptedCase) },
    });
    expect(saved.status).toBe(200);
    const { draft, document } = saved.body;

    expect(draft.title).toBe('Materiaalstaat generator');
    expect(draft.links).toEqual([{ type: 'justified_by', target: acceptedCase }]);
    expect(Object.keys(draft.facets).sort()).toEqual([
      'acceptance_criteria',
      'class',
      'consequence_class',
      'personal_data_in_scope',
    ]);
    expect(draft.facets.acceptance_criteria).toEqual([
      {
        id: 'AC-1',
        text: 'When a project is selected, the system shall generate the staat',
        priority: 'must',
        verify: 'test',
      },
      {
        id: 'AC-2',
        text: 'The staat shall list every item with a quantity',
        priority: 'should',
        verify: 'inspection',
      },
    ]);
    expect(new Set(Object.values(draft.provenance).map((p) => p.source))).toEqual(new Set(['declared']));
    expect(draft.body.content).toMatch(/^## Scope/);

    // The composed document keeps the table in the body and does not repeat it in front-matter.
    expect(document).toMatch(/^---\ntitle: Materiaalstaat generator\n/);
    expect(document).not.toMatch(/acceptance_criteria/);
    expect(document).toMatch(/\| AC-1 \|/);

    // And it proposes: the facets the schema requires are all there, and the gate reads them.
    const proposed = await call<{
      version: { artifact: string; ordinal: number; facets: Record<string, unknown> };
    }>(harness, 'POST', `${base()}/drafts/${created.body.draft.id}/propose`, { as: AUTHOR });
    expect(proposed.status).toBe(201);
    const view = await call<{ view: { requirements: Array<{ id: string; satisfied: boolean }> } }>(
      harness,
      'GET',
      `${base()}/gates/specification_gate/${proposed.body.version.artifact}/${proposed.body.version.ordinal}`,
      { as: SPONSOR },
    );
    expect(view.body.view.requirements.find((r) => r.id === 'confirmed_facets')!.satisfied).toBe(true);
    expect(view.body.view.requirements.find((r) => r.id === 'pinned_link')!.satisfied).toBe(true);

    const versionDoc = await call<{ document: string; digest: string }>(
      harness,
      'GET',
      `${base()}/artifacts/${proposed.body.version.artifact}/versions/${proposed.body.version.ordinal}/document`,
      { as: SPONSOR },
    );
    expect(versionDoc.body.document).toBe(document);
  });

  it('marks an agent’s save as extracted, keeps a human’s confirmation on an unchanged facet, and drops it on a changed one', async () => {
    const created = await call<{ draft: { id: string; revision: number } }>(
      harness,
      'POST',
      `${base()}/drafts`,
      {
        as: AUTHOR,
        body: { type: 'specification', title: 'placeholder' },
      },
    );
    const id = created.body.draft.id;

    // An agent writes the whole document.
    const first = await call<{ draft: { revision: number; provenance: Record<string, { source: string }> } }>(
      harness,
      'PUT',
      `${base()}/drafts/${id}/document`,
      { as: AGENT, body: { revision: created.body.draft.revision, document: specDocument(acceptedCase) } },
    );
    expect(new Set(Object.values(first.body.draft.provenance).map((p) => p.source))).toEqual(
      new Set(['extracted']),
    );

    // A person confirms the consequence class.
    const confirmed = await call<{ draft: { revision: number } }>(
      harness,
      'POST',
      `${base()}/drafts/${id}/confirm`,
      {
        as: SPONSOR,
        body: { fields: ['consequence_class', 'class'] },
      },
    );

    // The agent edits the body text only. The confirmed facets are unchanged and stay confirmed.
    const second = await call<{
      draft: { revision: number; provenance: Record<string, { source: string; confirmed_by?: string }> };
    }>(harness, 'PUT', `${base()}/drafts/${id}/document`, {
      as: AGENT,
      body: {
        revision: confirmed.body.draft.revision,
        document: specDocument(acceptedCase).replace(
          'generate the materiaalstaat.',
          'generate the materiaalstaat per contract.',
        ),
      },
    });
    expect(second.body.draft.provenance.consequence_class!.confirmed_by).toBe(sponsor);
    expect(second.body.draft.provenance.class!.confirmed_by).toBe(sponsor);

    // The agent changes the consequence class. That confirmation is gone; the other survives.
    const third = await call<{
      draft: { provenance: Record<string, { source: string; confirmed_by?: string }> };
    }>(harness, 'PUT', `${base()}/drafts/${id}/document`, {
      as: AGENT,
      body: {
        revision: second.body.draft.revision,
        document: specDocument(acceptedCase).replace('consequence_class: c2', 'consequence_class: c3'),
      },
    });
    expect(third.body.draft.provenance.consequence_class!.confirmed_by).toBeUndefined();
    expect(third.body.draft.provenance.consequence_class!.source).toBe('extracted');
    expect(third.body.draft.provenance.class!.confirmed_by).toBe(sponsor);
  });

  it('refuses a document whose front-matter is not YAML, in words, and changes nothing', async () => {
    const created = await call<{ draft: { id: string; revision: number } }>(
      harness,
      'POST',
      `${base()}/drafts`,
      {
        as: AUTHOR,
        body: { type: 'specification', title: 'Untouched' },
      },
    );
    const refused = await call<{ error: string; message: string }>(
      harness,
      'PUT',
      `${base()}/drafts/${created.body.draft.id}/document`,
      {
        as: AUTHOR,
        body: { revision: created.body.draft.revision, document: '---\n: : :\n---\nbody' },
      },
    );
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('document_invalid');
    const read = await call<{ draft: { title: string; revision: number } }>(
      harness,
      'GET',
      `${base()}/drafts/${created.body.draft.id}`,
      { as: AUTHOR },
    );
    expect(read.body.draft.title).toBe('Untouched');
    expect(read.body.draft.revision).toBe(created.body.draft.revision);
  });

  it('is what an agent reads and writes over MCP', async () => {
    const registry = new WorkspaceRegistry(harness.app.store);
    const directory = new PrincipalDirectory(harness.app.store);
    const verified = await createVerifier(harness.config).verify(AGENT);
    const ctx = await buildContext(
      { store: harness.app.store, registry, directory },
      verified,
      harness.tenant,
    );

    const { draft } = (await callTool('create_draft', ctx, { type: 'specification', title: 'Via MCP' })) as {
      draft: { id: string; revision: number };
    };
    const saved = (await callTool('save_document', ctx, {
      draft: draft.id,
      revision: draft.revision,
      document: specDocument(acceptedCase),
    })) as {
      draft: { revision: number; facets: Record<string, unknown> };
      readiness: { proposable: boolean; blockers: Array<{ kind: string }> };
    };
    expect((saved.draft.facets.acceptance_criteria as unknown[]).length).toBe(2);
    expect(saved.readiness.proposable).toBe(true);
    expect(saved.readiness.blockers.every((b) => b.kind === 'facet_unconfirmed')).toBe(true);

    const read = (await callTool('read_document', ctx, { draft: draft.id })) as {
      document: string;
      revision: number;
    };
    expect(read.document).toMatch(/^---\ntitle: Materiaalstaat generator\n/);
    expect(read.revision).toBe(saved.draft.revision);
  });
});
