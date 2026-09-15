import { describe, expect, it } from 'vitest';
import { facetSchemaEvaluation } from '../../src/domain/builtin-evaluators.js';
import { FacetValidator } from '../../src/domain/facets.js';
import { labelsFor } from '../../src/domain/labels.js';
import { draftReadiness } from '../../src/domain/readiness.js';
import { parseWorkspaceDefinition, typeIn } from '../../src/domain/workspace-definition.js';
import { resolveEndpoint } from '../../src/services/evaluate.js';

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['declared_outcome', 'beneficiary', 'consequence_class'],
  additionalProperties: false,
  properties: {
    declared_outcome: {
      type: 'object',
      description: 'What gets better, by how much, from what baseline?',
      required: ['statement', 'baseline'],
      properties: { statement: { type: 'string', minLength: 10 }, baseline: { type: 'number' } },
    },
    beneficiary: {
      type: 'object',
      title: 'Who benefits',
      description: 'The role, and roughly how many of them.',
    },
    consequence_class: { enum: ['c1', 'c2', 'c3', 'c4'] },
  },
};

const def = parseWorkspaceDefinition({
  workspace: 'ws-test',
  definition_version: 1,
  types: [
    {
      id: 'business_case',
      title: 'Business case',
      facet_schema: './bc.json',
      classification_required: true,
      links: [],
    },
    {
      id: 'specification',
      title: 'Specification',
      facet_schema: './spec.json',
      links: [{ id: 'justified_by', to: 'business_case', pinned: true, label: 'Justified by' }],
    },
  ],
  attribution_profiles: [
    {
      id: 'default',
      required: ['accountable'],
      rules: { accountable: { must_resolve_to: 'principal', kind: 'human' } },
    },
  ],
  gates: [
    {
      id: 'explore',
      title: 'Explore',
      description: 'Is this worth taking further?',
      decides_on: 'business_case',
      owner: { resolver: 'role', role: 'sponsor' },
      outcomes: ['approve', 'decline'],
      requires: { confirmed_facets: true, evaluations: ['sufficiency'], questions_resolved: true },
    },
  ],
  lifecycle: { phases: ['explore'], transitions: [] },
  evaluators: [{ id: 'sufficiency', builtin: 'facet_schema' }],
});

const validator = new FacetValidator();
validator.register('business_case', schema);
const labels = labelsFor(def);

function readiness(draft: Parameters<typeof draftReadiness>[0]['draft'], typeId = 'business_case') {
  return draftReadiness({
    draft,
    type: typeIn(def, typeId)!,
    schema,
    issues: validator.check(typeId, draft.facets),
    def,
    labels,
  });
}

describe('draftReadiness', () => {
  it('turns missing required facets into the questions the schema asks, in schema order', () => {
    const r = readiness({ type: 'business_case', facets: {}, provenance: {}, links: [] });
    expect(r.proposable).toBe(false);
    expect(r.blockers.filter((b) => b.kind === 'facet_missing').map((b) => [b.label, b.description])).toEqual(
      [
        ['Declared outcome', 'What gets better, by how much, from what baseline?'],
        ['Who benefits', 'The role, and roughly how many of them.'],
        ['Consequence class', undefined],
      ],
    );
    expect(r.blockers.find((b) => b.kind === 'classification_missing')!.label).toBe('Data classification');
  });

  it('reports an invalid nested value against its top-level facet, in words', () => {
    const r = readiness({
      type: 'business_case',
      facets: {
        declared_outcome: { statement: 'short', baseline: 1 },
        beneficiary: {},
        consequence_class: 'c9',
      },
      provenance: {},
      links: [],
      classification: { lawful_basis: 'contract', retention: '7y', personal_data: false },
    });
    const invalid = r.blockers.filter((b) => b.kind === 'facet_invalid');
    expect(invalid.map((b) => b.field)).toEqual(['declared_outcome', 'consequence_class']);
    expect(invalid[0]!.detail).toMatch(/declared_outcome\.statement must NOT have fewer than 10 characters/);
    expect(r.proposable).toBe(false);
  });

  it('separates what stops propose from what the gate will refuse', () => {
    const r = readiness({
      type: 'business_case',
      facets: {
        declared_outcome: { statement: 'Faster planning', baseline: 14 },
        beneficiary: {},
        consequence_class: 'c2',
      },
      provenance: {
        declared_outcome: { source: 'extracted', by: 'prn-agent', at: 't' },
        beneficiary: { source: 'declared', by: 'prn-human', at: 't' },
      },
      links: [],
      classification: { lawful_basis: 'contract', retention: '7y', personal_data: false },
    });
    // Proposable — the schema is satisfied and the classification is there…
    expect(r.proposable).toBe(true);
    // …but the gate will refuse an unconfirmed extraction and an unattributed facet.
    expect(r.blockers.map((b) => [b.kind, b.field])).toEqual([
      ['facet_unconfirmed', 'declared_outcome'],
      ['facet_unattributed', 'consequence_class'],
    ]);
    expect(r.gates).toEqual([
      {
        gate: 'explore',
        title: 'Explore',
        description: 'Is this worth taking further?',
        requirements: [
          'Every facet confirmed by a person.',
          'The "Sufficiency" check, which reads the facets against this type\'s schema — it runs when you propose.',
          'Every question on the version answered and closed.',
        ],
      },
    ]);
  });

  it('names a missing pinned link in the workspace’s own words', () => {
    const r = readiness({ type: 'specification', facets: {}, provenance: {}, links: [] }, 'specification');
    const link = r.blockers.find((b) => b.kind === 'link_missing')!;
    expect(link.label).toBe('Justified by');
    expect(link.detail).toMatch(/A specification must say which business case it rests on/);
  });
});

