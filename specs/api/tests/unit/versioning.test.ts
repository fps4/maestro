import { describe, expect, it } from 'vitest';
import {
  IllegalStateChange,
  ProposalRefused,
  StaleRevision,
  assertRevision,
  nextState,
  proposeVersion,
  recordContribution,
} from '../../src/domain/versioning.js';
import type { Draft } from '../../src/domain/types.js';

const draft: Draft = {
  id: 'dft-1',
  workspace: 'ws-aannemer-x',
  artifact: 'art-4417',
  type: 'business_case',
  title: 'Materiaalstaat-generator',
  revision: 23,
  facets: { consequence_class: 'c3' },
  provenance: { consequence_class: { source: 'declared', by: 'prn-visser', at: '2026-08-01T00:00:00Z' } },
  body: { format: 'markdown/v1', content: '## Scope' },
  attachments: [],
  links: [],
  contributors: [{ principal: 'prn-visser', kind: 'human', first: 'a', last: 'b' }],
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-04T00:00:00Z',
};

const proposeInput = {
  draft,
  ordinal: 7,
  definition_version: 3,
  proposed_by: 'prn-visser',
  at: '2026-08-04T09:14:22Z',
  body_ceiling_bytes: 1_048_576,
  classification_required: false,
};

describe('nextState', () => {
  it('accepts only from proposed, and only by a gate decision', () => {
    expect(nextState('proposed', { kind: 'gate_decision', outcome: 'accept', gate: 'explore' })).toBe(
      'accepted',
    );
  });

  it('refuses to accept a version that is already accepted', () => {
    expect(() =>
      nextState('accepted', { kind: 'gate_decision', outcome: 'accept', gate: 'explore' }),
    ).toThrow(IllegalStateChange);
  });

  it('treats request_changes and reject alike for the bytes that were refused', () => {
    expect(nextState('proposed', { kind: 'gate_decision', outcome: 'reject', gate: 'explore' })).toBe(
      'rejected',
    );
    expect(nextState('proposed', { kind: 'gate_decision', outcome: 'reopen', gate: 'explore' })).toBe(
      'rejected',
    );
  });

  it('supersedes only an accepted version', () => {
    expect(nextState('accepted', { kind: 'supersede', by_ordinal: 8 })).toBe('superseded');
    expect(() => nextState('proposed', { kind: 'supersede', by_ordinal: 8 })).toThrow(IllegalStateChange);
  });

  it('withdraws only before a decision', () => {
    expect(nextState('proposed', { kind: 'withdraw', by: 'prn-visser' })).toBe('withdrawn');
    expect(() => nextState('accepted', { kind: 'withdraw', by: 'prn-visser' })).toThrow(IllegalStateChange);
  });

  it('expires only an accepted version, and only through the system transition', () => {
    expect(nextState('accepted', { kind: 'system', reason: 're-verification overdue' })).toBe('expired');
    expect(() => nextState('proposed', { kind: 'system', reason: 'x' })).toThrow(IllegalStateChange);
  });

  it('refuses every move out of a terminal state', () => {
    for (const terminal of ['superseded', 'rejected', 'withdrawn'] as const) {
      expect(() => nextState(terminal, { kind: 'gate_decision', outcome: 'accept', gate: 'g' })).toThrow(
        /is terminal/,
      );
    }
  });
});

describe('proposeVersion', () => {
  it('snapshots a draft into a proposed version carrying a digest', () => {
    const version = proposeVersion(proposeInput);
    expect(version.state).toBe('proposed');
    expect(version.ordinal).toBe(7);
    expect(version.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(version.definition_version).toBe(3);
  });

  it('carries the draft contributors onto the version', () => {
    expect(proposeVersion(proposeInput).contributors).toEqual(draft.contributors);
  });

  it('refuses a facet that carries no provenance', () => {
    const input = { ...proposeInput, draft: { ...draft, facets: { ...draft.facets, orphan: 1 } } };
    expect(() => proposeVersion(input)).toThrow(ProposalRefused);
    expect(() => proposeVersion(input)).toThrow(/orphan/);
  });

  it('refuses a body over the inline ceiling, at propose rather than on read', () => {
    const big = { ...draft, body: { format: 'markdown/v1', content: 'x'.repeat(2000) } };
    expect(() => proposeVersion({ ...proposeInput, draft: big, body_ceiling_bytes: 1000 })).toThrow(
      /inline ceiling/,
    );
  });

  it('refuses an unclassified version where the type requires classification', () => {
    expect(() => proposeVersion({ ...proposeInput, classification_required: true })).toThrow(
      /unclassifiable/,
    );
  });

  it('refuses an untitled version', () => {
    expect(() => proposeVersion({ ...proposeInput, draft: { ...draft, title: '   ' } })).toThrow(/title/);
  });

  it('allows an unconfirmed extraction — that blocks a gate, not a proposal', () => {
    const withExtraction: Draft = {
      ...draft,
      facets: { ...draft.facets, beneficiary: { role: 'werkvoorbereider' } },
      provenance: {
        ...draft.provenance,
        beneficiary: { source: 'extracted', by: 'prn-agent-3', at: '2026-08-03T00:00:00Z' },
      },
    };
    expect(() => proposeVersion({ ...proposeInput, draft: withExtraction })).not.toThrow();
  });

  it('normalises an absent pin to null so the digest is stable', () => {
    const linked: Draft = { ...draft, links: [{ type: 'addresses', target: 'art-2201' }] };
    expect(proposeVersion({ ...proposeInput, draft: linked }).links[0]!.pinned_to).toBeNull();
  });
});

describe('recordContribution', () => {
  it('adds a new contributor with first and last set to the same instant', () => {
    const after = recordContribution([], 'prn-agent-3', 'agent', 't1');
    expect(after).toEqual([{ principal: 'prn-agent-3', kind: 'agent', first: 't1', last: 't1' }]);
  });

  it('accumulates rather than replacing, so both the agent and the human are on the record', () => {
    let contributors = recordContribution([], 'prn-agent-3', 'agent', 't1');
    contributors = recordContribution(contributors, 'prn-dekker', 'human', 't2');
    expect(contributors.map((c) => c.principal)).toEqual(['prn-agent-3', 'prn-dekker']);
  });

  it('moves `last` forward for a returning contributor without duplicating them', () => {
    let contributors = recordContribution([], 'prn-dekker', 'human', 't1');
    contributors = recordContribution(contributors, 'prn-dekker', 'human', 't9');
    expect(contributors).toHaveLength(1);
    expect(contributors[0]).toMatchObject({ first: 't1', last: 't9' });
  });
});

describe('assertRevision', () => {
  it('passes when the revision is current', () => {
    expect(() => assertRevision(23, 23)).not.toThrow();
  });

  it('refuses a stale save and says what the current revision is', () => {
    expect(() => assertRevision(22, 23)).toThrow(StaleRevision);
    expect(() => assertRevision(22, 23)).toThrow(/now at 23/);
  });
});
