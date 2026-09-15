import { describe, expect, it } from 'vitest';
import { consequencesOf } from '../../src/domain/consequences.js';
import { labelsFor } from '../../src/domain/labels.js';
import {
  acceptingOutcome,
  parseWorkspaceDefinition,
  gateIn,
  typeIn,
} from '../../src/domain/workspace-definition.js';

const def = parseWorkspaceDefinition({
  workspace: 'ws-test',
  definition_version: 1,
  types: [
    { id: 'business_case', title: 'Business case', facet_schema: './bc.json', links: [] },
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
      required: ['accountable', 'acting'],
      rules: { accountable: { must_resolve_to: 'principal', kind: 'human' } },
    },
  ],
  gates: [
    {
      id: 'specification_gate',
      title: 'Specification',
      decides_on: 'specification',
      owner: { resolver: 'role', role: 'owner' },
      outcomes: ['approve', 'request_changes', 'decline'],
      outcome_labels: { approve: 'Approve for build', request_changes: 'Ask for changes' },
      reopens_on: 'request_changes',
    },
  ],
  lifecycle: {
    phases: ['prove', 'build', 'closed'],
    phase_labels: { prove: 'Proving', build: 'Building' },
    transitions: [
      { from: 'prove', to: 'build', via_gate: 'specification_gate', on: 'approve' },
      { from: 'prove', to: 'closed', via_gate: 'specification_gate', on: 'decline' },
    ],
  },
});

const labels = labelsFor(def);
const gate = gateIn(def, 'specification_gate')!;
const type = typeIn(def, 'specification')!;

function outcomes(overrides: Partial<Parameters<typeof consequencesOf>[0]> = {}) {
  return consequencesOf({
    def,
    gate,
    type,
    labels,
    version: { ordinal: 2, links: [{ type: 'justified_by', target: 'art-case' }] },
    artifact: { phase: 'prove', accepted_ordinal: 1 },
    acceptedByArtifact: new Map([['art-case', 3]]),
    targetTitles: new Map([['art-case', 'Materiaalstaat-generator']]),
    ...overrides,
  });
}

describe('consequencesOf', () => {
  it('spells out acceptance: what becomes current, what is superseded, what freezes, where it moves', () => {
    const approve = outcomes().find((o) => o.outcome === 'approve')!;
    expect(approve.label).toBe('Approve for build');
    expect(approve.accepts).toBe(true);
    expect(approve.effects).toEqual([
      'Version @2 becomes the accepted specification.',
      'Version @1 stops being current. It is superseded, not deleted — it stays readable.',
      '"Justified by" freezes to Materiaalstaat-generator @3, and reads against that version however often Materiaalstaat-generator changes afterwards.',
      'The specification moves from Proving to Building.',
    ]);
    expect(approve.blocked).toBeUndefined();
  });

  it('warns when acceptance would be refused because a pin has nothing to freeze to', () => {
    const approve = outcomes({ acceptedByArtifact: new Map() }).find((o) => o.outcome === 'approve')!;
    expect(approve.blocked).toMatch(/no accepted version yet/);
    expect(approve.effects.some((e) => e.includes('freezes'))).toBe(false);
  });

  it('describes a reopen as a new draft carrying the reasoning, with nothing erased', () => {
    const changes = outcomes().find((o) => o.outcome === 'request_changes')!;
    expect(changes.label).toBe('Ask for changes');
    expect(changes.reopens).toBe(true);
    expect(changes.effects[0]).toMatch(/new draft opens, based on @2/);
    expect(changes.effects[1]).toMatch(/Nothing is erased/);
    // No transition declared for request_changes, so no phase line.
    expect(changes.effects).toHaveLength(2);
  });

  it('describes a refusal as staying in the record, and names the phase it moves to', () => {
    const decline = outcomes().find((o) => o.outcome === 'decline')!;
    expect(decline.accepts).toBe(false);
    expect(decline.effects).toEqual([
      'Version @2 is not accepted and stays in the record with your reasoning. Nothing else changes.',
      'The specification moves from Proving to Closed.',
    ]);
  });

  it('never leaks an identifier: every effect is a sentence a sponsor can read', () => {
    for (const outcome of outcomes()) {
      for (const effect of outcome.effects) {
        expect(effect).not.toMatch(/[a-z]+_[a-z]+/);
        expect(effect).toMatch(/\.$/);
      }
    }
  });
});

describe('acceptingOutcome', () => {
  it('prefers the declared outcome over the approve/accept convention', () => {
    expect(acceptingOutcome({ outcomes: ['approve', 'decline'] })).toBe('approve');
    expect(acceptingOutcome({ outcomes: ['accept', 'reject'] })).toBe('accept');
    expect(acceptingOutcome({ outcomes: ['publish', 'withdraw'], accepts_on: 'publish' })).toBe('publish');
    expect(acceptingOutcome({ outcomes: ['publish', 'withdraw'] })).toBeUndefined();
  });

  it('refuses a gate that could never accept anything, naming the fix', () => {
    expect(() =>
      parseWorkspaceDefinition({
        workspace: 'ws-test',
        definition_version: 1,
        types: [{ id: 'standard', facet_schema: './s.json', links: [] }],
        attribution_profiles: [
          {
            id: 'default',
            required: ['accountable'],
            rules: { accountable: { must_resolve_to: 'principal', kind: 'human' } },
          },
        ],
        gates: [
          {
            id: 'publication',
            decides_on: 'standard',
            owner: { resolver: 'role', role: 'owner' },
            outcomes: ['publish', 'request_changes', 'withdraw'],
          },
        ],
        lifecycle: { phases: ['drafting'], transitions: [] },
      }),
    ).toThrow(/gates\.0\.accepts_on: gate `publication` has no accepting outcome/);
  });

  it('refuses an accepts_on that is not an outcome, or that also reopens', () => {
    const base = {
      workspace: 'ws-test',
      definition_version: 1,
      types: [{ id: 'standard', facet_schema: './s.json', links: [] }],
      attribution_profiles: [
        {
          id: 'default',
          required: ['accountable'],
          rules: { accountable: { must_resolve_to: 'principal', kind: 'human' } },
        },
      ],
      lifecycle: { phases: ['drafting'], transitions: [] },
    };
    const gateWith = (extra: Record<string, unknown>) => ({
      id: 'publication',
      decides_on: 'standard',
      owner: { resolver: 'role', role: 'owner' },
      outcomes: ['publish', 'request_changes'],
      ...extra,
    });
    expect(() => parseWorkspaceDefinition({ ...base, gates: [gateWith({ accepts_on: 'approve' })] })).toThrow(
      /accepts_on: `approve` is not one of this gate's outcomes/,
    );
    expect(() =>
      parseWorkspaceDefinition({
        ...base,
        gates: [gateWith({ accepts_on: 'request_changes', reopens_on: 'request_changes' })],
      }),
    ).toThrow(/cannot both accept and reopen/);
  });
});