describe('facetSchemaEvaluation', () => {
  it('reports one finding per required facet, met or unmet, with the schema’s question', () => {
    const facets = {
      declared_outcome: { statement: 'Faster planning', baseline: 14 },
      consequence_class: 'c2',
    };
    const { verdict, findings } = facetSchemaEvaluation(
      schema,
      facets,
      validator.check('business_case', facets),
    );
    expect(verdict).toBe('fail');
    expect(findings).toEqual([
      {
        standard: 'schema:declared_outcome',
        outcome: 'met',
        detail: 'Declared outcome — What gets better, by how much, from what baseline?: answered.',
      },
      {
        standard: 'schema:beneficiary',
        outcome: 'unmet',
        detail: 'Who benefits — The role, and roughly how many of them.: not answered.',
      },
      { standard: 'schema:consequence_class', outcome: 'met', detail: 'Consequence class: answered.' },
    ]);
  });

  it('passes when every required facet is present and valid', () => {
    const facets = {
      declared_outcome: { statement: 'Faster planning', baseline: 14 },
      beneficiary: {},
      consequence_class: 'c2',
    };
    const { verdict } = facetSchemaEvaluation(schema, facets, validator.check('business_case', facets));
    expect(verdict).toBe('pass');
  });
});

describe('resolveEndpoint', () => {
  it('substitutes environment variables and names the first one that is unset', () => {
    expect(resolveEndpoint('${EVALUATOR_BASE}/conformance', { EVALUATOR_BASE: 'http://eval:9000' })).toEqual({
      resolved: true,
      url: 'http://eval:9000/conformance',
    });
    expect(resolveEndpoint('${EVALUATOR_BASE}/conformance', {})).toEqual({
      resolved: false,
      missing: 'EVALUATOR_BASE',
    });
    expect(resolveEndpoint('http://fixed.example/x', {})).toEqual({
      resolved: true,
      url: 'http://fixed.example/x',
    });
  });
});

describe('evaluator declarations', () => {
  it('refuse an evaluator that is both an endpoint and a builtin, or neither', () => {
    const base = {
      workspace: 'ws-test',
      definition_version: 1,
      types: [{ id: 't', facet_schema: './t.json', links: [] }],
      attribution_profiles: [
        {
          id: 'default',
          required: ['accountable'],
          rules: { accountable: { must_resolve_to: 'principal', kind: 'human' } },
        },
      ],
      lifecycle: { phases: ['p'], transitions: [] },
    };
    expect(() =>
      parseWorkspaceDefinition({
        ...base,
        evaluators: [{ id: 'both', endpoint: 'http://x', builtin: 'facet_schema' }],
      }),
    ).toThrow(/either an `endpoint` or a `builtin`/);
    expect(() => parseWorkspaceDefinition({ ...base, evaluators: [{ id: 'neither' }] })).toThrow(
      /either an `endpoint` or a `builtin`/,
    );
  });
});
