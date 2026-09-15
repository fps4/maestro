/**
 * Questions on a version: asked by anyone, answered by anyone (an agent's answer marked as such),
 * closed by a human, never mutating the version, and blocking a gate only where the gate declares it.
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

const AUTHOR = token('p-visser', 'human', 'author');
const SPONSOR = token('j-dekker', 'human', 'author,reviewer');
const AGENT = token('agt-explainer', 'agent', 'author');

const classification = { lawful_basis: 'legitimate_interest', retention: '7y', personal_data: true };
const declared = (fields: object) =>
  Object.fromEntries(
    Object.keys(fields).map((f) => [f, { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' }]),
  );

beforeAll(async () => {
  harness = await startHarness('questions');
  await grantMembership(harness, harness.tenant, 'p-visser', ['author']);
  sponsor = await grantMembership(harness, harness.tenant, 'j-dekker', ['author', 'sponsor', 'owner']);
  await grantMembership(harness, harness.tenant, 'agt-explainer', ['author']);
}, 60_000);

afterAll(async () => {
  await harness?.stop();
});

const base = () => `/v1/workspaces/${harness.tenant}`;

async function proposeSpecification(title: string) {
  const facets = {
    class: 'generative',
    acceptance_criteria: [
      { id: 'AC-1', text: 'De staat is per project te genereren', priority: 'must', verify: 'test' },
    ],
    personal_data_in_scope: true,
    consequence_class: 'c3',
  };
  const created = await call<{ draft: { id: string } }>(harness, 'POST', `${base()}/drafts`, {
    as: AUTHOR,
    body: {
      type: 'specification',
      title,
      facets,
      provenance: declared(facets),
      body: {
        format: 'markdown/v1',
        content: '## Scope\n\nWhen a project is selected, the system shall generate the materiaalstaat.',
      },
      classification,
    },
  });
  const proposed = await call<{ version: { artifact: string; ordinal: number; digest: string } }>(
    harness,
    'POST',
    `${base()}/drafts/${created.body.draft.id}/propose`,
    { as: AUTHOR },
  );
  expect(proposed.status).toBe(201);
  return proposed.body.version;
}

const questionsUrl = (artifact: string, ordinal: number) =>
  `${base()}/artifacts/${artifact}/versions/${ordinal}/questions`;

describe('questions on a version', () => {
  it('are asked, answered — by an agent, marked as such — and closed by a human, without touching the version', async () => {
    const v = await proposeSpecification('Asked about');

    const asked = await call<{ question: { id: string; asked_kind: string; answers: unknown[] } }>(
      harness,
      'POST',
      questionsUrl(v.artifact, v.ordinal),
      { as: SPONSOR, body: { text: 'What does "per project" mean for a project with two sites?' } },
    );
    expect(asked.status).toBe(201);
    expect(asked.body.question.asked_kind).toBe('human');
    const id = asked.body.question.id;

    const answered = await call<{
      question: { answers: Array<{ kind: string; text: string }>; resolved_at?: string };
    }>(harness, 'POST', `${questionsUrl(v.artifact, v.ordinal)}/${id}/answers`, {
      as: AGENT,
      body: { text: 'AC-1 reads per project; a two-site project produces one staat covering both.' },
    });
    expect(answered.status).toBe(201);
    expect(answered.body.question.answers).toHaveLength(1);
    expect(answered.body.question.answers[0]!.kind).toBe('agent');
    expect(answered.body.question.resolved_at).toBeUndefined();

    const resolved = await call<{ question: { resolved_at?: string; resolved_by?: string } }>(
      harness,
      'POST',
      `${questionsUrl(v.artifact, v.ordinal)}/${id}/resolve`,
      { as: SPONSOR },
    );
    expect(resolved.status).toBe(200);
    expect(resolved.body.question.resolved_by).toBe(sponsor);

    // The version is exactly what it was. A question is a fact about it, not a change to it.
    const read = await call<{ version: { digest: string; state: string } }>(
      harness,
      'GET',
      `${base()}/artifacts/${v.artifact}/versions/${v.ordinal}`,
      { as: SPONSOR },
    );
    expect(read.body.version.digest).toBe(v.digest);
    expect(read.body.version.state).toBe('proposed');
  });

  it('refuses an agent closing a question', async () => {
    const v = await proposeSpecification('Agent cannot close');
    const asked = await call<{ question: { id: string } }>(
      harness,
      'POST',
      questionsUrl(v.artifact, v.ordinal),
      {
        as: SPONSOR,
        body: { text: 'Is the baseline measured?' },
      },
    );
    const refused = await call<{ message: string }>(
      harness,
      'POST',
      `${questionsUrl(v.artifact, v.ordinal)}/${asked.body.question.id}/resolve`,
      { as: AGENT },
    );
    expect(refused.status).toBe(422);
    expect(refused.body.message).toMatch(/Only a human closes a question/);
  });

  it('refuses a question on a draft, because a draft is not a record', async () => {
    const created = await call<{ draft: { id: string } }>(harness, 'POST', `${base()}/drafts`, {
      as: AUTHOR,
      body: { type: 'specification', title: 'Still a draft' },
    });
    // There is no questions route under drafts at all; the absence is the guarantee.
    const attempt = await call(harness, 'POST', `${base()}/drafts/${created.body.draft.id}/questions`, {
      as: SPONSOR,
      body: { text: 'Why?' },
    });
    expect(attempt.status).toBe(404);
  });

  it('holds a gate shut over an open question only where the gate declares questions_resolved', async () => {
    const v = await proposeSpecification('Blocked by a question');
    await call(harness, 'POST', `${base()}/evaluations`, {
      as: SPONSOR,
      body: {
        evaluator: 'conformance',
        artifact: v.artifact,
        ordinal: v.ordinal,
        verdict: 'pass',
        subject_digest: v.digest,
      },
    });
    const asked = await call<{ question: { id: string } }>(
      harness,
      'POST',
      questionsUrl(v.artifact, v.ordinal),
      {
        as: SPONSOR,
        body: { text: 'Does AC-1 cover subcontracted sites?' },
      },
    );

    const packet = await call<{
      packet: {
        open: boolean;
        questions: { open: number };
        checks: Array<{ id: string; satisfied: boolean }>;
      };
    }>(harness, 'GET', `${base()}/gates/specification_gate/${v.artifact}/${v.ordinal}/packet`, {
      as: SPONSOR,
    });
    expect(packet.body.packet.questions.open).toBe(1);
    expect(packet.body.packet.checks.find((c) => c.id === 'questions_resolved')!.satisfied).toBe(false);
    expect(packet.body.packet.open).toBe(false);

    const refused = await call<{ message: string }>(
      harness,
      'POST',
      `${base()}/gates/specification_gate/decisions`,
      {
        as: SPONSOR,
        body: {
          artifact: v.artifact,
          ordinal: v.ordinal,
          outcome: 'approve',
          attribution: { accountable: sponsor, acting: sponsor, seat: 'owner', oversight_level: 'O2' },
        },
      },
    );
    expect(refused.status).toBe(422);
    expect(refused.body.message).toMatch(/1 open question/);

    await call(harness, 'POST', `${questionsUrl(v.artifact, v.ordinal)}/${asked.body.question.id}/answers`, {
      as: AUTHOR,
      body: { text: 'Yes — "project" is the contract, not the site.' },
    });
    await call(harness, 'POST', `${questionsUrl(v.artifact, v.ordinal)}/${asked.body.question.id}/resolve`, {
      as: SPONSOR,
    });

    const decided = await call(harness, 'POST', `${base()}/gates/specification_gate/decisions`, {
      as: SPONSOR,
      body: {
        artifact: v.artifact,
        ordinal: v.ordinal,
        outcome: 'approve',
        attribution: { accountable: sponsor, acting: sponsor, seat: 'owner', oversight_level: 'O2' },
      },
    });
    expect(decided.status).toBe(201);
  });

  it('reach the record sink as events carrying a digest of the text, never the text', async () => {
    const handle = await harness.app.store.handle(harness.tenant);
    const events = await handle.db
      .collection<{ kind: string; payload: Record<string, unknown> }>('outbox')
      .find({ kind: { $in: ['QuestionRaised', 'QuestionAnswered', 'QuestionResolved'] } })
      .toArray();
    expect(new Set(events.map((e) => e.kind))).toEqual(
      new Set(['QuestionRaised', 'QuestionAnswered', 'QuestionResolved']),
    );
    for (const event of events) {
      expect(JSON.stringify(event.payload)).not.toMatch(/per project|baseline|subcontracted/);
      if (event.kind !== 'QuestionResolved') expect(event.payload.text_digest).toMatch(/^sha256:/);
    }
  });

  it('let an agent read, ask and answer over MCP, and give it no way to close', async () => {
    const v = await proposeSpecification('Over MCP');
    const registry = new WorkspaceRegistry(harness.app.store);
    const directory = new PrincipalDirectory(harness.app.store);
    const verified = await createVerifier(harness.config).verify(AGENT);
    const ctx = await buildContext(
      { store: harness.app.store, registry, directory },
      verified,
      harness.tenant,
    );

    const asked = (await callTool('ask_question', ctx, {
      artifact: v.artifact,
      ordinal: v.ordinal,
      text: 'Which unit is the target expressed in?',
    })) as { question: { id: string; asked_kind: string } };
    expect(asked.question.asked_kind).toBe('agent');

    const answered = (await callTool('answer_question', ctx, {
      question: asked.question.id,
      text: 'Days, per the declared outcome.',
    })) as { question: { answers: Array<{ kind: string }> } };
    expect(answered.question.answers[0]!.kind).toBe('agent');

    const listed = (await callTool('list_questions', ctx, { artifact: v.artifact, ordinal: v.ordinal })) as {
      questions: Array<{ id: string; resolved_at?: string }>;
    };
    expect(listed.questions.find((q) => q.id === asked.question.id)!.resolved_at).toBeUndefined();

    await expect(callTool('resolve_question', ctx, { question: asked.question.id })).rejects.toThrow(
      /No MCP tool named `resolve_question`/,
    );
  });
});
