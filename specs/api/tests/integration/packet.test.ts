/**
 * The decider's packet, through HTTP and MCP — and the catalogue's `publish` outcome, which is the
 * case that made the accepting outcome declarative.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool } from '../../src/mcp/handler.js';
import { buildContext } from '../../src/auth/context.js';
import { createVerifier } from '../../src/auth/verify.js';
import { PrincipalDirectory } from '../../src/services/principals.js';
import { WorkspaceRegistry } from '../../src/services/workspaces.js';
import { call, grantMembership, startHarness, token, type Harness } from './helpers.js';

let harness: Harness;
let sponsor: string;

const AUTHOR = token('p-visser', 'human', 'author');
const SPONSOR = token('j-dekker', 'human', 'author,reviewer');
const AGENT = token('agt-explainer', 'agent', 'author');
const STANDARDS_OWNER = token('m-bakker', 'human', 'author,reviewer');

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
const classification = { lawful_basis: 'legitimate_interest', retention: '7y', personal_data: true };
const declared = (fields: object) =>
  Object.fromEntries(
    Object.keys(fields).map((f) => [f, { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' }]),
  );

beforeAll(async () => {
  harness = await startHarness('packet');
  await grantMembership(harness, harness.tenant, 'p-visser', ['author']);
  sponsor = await grantMembership(harness, harness.tenant, 'j-dekker', ['author', 'sponsor']);
  await grantMembership(harness, harness.tenant, 'agt-explainer', ['author'], sponsor);
  await grantMembership(harness, harness.catalogue, 'm-bakker', ['author', 'standards_owner']);
}, 60_000);

afterAll(async () => {
  await harness?.stop();
});

const base = () => `/v1/workspaces/${harness.tenant}`;

async function proposeCase(title: string, body = '## Scope\n\nDe generator stelt de materiaalstaat samen.') {
  const created = await call<{ draft: { id: string } }>(harness, 'POST', `${base()}/drafts`, {
    as: AUTHOR,
    body: {
      type: 'business_case',
      title,
      facets,
      provenance: declared(facets),
      body: { format: 'markdown/v1', content: body },
      classification,
    },
  });
  const proposed = await call<{ version: { artifact: string; ordinal: number; digest: string } }>(
    harness,
    'POST',
    `${base()}/drafts/${created.body.draft.id}/propose`,
    { as: AUTHOR },
  );
  return proposed.body.version;
}

async function evaluate(artifact: string, ordinal: number, digest: string) {
  await call(harness, 'POST', `${base()}/evaluations`, {
    as: SPONSOR,
    body: {
      evaluator: 'sufficiency',
      artifact,
      ordinal,
      verdict: 'pass',
      subject_digest: digest,
      findings: [{ standard: 'FPS4-SUFF-BASELINE-002', outcome: 'met', detail: 'The baseline is measured.' }],
    },
  });
}

describe('the decider’s packet', () => {
  it('says in plain language what is being decided, what each outcome does, and what the checks found', async () => {
    const v = await proposeCase('Packet case');
    await evaluate(v.artifact, v.ordinal, v.digest);

    const { status, body } = await call<{ packet: Record<string, unknown> }>(
      harness,
      'GET',
      `${base()}/gates/explore/${v.artifact}/${v.ordinal}/packet`,
      { as: SPONSOR },
    );
    expect(status).toBe(200);
    const packet = body.packet as {
      gate: { title: string; description: string; type_title: string; type_description: string };
      subject: { title: string; phase_label: string };
      document: { html: string; markdown: string };
      facets: Array<{ field: string; label: string; description?: string; confirmed: boolean }>;
      since: unknown;
      checks: Array<{ id: string; satisfied: boolean; findings?: Array<{ detail: string }> }>;
      open: boolean;
      decider: {
        may_decide: boolean;
        outcomes: Array<{ outcome: string; label: string; accepts: boolean; effects: string[] }>;
        attribution: { field_labels: Record<string, string> };
      };
      history: unknown[];
    };

    expect(packet.gate.title).toBe('Explore');
    expect(packet.gate.description).toMatch(/worth taking further/);
    expect(packet.gate.type_title).toBe('Business case');
    expect(packet.gate.type_description).toMatch(/worth solving/);
    expect(packet.subject.phase_label).toBe('Exploring');

    expect(packet.document.html).toContain('<h2>Scope</h2>');
    expect(packet.document.markdown).toContain('## Scope');

    const outcome = packet.facets.find((f) => f.field === 'declared_outcome')!;
    expect(outcome.confirmed).toBe(true);
    expect(outcome.label).toBe('Declared outcome');

    expect(packet.since).toBeNull();
    expect(packet.open).toBe(true);
    expect(packet.checks.find((c) => c.id === 'evaluation:sufficiency')!.findings![0]!.detail).toBe(
      'The baseline is measured.',
    );

    expect(packet.decider.may_decide).toBe(true);
    const approve = packet.decider.outcomes.find((o) => o.outcome === 'approve')!;
    expect(approve.label).toBe('Approve');
    expect(approve.accepts).toBe(true);
    expect(approve.effects).toContain('Version @1 becomes the accepted business case.');
    expect(approve.effects).toContain('The business case moves from Exploring to Proving.');
    expect(packet.decider.attribution.field_labels.oversight_level).toBe('Oversight level');
    expect(packet.history).toEqual([]);
  });

  it('reports what changed since the last version anyone decided on, not since the previous ordinal', async () => {
    const v1 = await proposeCase('Changing case', '## Scope\n\nFirst reading.');
    await evaluate(v1.artifact, v1.ordinal, v1.digest);
    await call(harness, 'POST', `${base()}/gates/explore/decisions`, {
      as: SPONSOR,
      body: {
        artifact: v1.artifact,
        ordinal: v1.ordinal,
        outcome: 'request_changes',
        reasoning: 'Target is too ambitious.',
        attribution: { accountable: sponsor, acting: sponsor, seat: 'sponsor', oversight_level: 'O2' },
      },
    });

    // The reopened draft, edited by the author and re-proposed as @2.
    const drafts = await call<{ drafts: Array<{ id: string; artifact?: string; revision: number }> }>(
      harness,
      'GET',
      `${base()}/drafts`,
      { as: AUTHOR },
    );
    const reopened = drafts.body.drafts.find((d) => d.artifact === v1.artifact)!;
    await call(harness, 'PATCH', `${base()}/drafts/${reopened.id}`, {
      as: AUTHOR,
      body: {
        revision: reopened.revision,
        facets: { ...facets, declared_outcome: { ...facets.declared_outcome, target: 10 } },
        provenance: declared(facets),
        body: { format: 'markdown/v1', content: '## Scope\n\nSecond reading, softer target.' },
      },
    });
    const v2 = (
      await call<{ version: { artifact: string; ordinal: number } }>(
        harness,
        'POST',
        `${base()}/drafts/${reopened.id}/propose`,
        { as: AUTHOR },
      )
    ).body.version;
    expect(v2.ordinal).toBe(2);

    const { body } = await call<{
      packet: {
        since: {
          ordinal: number;
          outcome: { id: string; label: string };
          facets: Array<{ field: string; label: string; kind: string }>;
          body: { unchanged: boolean; added_lines: number; removed_lines: number };
        };
        history: Array<{ ordinal: number; outcome_label: string; reasoning: string }>;
      };
    }>(harness, 'GET', `${base()}/gates/explore/${v2.artifact}/2/packet`, { as: SPONSOR });

    expect(body.packet.since.ordinal).toBe(1);
    expect(body.packet.since.outcome).toEqual({ id: 'request_changes', label: 'Ask for changes' });
    expect(body.packet.since.facets).toEqual([
      {
        field: 'declared_outcome',
        label: 'Declared outcome',
        kind: 'changed',
        before: expect.anything(),
        after: expect.anything(),
      },
    ]);
    expect(body.packet.since.body.unchanged).toBe(false);
    expect(body.packet.since.body.added_lines).toBeGreaterThan(0);
    expect(body.packet.history).toEqual([
      expect.objectContaining({
        ordinal: 1,
        outcome_label: 'Ask for changes',
        reasoning: 'Target is too ambitious.',
      }),
    ]);
  });

  it('is readable by an agent over MCP, which still has no way to decide', async () => {
    const v = await proposeCase('Agent-explained case');
    const registry = new WorkspaceRegistry(harness.app.store);
    const directory = new PrincipalDirectory(harness.app.store);
    const verified = await createVerifier(harness.config).verify(AGENT);
    const ctx = await buildContext(
      { store: harness.app.store, registry, directory },
      verified,
      harness.tenant,
    );

    const result = (await callTool('decision_packet', ctx, {
      gate: 'explore',
      artifact: v.artifact,
      ordinal: v.ordinal,
    })) as {
      packet: { decider: { may_decide: boolean; reason: string; outcomes: Array<{ label: string }> } };
    };

    // The agent can read everything the sponsor reads, and is told it cannot decide.
    expect(result.packet.decider.may_decide).toBe(false);
    expect(result.packet.decider.reason).toMatch(/Only a named human decides/);
    expect(result.packet.decider.outcomes.map((o) => o.label)).toEqual([
      'Approve',
      'Ask for changes',
      'Decline',
    ]);

    await expect(callTool('decide', ctx, {})).rejects.toThrow(/No MCP tool named `decide`/);
  });
});

describe('the catalogue’s publish outcome', () => {
  it('accepts a standard with `publish`, because the accepting outcome is declared and not assumed', async () => {
    const cat = `/v1/workspaces/${harness.catalogue}`;
    const created = await call<{ draft: { id: string } }>(harness, 'POST', `${cat}/drafts`, {
      as: STANDARDS_OWNER,
      body: {
        type: 'platform_standard',
        title: 'Baseline must be measured',
        facets: {
          standard_id: 'FPS4-SUFF-BASELINE-002',
          pack: 'sufficiency',
          pack_version: '1.0.0',
          tier: 'product',
          kind: 'sufficiency',
          assertion: 'declared_outcome.baseline_source == measured',
          severity: 'blocking',
        },
        provenance: declared({
          standard_id: 1,
          pack: 1,
          pack_version: 1,
          tier: 1,
          kind: 1,
          assertion: 1,
          severity: 1,
        }),
        body: { format: 'markdown/v1', content: 'An estimated baseline cannot be falsified.' },
      },
    });
    expect(created.status).toBe(201);
    const version = (
      await call<{ version: { artifact: string; ordinal: number } }>(
        harness,
        'POST',
        `${cat}/drafts/${created.body.draft.id}/propose`,
        { as: STANDARDS_OWNER },
      )
    ).body.version;

    // A second standards owner decides, because publication declares exclude_creator.
    const second = token('r-jansen', 'human', 'author,reviewer');
    const secondId = await grantMembership(harness, harness.catalogue, 'r-jansen', [
      'author',
      'standards_owner',
    ]);

    const packet = await call<{
      packet: { decider: { outcomes: Array<{ outcome: string; accepts: boolean }> } };
    }>(harness, 'GET', `${cat}/gates/publication/${version.artifact}/${version.ordinal}/packet`, {
      as: second,
    });
    expect(packet.body.packet.decider.outcomes.find((o) => o.outcome === 'publish')!.accepts).toBe(true);

    const decision = await call<{ decision: { outcome: string } }>(
      harness,
      'POST',
      `${cat}/gates/publication/decisions`,
      {
        as: second,
        body: {
          artifact: version.artifact,
          ordinal: version.ordinal,
          outcome: 'publish',
          materiality: 'material',
          attribution: { accountable: secondId, acting: secondId },
        },
      },
    );
    expect(decision.status).toBe(201);

    const read = await call<{ artifact: { accepted_ordinal?: number }; versions: Array<{ state: string }> }>(
      harness,
      'GET',
      `${cat}/artifacts/${version.artifact}`,
      { as: second },
    );
    expect(read.body.artifact.accepted_ordinal).toBe(version.ordinal);
    expect(read.body.versions[0]!.state).toBe('accepted');
  });
});
