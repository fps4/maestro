import { describe, expect, it } from 'vitest';
import { humanise, labelsFor } from '../../src/domain/labels.js';
import { parseWorkspaceDefinition } from '../../src/domain/workspace-definition.js';

/** The smallest definition that parses, with one of everything a label can attach to. */
function definition(overrides: Record<string, unknown> = {}) {
  return parseWorkspaceDefinition({
    workspace: 'ws-test',
    definition_version: 1,
    consequence_class: 'c2',
    types: [
      {
        id: 'business_case',
        title: 'Business case',
        description: 'Is it worth solving, and do we know enough?',
        facet_schema: './schemas/business-case.json',
        links: [{ id: 'addresses', to: 'opportunity', label: 'Addresses the opportunity' }],
      },
      { id: 'opportunity', facet_schema: './schemas/opportunity.json', links: [] },
    ],
    attribution_profiles: [
      {
        id: 'default',
        required: ['accountable', 'acting', 'oversight_level'],
        rules: { accountable: { must_resolve_to: 'principal', kind: 'human' } },
        field_labels: { oversight_level: 'Oversight level' },
      },
    ],
    gates: [
      {
        id: 'explore',
        title: 'Explore',
        description: 'Is this worth taking further?',
        decides_on: 'business_case',
        owner: { resolver: 'role', role: 'sponsor' },
        outcomes: ['approve', 'request_changes', 'decline'],
        outcome_labels: { request_changes: 'Ask for changes' },
      },
    ],
    lifecycle: {
      phases: ['explore', 'prove', 'closed'],
      phase_labels: { explore: 'Exploring' },
      transitions: [{ from: 'explore', to: 'prove', via_gate: 'explore', on: 'approve' }],
    },
    ...overrides,
  });
}

describe('humanise', () => {
  it('turns an identifier into a capitalised phrase', () => {
    expect(humanise('request_changes')).toBe('Request changes');
    expect(humanise('oversight-level')).toBe('Oversight level');
    expect(humanise('approve')).toBe('Approve');
  });
});

describe('labelsFor', () => {
  it('prefers a declared label and falls back to the humanised id everywhere else', () => {
    const labels = labelsFor(definition());

    expect(labels.types.business_case).toEqual({
      title: 'Business case',
      description: 'Is it worth solving, and do we know enough?',
    });
    expect(labels.types.opportunity).toEqual({ title: 'Opportunity' });

    expect(labels.gates.explore!.title).toBe('Explore');
    expect(labels.gates.explore!.description).toBe('Is this worth taking further?');
    expect(labels.gates.explore!.outcomes).toEqual({
      approve: 'Approve',
      request_changes: 'Ask for changes',
      decline: 'Decline',
    });

    expect(labels.phases).toEqual({ explore: 'Exploring', prove: 'Prove', closed: 'Closed' });
    expect(labels.links).toEqual({ addresses: 'Addresses the opportunity' });
    expect(labels.attribution).toEqual({
      accountable: 'Accountable',
      acting: 'Acting',
      oversight_level: 'Oversight level',
    });
  });

  it('never leaves an identifier without a label', () => {
    const def = definition();
    const labels = labelsFor(def);
    for (const type of def.types) expect(labels.types[type.id]?.title).toBeTruthy();
    for (const gate of def.gates) {
      expect(labels.gates[gate.id]?.title).toBeTruthy();
      for (const outcome of gate.outcomes) expect(labels.gates[gate.id]?.outcomes[outcome]).toBeTruthy();
    }
    for (const phase of def.lifecycle.phases) expect(labels.phases[phase]).toBeTruthy();
  });
});

describe('label validation', () => {
  it('refuses a label for an outcome the gate cannot produce, naming the path', () => {
    expect(() =>
      definition({
        gates: [
          {
            id: 'explore',
            decides_on: 'business_case',
            owner: { resolver: 'role', role: 'sponsor' },
            outcomes: ['approve'],
            outcome_labels: { aprove: 'Approve' },
          },
        ],
      }),
    ).toThrow(/gates\.0\.outcome_labels\.aprove/);
  });

  it('refuses a label for an undeclared phase', () => {
    expect(() =>
      definition({
        lifecycle: {
          phases: ['explore'],
          phase_labels: { exploring: 'Exploring' },
          transitions: [],
        },
        gates: [],
      }),
    ).toThrow(/lifecycle\.phase_labels\.exploring/);
  });

  it('refuses a label for a field the profile does not carry', () => {
    expect(() =>
      definition({
        attribution_profiles: [
          {
            id: 'default',
            required: ['accountable', 'acting'],
            rules: { accountable: { must_resolve_to: 'principal', kind: 'human' } },
            field_labels: { seat: 'Seat' },
          },
        ],
      }),
    ).toThrow(/attribution_profiles\.0\.field_labels\.seat/);
  });
});
