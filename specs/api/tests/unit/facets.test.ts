import { beforeEach, describe, expect, it } from 'vitest';
import {
  FacetValidator,
  confirmFacet,
  facetsMissingProvenance,
  gateReadiness,
  invalidateConfirmations,
  unconfirmedExtractions,
} from '../../src/domain/facets.js';
import type { ProvenanceMap } from '../../src/domain/types.js';

const schema = {
  type: 'object',
  required: ['declared_outcome', 'consequence_class'],
  properties: {
    declared_outcome: {
      type: 'object',
      required: ['statement', 'baseline', 'target', 'unit'],
      properties: {
        statement: { type: 'string', minLength: 1 },
        baseline: { type: 'number' },
        target: { type: 'number' },
        unit: { type: 'string' },
      },
    },
    consequence_class: { enum: ['c1', 'c2', 'c3', 'c4'] },
  },
};

const valid = {
  declared_outcome: { statement: 'Sneller een materiaalstaat', baseline: 14.2, target: 8, unit: 'days' },
  consequence_class: 'c3',
};

describe('FacetValidator', () => {
  let validator: FacetValidator;
  beforeEach(() => {
    validator = new FacetValidator();
    validator.register('business_case', schema);
  });

  it('accepts a facet set that satisfies the schema', () => {
    expect(validator.check('business_case', valid)).toEqual([]);
  });

  it('names the failing path rather than saying the set is invalid', () => {
    const issues = validator.check('business_case', {
      ...valid,
      declared_outcome: { statement: 'x', baseline: 'fourteen', target: 8, unit: 'days' },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe('declared_outcome.baseline');
    expect(issues[0]!.rule).toBe('type');
  });

  it('names a missing required field by its full path', () => {
    const issues = validator.check('business_case', { consequence_class: 'c3' });
    expect(issues.map((i) => i.path)).toContain('declared_outcome');
    expect(issues[0]!.message).toBe('is required');
  });

  it('reports every failure at once, so one fix does not reveal the next', () => {
    const issues = validator.check('business_case', { consequence_class: 'c9' });
    expect(issues.length).toBeGreaterThan(1);
  });

  it('refuses a type with no registered schema rather than passing it', () => {
    const issues = validator.check('unknown_type', valid);
    expect(issues[0]!.rule).toBe('schema');
  });

  it('throws with the path named when asserting', () => {
    expect(() => validator.assert('business_case', {})).toThrow(/declared_outcome: is required/);
  });
});

describe('provenance', () => {
  const provenance: ProvenanceMap = {
    declared_outcome: { source: 'extracted', by: 'prn-agent-3', at: '2026-08-01T00:00:00Z' },
    consequence_class: { source: 'declared', by: 'prn-visser', at: '2026-08-01T00:00:00Z' },
  };

  it('lists extractions no human has confirmed', () => {
    expect(unconfirmedExtractions(provenance)).toEqual(['declared_outcome']);
  });

  it('treats a confirmed extraction as settled', () => {
    const confirmed = confirmFacet(provenance, 'declared_outcome', 'prn-dekker', '2026-08-02T00:00:00Z');
    expect(unconfirmedExtractions(confirmed)).toEqual([]);
    expect(confirmed.declared_outcome!.confirmed_by).toBe('prn-dekker');
  });

  it('refuses to confirm a declared facet, which needs no confirmation', () => {
    expect(() => confirmFacet(provenance, 'consequence_class', 'prn-dekker', 'now')).toThrow(
      /only an extracted/,
    );
  });

  it('refuses to confirm a facet carrying no provenance', () => {
    expect(() => confirmFacet(provenance, 'nothing', 'prn-dekker', 'now')).toThrow(/no provenance/);
  });

  it('finds facets nobody claims', () => {
    expect(facetsMissingProvenance({ ...valid, orphan: 1 }, provenance)).toEqual(['orphan']);
  });

  it('voids a confirmation when the value it confirmed changes', () => {
    const confirmed = confirmFacet(provenance, 'declared_outcome', 'prn-dekker', 'now');
    const after = invalidateConfirmations(
      valid,
      { ...valid, declared_outcome: { ...valid.declared_outcome, target: 6 } },
      confirmed,
    );
    expect(after.declared_outcome!.confirmed_by).toBeUndefined();
    expect(unconfirmedExtractions(after)).toEqual(['declared_outcome']);
  });

  it('keeps a confirmation when an unrelated facet changes', () => {
    const confirmed = confirmFacet(provenance, 'declared_outcome', 'prn-dekker', 'now');
    const after = invalidateConfirmations(valid, { ...valid, consequence_class: 'c4' }, confirmed);
    expect(after.declared_outcome!.confirmed_by).toBe('prn-dekker');
  });

  it('reports gate readiness with the reasons, not a boolean', () => {
    const readiness = gateReadiness({ ...valid, orphan: 1 }, provenance);
    expect(readiness.ready).toBe(false);
    expect(readiness.unconfirmed).toEqual(['declared_outcome']);
    expect(readiness.unattributed).toEqual(['orphan']);
  });
});
