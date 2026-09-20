/**
 * The whole loop, through HTTP: draft → save → confirm → propose → decide → supersede.
 *
 * Each test here corresponds to a build gate in the architecture's build order. If one of these
 * fails, the property it names is not true of the service, whatever the unit tests say.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, grantMembership, startHarness, token, type Harness } from './helpers.js';

let harness: Harness;
let sponsor: string;
let author: string;

const AUTHOR = token('p-visser', 'human', 'author');
const SPONSOR = token('j-dekker', 'human', 'author,reviewer');
const AGENT = token('agt-case-shaper', 'agent', 'author');

const facets = {
  declared_outcome: {
    statement: 'Materiaalstaat sneller samenstellen',
    baseline: 14.2,
    target: 8,
    unit: 'days',
    baseline_source: 'measured',
    method: 'Six projects of planning history',
  },
  beneficiary: { role: 'werkvoorbereider', count_estimate: 6 },
  personal_data_in_scope: true,
  consequence_class: 'c3',
  decider: 'usr-j-dekker',
};

const classification = { lawful_basis: 'legitimate_interest', retention: '7y', personal_data: true };

beforeAll(async () => {
  harness = await startHarness('loop');
  author = await grantMembership(harness, harness.tenant, 'p-visser', ['author']);
  sponsor = await grantMembership(harness, harness.tenant, 'j-dekker', ['author', 'sponsor']);
  await grantMembership(harness, harness.tenant, 'agt-case-shaper', ['author'], sponsor);
  await grantMembership(harness, harness.catalogue, 'j-dekker', ['author', 'standards_owner']);
}, 60_000);

afterAll(async () => {
  await harness?.stop();
});

const base = () => `/v1/workspaces/${harness.tenant}`;

async function newBusinessCase(as: string, title = 'Materiaalstaat-generator') {
  const created = await call<{ draft: { id: string; revision: number } }>(
    harness,
    'POST',
    `${base()}/drafts`,
    {
      as,
      body: {
        type: 'business_case',
        title,
        facets,
        provenance: Object.fromEntries(
          Object.keys(facets).map((f) => [
            f,
            { source: 'declared', by: 'unused', at: new Date().toISOString() },
          ]),
        ),
        body: { format: 'markdown/v1', content: '## Scope\n\nDe generator stelt de materiaalstaat samen.' },
        classification,
      },
    },
  );
  expect(created.status).toBe(201);
  return created.body.draft;
}

describe('drafts', () => {
  it('creates a draft and records the author as a contributor', async () => {
    const draft = await newBusinessCase(AUTHOR);
    const read = await call<{ draft: { contributors: Array<{ principal: string }> } }>(
      harness,
      'GET',
      `${base()}/drafts/${draft.id}`,
      { as: AUTHOR },
    );
    expect(read.body.draft.contributors.map((c) => c.principal)).toContain(author);
  });

  it('refuses a save carrying a stale revision, with the current state', async () => {
    const draft = await newBusinessCase(AUTHOR);
    const first = await call(harness, 'PATCH', `${base()}/drafts/${draft.id}`, {
      as: AUTHOR,
      body: { revision: draft.revision, title: 'Renamed once' },
    });
    expect(first.status).toBe(200);

    const stale = await call<{ error: string; actual: number }>(
      harness,
      'PATCH',
      `${base()}/drafts/${draft.id}`,
      {
        as: AUTHOR,
        body: { revision: draft.revision, title: 'Renamed again' },
      },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('stale_revision');
    expect(stale.body.actual).toBe(draft.revision + 1);
  });

  it('accumulates a human and an agent as separate contributors on one draft', async () => {
    const draft = await newBusinessCase(AUTHOR);
    await call(harness, 'PATCH', `${base()}/drafts/${draft.id}`, {
      as: AGENT,
      body: { revision: draft.revision, title: 'Shaped by an agent' },
    });
    const read = await call<{ draft: { contributors: Array<{ kind: string }> } }>(
      harness,
      'GET',
      `${base()}/drafts/${draft.id}`,
      { as: AUTHOR },
    );
    expect(read.body.draft.contributors.map((c) => c.kind).sort()).toEqual(['agent', 'human']);
  });

  it('refuses an agent confirming its own extraction', async () => {
    const draft = await newBusinessCase(AGENT);
    const confirmed = await call<{ message: string }>(
      harness,
      'POST',
      `${base()}/drafts/${draft.id}/confirm`,
      {
        as: AGENT,
        body: { fields: ['consequence_class'] },
      },
    );
    expect(confirmed.status).toBe(422);
    expect(confirmed.body.message).toMatch(/Only a human confirms/);
  });
});

describe('propose', () => {
  it('snapshots a draft into an immutable proposed version with a digest', async () => {
    const draft = await newBusinessCase(AUTHOR);
    const proposed = await call<{ version: { ordinal: number; state: string; digest: string } }>(
      harness,
      'POST',
      `${base()}/drafts/${draft.id}/propose`,
      { as: AUTHOR },
    );
    expect(proposed.status).toBe(201);
    expect(proposed.body.version.state).toBe('proposed');
    expect(proposed.body.version.ordinal).toBe(1);
    expect(proposed.body.version.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('refuses a proposal whose facets do not satisfy the schema, naming the path', async () => {
    const created = await call<{ draft: { id: string } }>(harness, 'POST', `${base()}/drafts`, {
      as: AUTHOR,
      body: {
        type: 'business_case',
        title: 'Incomplete',
        facets: { consequence_class: 'c3' },
        provenance: { consequence_class: { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' } },
        classification,
      },
    });
    const refused = await call<{ error: string; issues: Array<{ path: string }> }>(
      harness,
      'POST',
      `${base()}/drafts/${created.body.draft.id}/propose`,
      { as: AUTHOR },
    );
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('facets_invalid');
    expect(refused.body.issues.map((i) => i.path)).toContain('declared_outcome');
  });

  it('refuses a proposal with no classification where the type requires one', async () => {
    const created = await call<{ draft: { id: string } }>(harness, 'POST', `${base()}/drafts`, {
      as: AUTHOR,
      body: {
        type: 'business_case',
        title: 'Unclassified',
        facets,
        provenance: Object.fromEntries(
          Object.keys(facets).map((f) => [f, { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' }]),
        ),
      },
    });
    const refused = await call<{ error: string; message: string }>(
      harness,
      'POST',
      `${base()}/drafts/${created.body.draft.id}/propose`,
      { as: AUTHOR },
    );
    expect(refused.status).toBe(422);
    expect(refused.body.message).toMatch(/unclassifiable/);
  });

  it('exposes no path that mutates a version', async () => {
    // The guarantee is the absence of an operation, so it is checked as an absence.
    const draft = await newBusinessCase(AUTHOR);
    const proposed = await call<{ version: { artifact: string; ordinal: number } }>(
      harness,
      'POST',
      `${base()}/drafts/${draft.id}/propose`,
      { as: AUTHOR },
    );
    const { artifact, ordinal } = proposed.body.version;

    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const attempt = await call(harness, method, `${base()}/artifacts/${artifact}/versions/${ordinal}`, {
        as: AUTHOR,
        body: { title: 'rewritten' },
      });
      expect(attempt.status).toBe(404);
    }
  });
});

describe('gates', () => {
  async function proposedCase(title: string) {
    const draft = await newBusinessCase(AUTHOR, title);
    const proposed = await call<{ version: { artifact: string; ordinal: number; digest: string } }>(
      harness,
      'POST',
      `${base()}/drafts/${draft.id}/propose`,
      { as: AUTHOR },
    );
    return proposed.body.version;
  }

  async function recordEvaluation(artifact: string, ordinal: number, digest: string, verdict = 'pass') {
    return call(harness, 'POST', `${base()}/evaluations`, {
      as: SPONSOR,
      body: { evaluator: 'sufficiency', artifact, ordinal, verdict, subject_digest: digest },
    });
  }

  it('records the builtin sufficiency verdict at propose, with one finding per required facet', async () => {
    // The evaluator port's local default (ADR-0015): the facet schema, as findings. Explore opens
    // on a deployment with nothing behind the port, and the reader sees what was checked.
    const draft = await newBusinessCase(AUTHOR, 'Evaluated on propose');
    const proposed = await call<{
      version: { artifact: string; ordinal: number };
      evaluations: Array<{ evaluator: string; status: string; verdict?: string }>;
    }>(harness, 'POST', `${base()}/drafts/${draft.id}/propose`, { as: AUTHOR });
    expect(proposed.body.evaluations).toEqual([
      { evaluator: 'sufficiency', status: 'recorded', verdict: 'pass' },
    ]);

    const { artifact, ordinal } = proposed.body.version;
    const view = await call<{
      view: { open: boolean; requirements: Array<{ id: string; satisfied: boolean }> };
    }>(harness, 'GET', `${base()}/gates/explore/${artifact}/${ordinal}`, { as: SPONSOR });
    expect(view.body.view.requirements.find((r) => r.id === 'evaluation:sufficiency')!.satisfied).toBe(true);
    expect(view.body.view.open).toBe(true);

    const packet = await call<{
      packet: {
        checks: Array<{
          id: string;
          findings?: Array<{ standard: string; outcome: string; detail: string }>;
        }>;
      };
    }>(harness, 'GET', `${base()}/gates/explore/${artifact}/${ordinal}/packet`, { as: SPONSOR });
    const findings = packet.body.packet.checks.find((c) => c.id === 'evaluation:sufficiency')!.findings!;
    expect(findings.map((f) => f.standard)).toEqual([
      'schema:declared_outcome',
      'schema:beneficiary',
      'schema:personal_data_in_scope',
      'schema:consequence_class',
      'schema:decider',
    ]);
    expect(findings.every((f) => f.outcome === 'met')).toBe(true);
    expect(findings[0]!.detail).toMatch(/^Declared outcome/);
  });

  it('holds a gate shut while its evaluator is unavailable, and says why', async () => {
    // Conformance is an endpoint evaluator whose `${EVALUATOR_BASE}` this deployment does not set.
    // Nothing is recorded, the gate says so, and propose reports the reason.
    const created = await call<{ draft: { id: string } }>(harness, 'POST', `${base()}/drafts`, {
      as: AUTHOR,
      body: {
        type: 'specification',
        title: 'Awaiting conformance',
        facets: {
          class: 'generative',
          acceptance_criteria: [{ id: 'AC-1', text: 'Something testable', priority: 'must', verify: 'test' }],
          personal_data_in_scope: false,
          consequence_class: 'c2',
        },
        provenance: Object.fromEntries(
          ['class', 'acceptance_criteria', 'personal_data_in_scope', 'consequence_class'].map((f) => [
            f,
            { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' },
          ]),
        ),
        classification: { lawful_basis: 'contract', retention: '7y', personal_data: false },
      },
    });
    const proposed = await call<{
      version: { artifact: string; ordinal: number };
      evaluations: Array<{ evaluator: string; status: string; reason?: string }>;
    }>(harness, 'POST', `${base()}/drafts/${created.body.draft.id}/propose`, { as: AUTHOR });
    expect(proposed.body.evaluations).toEqual([
      expect.objectContaining({
        evaluator: 'conformance',
        status: 'unavailable',
        reason: expect.stringMatching(/EVALUATOR_BASE/),
      }),
    ]);

    const { artifact, ordinal } = proposed.body.version;
    const view = await call<{
      view: { open: boolean; requirements: Array<{ id: string; satisfied: boolean; detail: string }> };
    }>(harness, 'GET', `${base()}/gates/specification_gate/${artifact}/${ordinal}`, { as: SPONSOR });
    const requirement = view.body.view.requirements.find((r) => r.id === 'evaluation:conformance')!;
    expect(requirement.satisfied).toBe(false);
    expect(requirement.detail).toMatch(/no verdict has been recorded/);
    expect(view.body.view.open).toBe(false);
  });

  it('refuses a verdict recorded against a different digest', async () => {
    const version = await proposedCase('Wrong digest');
    const refused = await call<{ message: string }>(harness, 'POST', `${base()}/evaluations`, {
      as: SPONSOR,
      body: {
        evaluator: 'sufficiency',
        artifact: version.artifact,
        ordinal: version.ordinal,
        verdict: 'pass',
        subject_digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.message).toMatch(/not a verdict about this version/);
  });

  it('opens once every requirement is satisfied, and accepts', async () => {
    const version = await proposedCase('Ready to decide');
    await recordEvaluation(version.artifact, version.ordinal, version.digest);

    const decision = await call<{ decision: { outcome: string; subject_digest: string } }>(
      harness,
      'POST',
      `${base()}/gates/explore/decisions`,
      {
        as: SPONSOR,
        body: {
          artifact: version.artifact,
          ordinal: version.ordinal,
          outcome: 'approve',
          reasoning: 'Baseline is measured over six projects.',
          attribution: { accountable: sponsor, acting: sponsor, seat: 'sponsor', oversight_level: 'O2' },
        },
      },
    );
    expect(decision.status).toBe(201);
    expect(decision.body.decision.subject_digest).toBe(version.digest);

    const artifact = await call<{ artifact: { phase: string; accepted_ordinal: number } }>(
      harness,
      'GET',
      `${base()}/artifacts/${version.artifact}`,
      { as: SPONSOR },
    );
    expect(artifact.body.artifact.phase).toBe('prove');
    expect(artifact.body.artifact.accepted_ordinal).toBe(version.ordinal);
  });

  it('refuses to let a caller name anyone but themselves as accountable', async () => {
    // The stronger rule, and it closes the agent case as a consequence: `accountable` is resolved
    // from the session, so an agent cannot be named there because *nobody* else can. Refused at the
    // boundary, before the profile's kind rule is consulted.
    const version = await proposedCase('Agent accountable');
    await recordEvaluation(version.artifact, version.ordinal, version.digest);
    const agentPrincipal = await grantMembership(
      harness,
      harness.tenant,
      'agt-case-shaper',
      ['author'],
      sponsor,
    );

    const refused = await call<{ error: string; message: string }>(
      harness,
      'POST',
      `${base()}/gates/explore/decisions`,
      {
        as: SPONSOR,
        body: {
          artifact: version.artifact,
          ordinal: version.ordinal,
          outcome: 'approve',
          attribution: {
            accountable: agentPrincipal,
            acting: sponsor,
            seat: 'sponsor',
            oversight_level: 'O2',
          },
        },
      },
    );
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/resolved from your session/);
  });

  it('refuses a decision missing a field the profile requires, and records the refusal', async () => {
    const version = await proposedCase('Missing seat');
    await recordEvaluation(version.artifact, version.ordinal, version.digest);

    const refused = await call<{ error: string; issues: Array<{ field: string }> }>(
      harness,
      'POST',
      `${base()}/gates/explore/decisions`,
      {
        as: SPONSOR,
        body: {
          artifact: version.artifact,
          ordinal: version.ordinal,
          outcome: 'approve',
          attribution: { seat: 'sponsor' },
        },
      },
    );
    expect(refused.status).toBe(422);
    expect(refused.body.issues.map((i) => i.field)).toContain('oversight_level');

    // A control whose refusals are invisible is one nobody can audit, so the refusal reaches the
    // record sink like every other state change.
    const handle = await harness.app.store.handle(harness.tenant);
    const refusal = (await handle.outbox.list()).find((e) => e.type === 'DecisionRefused');
    expect(refusal).toBeDefined();
  });

  it('refuses a decision from someone who does not hold the gate’s role', async () => {
    const version = await proposedCase('Wrong role');
    await recordEvaluation(version.artifact, version.ordinal, version.digest);

    const refused = await call<{ message: string }>(harness, 'POST', `${base()}/gates/explore/decisions`, {
      as: AUTHOR,
      body: {
        artifact: version.artifact,
        ordinal: version.ordinal,
        outcome: 'approve',
        attribution: { accountable: author, acting: author, seat: 'sponsor', oversight_level: 'O2' },
      },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.message).toMatch(/sponsor/);
  });

  it('reopens a draft on request_changes, carrying the reviewer’s reasoning, and keeps the refused version', async () => {
    const version = await proposedCase('Needs work');
    await recordEvaluation(version.artifact, version.ordinal, version.digest);

    await call(harness, 'POST', `${base()}/gates/explore/decisions`, {
      as: SPONSOR,
      body: {
        artifact: version.artifact,
        ordinal: version.ordinal,
        outcome: 'request_changes',
        reasoning: 'The beneficiary count is a guess.',
        attribution: { accountable: sponsor, acting: sponsor, seat: 'sponsor', oversight_level: 'O2' },
      },
    });

    const read = await call<{ versions: Array<{ ordinal: number; state: string }> }>(
      harness,
      'GET',
      `${base()}/artifacts/${version.artifact}`,
      { as: SPONSOR },
    );
    expect(read.body.versions.find((v) => v.ordinal === version.ordinal)!.state).toBe('rejected');

    const drafts = await call<{ drafts: Array<{ artifact?: string; based_on?: number }> }>(
      harness,
      'GET',
      `${base()}/drafts`,
      { as: SPONSOR },
    );
    const reopened = drafts.body.drafts.find((d) => d.artifact === version.artifact);
    expect(reopened?.based_on).toBe(version.ordinal);
  });
});

describe('the pin', () => {
  it('resolves to the version accepted at acceptance time, after the target is superseded twice', async () => {
    // A business case, accepted at @1.
    const caseDraft = await newBusinessCase(AUTHOR, 'Pinned case');
    const caseV1 = (
      await call<{ version: { artifact: string; ordinal: number; digest: string } }>(
        harness,
        'POST',
        `${base()}/drafts/${caseDraft.id}/propose`,
        { as: AUTHOR },
      )
    ).body.version;
    await call(harness, 'POST', `${base()}/evaluations`, {
      as: SPONSOR,
      body: {
        evaluator: 'sufficiency',
        artifact: caseV1.artifact,
        ordinal: caseV1.ordinal,
        verdict: 'pass',
        subject_digest: caseV1.digest,
      },
    });
    await call(harness, 'POST', `${base()}/gates/explore/decisions`, {
      as: SPONSOR,
      body: {
        artifact: caseV1.artifact,
        ordinal: caseV1.ordinal,
        outcome: 'approve',
        attribution: { accountable: sponsor, acting: sponsor, seat: 'sponsor', oversight_level: 'O2' },
      },
    });

    // A specification pinned to it, accepted while the case sits at @1.
    const specDraft = await call<{ draft: { id: string } }>(harness, 'POST', `${base()}/drafts`, {
      as: AUTHOR,
      body: {
        type: 'specification',
        title: 'Pinned specification',
        facets: {
          class: 'generative',
          acceptance_criteria: [
            { id: 'AC-1', text: 'De staat is per project te genereren', priority: 'must', verify: 'test' },
          ],
          personal_data_in_scope: true,
          consequence_class: 'c3',
        },
        provenance: {
          class: { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' },
          acceptance_criteria: { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' },
          personal_data_in_scope: { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' },
          consequence_class: { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' },
        },
        classification,
        links: [{ type: 'justified_by', target: caseV1.artifact }],
      },
    });
    const specV1 = (
      await call<{ version: { artifact: string; ordinal: number; digest: string } }>(
        harness,
        'POST',
        `${base()}/drafts/${specDraft.body.draft.id}/propose`,
        { as: AUTHOR },
      )
    ).body.version;

    await grantMembership(harness, harness.tenant, 'j-dekker', ['author', 'sponsor', 'owner']);
    await call(harness, 'POST', `${base()}/evaluations`, {
      as: SPONSOR,
      body: {
        evaluator: 'conformance',
        artifact: specV1.artifact,
        ordinal: specV1.ordinal,
        verdict: 'pass',
        subject_digest: specV1.digest,
      },
    });
    const specDecision = await call(harness, 'POST', `${base()}/gates/specification_gate/decisions`, {
      as: SPONSOR,
      body: {
        artifact: specV1.artifact,
        ordinal: specV1.ordinal,
        outcome: 'approve',
        attribution: { accountable: sponsor, acting: sponsor, seat: 'owner', oversight_level: 'O2' },
      },
    });
    expect(specDecision.status).toBe(201);

    // Now supersede the case twice.
    for (const round of [2, 3]) {
      const next = await call<{ draft: { id: string } }>(harness, 'POST', `${base()}/drafts`, {
        as: AUTHOR,
        body: {
          type: 'business_case',
          title: `Pinned case, revision ${round}`,
          artifact: caseV1.artifact,
          facets: { ...facets, declared_outcome: { ...facets.declared_outcome, target: 8 - round } },
          provenance: Object.fromEntries(
            Object.keys(facets).map((f) => [f, { source: 'declared', by: 'x', at: '2026-08-01T00:00:00Z' }]),
          ),
          classification,
        },
      });
      const version = (
        await call<{ version: { artifact: string; ordinal: number; digest: string } }>(
          harness,
          'POST',
          `${base()}/drafts/${next.body.draft.id}/propose`,
          { as: AUTHOR },
        )
      ).body.version;
      await call(harness, 'POST', `${base()}/evaluations`, {
        as: SPONSOR,
        body: {
          evaluator: 'sufficiency',
          artifact: version.artifact,
          ordinal: version.ordinal,
          verdict: 'pass',
          subject_digest: version.digest,
        },
      });
      await call(harness, 'POST', `${base()}/gates/explore/decisions`, {
        as: SPONSOR,
        body: {
          artifact: version.artifact,
          ordinal: version.ordinal,
          outcome: 'approve',
          attribution: { accountable: sponsor, acting: sponsor, seat: 'sponsor', oversight_level: 'O2' },
        },
      });
    }

    // The case is now at @3. The specification must still read against @1.
    const caseNow = await call<{ artifact: { accepted_ordinal: number } }>(
      harness,
      'GET',
      `${base()}/artifacts/${caseV1.artifact}`,
      { as: SPONSOR },
    );
    expect(caseNow.body.artifact.accepted_ordinal).toBe(3);

    const spec = await call<{ version: { links: Array<{ type: string; pinned_to: number | null }> } }>(
      harness,
      'GET',
      `${base()}/artifacts/${specV1.artifact}/versions/${specV1.ordinal}`,
      { as: SPONSOR },
    );
    const pin = spec.body.version.links.find((l) => l.type === 'justified_by')!;
    expect(pin.pinned_to).toBe(1);

    const lineage = await call<{
      lineage: { edges: Array<{ type: string; pinned: boolean; ordinal?: number }> };
    }>(harness, 'GET', `${base()}/artifacts/${specV1.artifact}/lineage`, { as: SPONSOR });
    const edge = lineage.body.lineage.edges.find((e) => e.type === 'justified_by')!;
    expect(edge.pinned).toBe(true);
    expect(edge.ordinal).toBe(1);
  }, 60_000);
});

describe('the record sink', () => {
  it('emits every state change in sequence, transactionally with the change', async () => {
    const handle = await harness.app.store.handle(harness.tenant);
    const events = await handle.outbox.list();

    expect(events.length).toBeGreaterThan(0);
    expect(events.map((e) => e.seq)).toEqual([...events.map((e) => e.seq)].sort((a, b) => a - b));
    expect(new Set(events.map((e) => e.seq)).size).toBe(events.length);
    expect(events.every((e) => Boolean(e.acting) && /^prn-h-/.test(e.accountable))).toBe(true);
    expect(new Set(events.map((e) => e.type))).toContain('VersionProposed');
    expect(new Set(events.map((e) => e.type))).toContain('DecisionRecorded');
  });
});
