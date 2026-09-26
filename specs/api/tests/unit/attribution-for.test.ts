import { describe, expect, it } from 'vitest';
import { ActRefused, attributionFor } from '../../src/db/outbox.js';
import { parseWorkspaceDefinition } from '../../src/domain/workspace-definition.js';

/**
 * ADR-0019 §2, as a rule with no database behind it: who an act is answerable to, and at what
 * oversight level, from the actor and the seat.
 */
const def = parseWorkspaceDefinition({
  workspace: 'ws-test',
  definition_version: 1,
  consequence_class: 'c2',
  types: [{ id: 'business_case', facet_schema: './bc.json', links: [] }],
  attribution_profiles: [
    {
      id: 'default',
      required: ['accountable', 'acting'],
      rules: { accountable: { must_resolve_to: 'principal', kind: 'human' } },
    },
  ],
  lifecycle: { phases: ['explore'], initial: 'explore', transitions: [] },
});

const human = { principal: 'prn-h-jdekker', kind: 'human' as const, roles: ['author', 'reviewer'] };
const agent = {
  principal: 'prn-a-drafter',
  kind: 'agent' as const,
  roles: ['author'],
  accountable: 'prn-h-jdekker',
};
const orphan = { principal: 'prn-a-stray', kind: 'agent' as const, roles: ['author'] };

describe('attributionFor', () => {
  it('a human answers for their own act, at the seat’s level', () => {
    expect(attributionFor(human, 'author', def)).toEqual({
      accountable: 'prn-h-jdekker',
      acting: 'prn-h-jdekker',
      seat: 'author',
      oversight_level: 'O1',
    });
    expect(attributionFor(human, 'decider', def).oversight_level).toBe('O0');
  });

  it('an agent answers to the human its membership names', () => {
    expect(attributionFor(agent, 'author', def)).toEqual({
      accountable: 'prn-h-jdekker',
      acting: 'prn-a-drafter',
      seat: 'author',
      oversight_level: 'O1',
    });
  });

  it('an agent with no answerable human cannot act', () => {
    expect(() => attributionFor(orphan, 'author', def)).toThrow(ActRefused);
    expect(() => attributionFor(orphan, 'author', def)).toThrow(/no answerable human/);
  });

  it('an agent cannot act in a human’s seat, whoever answers for it', () => {
    expect(() => attributionFor(agent, 'decider', def)).toThrow(/human's seat \(O0\)/);
  });

  it('a decision’s declared attribution wins for a human, within the seat', () => {
    const a = attributionFor(human, 'decider', def, { accountable: 'prn-h-mvries', acting: 'prn-h-jdekker' });
    expect(a).toEqual({
      accountable: 'prn-h-mvries',
      acting: 'prn-h-jdekker',
      seat: 'decider',
      oversight_level: 'O0',
    });
  });

  it('the definition refuses a decider seat above O0', () => {
    expect(() =>
      parseWorkspaceDefinition({
        workspace: 'ws-test',
        definition_version: 1,
        consequence_class: 'c2',
        seats: { decider: { oversight_level: 'O2' } },
        types: [{ id: 't', facet_schema: './t.json', links: [] }],
        attribution_profiles: [
          {
            id: 'd',
            required: ['accountable'],
            rules: { accountable: { must_resolve_to: 'principal', kind: 'human' } },
          },
        ],
        lifecycle: { phases: ['p'], initial: 'p', transitions: [] },
      }),
    ).toThrow(/decider seat is O0/);
  });
});
