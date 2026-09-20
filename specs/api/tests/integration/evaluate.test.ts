/**
 * The evaluator port, end to end: readiness before propose, the builtin at propose, the endpoint
 * adapter against a real (stub) evaluator, and the MCP tools an agent uses to get a gate open.
 */

import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/auth/context.js';
import { createVerifier } from '../../src/auth/verify.js';
import { callTool } from '../../src/mcp/handler.js';
import { EvaluationService } from '../../src/services/evaluate.js';
import { PrincipalDirectory } from '../../src/services/principals.js';
import { WorkspaceRegistry } from '../../src/services/workspaces.js';
import { call, grantMembership, startHarness, token, type Harness } from './helpers.js';

let harness: Harness;
let evaluator: Server;
let evaluatorPort: number;
const received: unknown[] = [];

const AUTHOR = token('p-visser', 'human', 'author');
const AGENT = token('agt-drafter', 'agent', 'author');

const declared = (fields: object) =>
  Object.fromEntries(
    Object.keys(fields).map((f) => [f, { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' }]),
  );

beforeAll(async () => {
  harness = await startHarness('evaluate');
  const visser = await grantMembership(harness, harness.tenant, 'p-visser', ['author']);
  await grantMembership(harness, harness.tenant, 'agt-drafter', ['author'], visser);

  // A stub evaluator: answers `pass` with one finding, and remembers what it was sent.
  evaluator = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          verdict: 'pass',
          findings: [{ standard: 'FPS4-CONF-001', outcome: 'met', detail: 'AC-1 is testable.' }],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => evaluator.listen(0, '127.0.0.1', resolve));
  evaluatorPort = (evaluator.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  evaluator?.close();
  await harness?.stop();
});

const base = () => `/v1/workspaces/${harness.tenant}`;

describe('readiness', () => {
  it('tells an author what is still missing, in the schema’s words, before they hit a 422', async () => {
    const created = await call<{ draft: { id: string; revision: number } }>(
      harness,
      'POST',
      `${base()}/drafts`,
      {
        as: AUTHOR,
        body: {
          type: 'business_case',
          title: 'Half written',
          facets: { consequence_class: 'c3' },
          provenance: declared({ consequence_class: 1 }),
        },
      },
    );
    const { body } = await call<{
      readiness: {
        proposable: boolean;
        blockers: Array<{ kind: string; label: string; description?: string }>;
        gates: Array<{ title: string; requirements: string[] }>;
      };
    }>(harness, 'GET', `${base()}/drafts/${created.body.draft.id}/readiness`, { as: AUTHOR });

    expect(body.readiness.proposable).toBe(false);
    expect(body.readiness.blockers.map((b) => [b.kind, b.label])).toEqual([
      ['facet_missing', 'Declared outcome'],
      ['facet_missing', 'Beneficiary'],
      ['facet_missing', 'Personal data in scope'],
      ['facet_missing', 'Decider'],
      ['classification_missing', 'Data classification'],
    ]);
    expect(body.readiness.blockers[0]!.description).toBeUndefined();
    expect(body.readiness.gates[0]!.title).toBe('Explore');
    expect(body.readiness.gates[0]!.requirements.some((r) => /Sufficiency/.test(r))).toBe(true);
  });
});

describe('the endpoint adapter', () => {
  it('posts the version’s facets and digest to the resolved endpoint and records the reply', async () => {
    const created = await call<{ draft: { id: string } }>(harness, 'POST', `${base()}/drafts`, {
      as: AUTHOR,
      body: {
        type: 'specification',
        title: 'Evaluated by an endpoint',
        facets: {
          class: 'generative',
          acceptance_criteria: [{ id: 'AC-1', text: 'Something testable', priority: 'must', verify: 'test' }],
          personal_data_in_scope: false,
          consequence_class: 'c2',
        },
        provenance: declared({
          class: 1,
          acceptance_criteria: 1,
          personal_data_in_scope: 1,
          consequence_class: 1,
        }),
        classification: { lawful_basis: 'contract', retention: '7y', personal_data: false },
      },
    });
    const proposed = await call<{
      version: { artifact: string; ordinal: number; digest: string; type: string };
    }>(harness, 'POST', `${base()}/drafts/${created.body.draft.id}/propose`, { as: AUTHOR });
    const version = proposed.body.version;

    // Run the port directly with the environment the deployment would set.
    const handle = await harness.app.store.handle(harness.tenant);
    const workspace = await new WorkspaceRegistry(harness.app.store).load(harness.tenant);
    const service = new EvaluationService(handle, workspace, {
      EVALUATOR_BASE: `http://127.0.0.1:${evaluatorPort}`,
    });
    const full = await call<{ version: { facets: Record<string, unknown> } }>(
      harness,
      'GET',
      `${base()}/artifacts/${version.artifact}/versions/${version.ordinal}`,
      { as: AUTHOR },
    );
    const runs = await service.run({ ...full.body.version, ...version } as Parameters<typeof service.run>[0]);
    expect(runs).toEqual([{ evaluator: 'conformance', status: 'recorded', verdict: 'pass' }]);

    expect(received).toHaveLength(1);
    const sent = received[0] as { url: string; body: Record<string, unknown> };
    expect(sent.url).toBe('/conformance');
    expect(sent.body.subject_digest).toBe(version.digest);
    expect(sent.body.type).toBe('specification');
    expect((sent.body.facets as { consequence_class: string }).consequence_class).toBe('c2');

    const view = await call<{ view: { requirements: Array<{ id: string; satisfied: boolean }> } }>(
      harness,
      'GET',
      `${base()}/gates/specification_gate/${version.artifact}/${version.ordinal}`,
      { as: AUTHOR },
    );
    expect(view.body.view.requirements.find((r) => r.id === 'evaluation:conformance')!.satisfied).toBe(true);
  });

  it('records nothing and says why when the evaluator is unreachable', async () => {
    const handle = await harness.app.store.handle(harness.tenant);
    const workspace = await new WorkspaceRegistry(harness.app.store).load(harness.tenant);
    const dead = new EvaluationService(handle, workspace, { EVALUATOR_BASE: 'http://127.0.0.1:1' });
    const runs = await dead.run({
      artifact: 'art-none',
      ordinal: 1,
      type: 'specification',
      digest: 'sha256:0',
      facets: {},
    } as Parameters<typeof dead.run>[0]);
    expect(runs[0]).toMatchObject({ evaluator: 'conformance', status: 'unavailable' });
    expect(runs[0]!.reason).toMatch(/could not be reached/);
  });
});

describe('over MCP', () => {
  it('lets an agent read readiness, propose, and re-run evaluations — and still not decide', async () => {
    const registry = new WorkspaceRegistry(harness.app.store);
    const directory = new PrincipalDirectory(harness.app.store);
    const verified = await createVerifier(harness.config).verify(AGENT);
    const ctx = await buildContext(
      { store: harness.app.store, registry, directory },
      verified,
      harness.tenant,
    );

    const draft = (await callTool('create_draft', ctx, {
      type: 'business_case',
      title: 'Agent drafted',
      facets: { consequence_class: 'c2' },
    })) as { draft: { id: string; revision: number } };

    const before = (await callTool('draft_readiness', ctx, { draft: draft.draft.id })) as {
      readiness: { proposable: boolean; blockers: Array<{ kind: string }> };
    };
    expect(before.readiness.proposable).toBe(false);
    expect(before.readiness.blockers.some((b) => b.kind === 'facet_unconfirmed')).toBe(true);

    await expect(callTool('run_evaluations', ctx, { artifact: 'art-nope', ordinal: 1 })).rejects.toThrow(
      /does not exist/,
    );
    await expect(callTool('decide', ctx, {})).rejects.toThrow(/No MCP tool named `decide`/);
  });
});
