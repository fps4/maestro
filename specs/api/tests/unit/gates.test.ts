import { describe, expect, it } from 'vitest';
import { gateIsOpen, gateRequirements, mayDecide, type GateInput } from '../../src/domain/gates.js';
import { assertAttribution, checkAttribution, AttributionRefused } from '../../src/domain/attribution.js';
import type { GateDeclaration, AttributionProfile } from '../../src/domain/workspace-definition.js';
import type { EvaluationResult, Principal } from '../../src/domain/types.js';

const gate: GateDeclaration = {
  id: 'explore',
  decides_on: 'business_case',
  owner: { resolver: 'role', role: 'sponsor' },
  outcomes: ['approve', 'request_changes', 'decline'],
  outcome_labels: {},
  reopens_on: 'request_changes',
  blocking: true,
  requires: {
    confirmed_facets: true,
    evaluations: ['sufficiency_v2'],
    catalogue_acceptances: false,
    questions_resolved: false,
  },
  separation_of_duties: 'exclude_creator',
  attribution_profile: 'default',
  records_materiality: false,
};

const digest = 'sha256:abc';

const passingEvaluation: EvaluationResult = {
  evaluator: 'sufficiency_v2',
  artifact: 'art-4417',
  ordinal: 7,
  verdict: 'pass',
  recorded_at: '2026-08-04T09:20:00Z',
  subject_digest: digest,
};

const ready: GateInput = {
  gate,
  facets: { consequence_class: 'c3' },
  provenance: { consequence_class: { source: 'declared', by: 'prn-visser', at: 't' } },
  evaluations: [passingEvaluation],
  subject_digest: digest,
  acceptances: [],
  open_questions: 0,
};

describe('gateRequirements', () => {
  it('opens when every declared requirement is satisfied', () => {
    const requirements = gateRequirements(ready);
    expect(gateIsOpen(requirements)).toBe(true);
    expect(requirements.map((r) => r.id)).toEqual(['confirmed_facets', 'evaluation:sufficiency_v2']);
  });

  it('holds shut on an unconfirmed extraction, and names the facet', () => {
    const requirements = gateRequirements({
      ...ready,
      facets: { ...ready.facets, beneficiary: {} },
      provenance: {
        ...ready.provenance,
        beneficiary: { source: 'extracted', by: 'prn-agent-3', at: 't' },
      },
    });
    expect(gateIsOpen(requirements)).toBe(false);
    expect(requirements[0]!.detail).toContain('beneficiary');
  });

  it('refuses a verdict recorded against different bytes', () => {
    // A passing evaluation must not survive an edit it never saw.
    const requirements = gateRequirements({
      ...ready,
      evaluations: [{ ...passingEvaluation, subject_digest: 'sha256:something-else' }],
    });
    expect(gateIsOpen(requirements)).toBe(false);
    expect(requirements[1]!.detail).toMatch(/no verdict has been recorded/);
  });

  it('accepts a not_applicable verdict as satisfying the requirement', () => {
    const requirements = gateRequirements({
      ...ready,
      evaluations: [{ ...passingEvaluation, verdict: 'not_applicable' }],
    });
    expect(gateIsOpen(requirements)).toBe(true);
  });

  it('reports a lapsed acceptance without blocking, when the gate does not require it', () => {
    const requirements = gateRequirements({
      ...ready,
      acceptances: [{ standard: 'NL-WKA-VERKLARING-001', status: 'lapsed', pack_version: '3.1.0' }],
    });
    const acceptance = requirements.find((r) => r.id === 'catalogue_acceptances')!;
    expect(acceptance.satisfied).toBe(false);
    expect(acceptance.blocking).toBe(false);
    expect(gateIsOpen(requirements)).toBe(true);
    expect(acceptance.detail).toContain('3.1.0');
  });

  it('blocks on a lapsed acceptance when the gate declares it', () => {
    const requirements = gateRequirements({
      ...ready,
      gate: { ...gate, requires: { ...gate.requires, catalogue_acceptances: true } },
      acceptances: [{ standard: 'NL-WKA-VERKLARING-001', status: 'lapsed' }],
    });
    expect(gateIsOpen(requirements)).toBe(false);
  });
});

const human: Principal = { id: 'prn-dekker', kind: 'human', display_name: 'Jan Dekker' };
const agent: Principal = { id: 'prn-agent-3', kind: 'agent', display_name: 'case-shaper' };

const decider = {
  gate,
  decider: human,
  roles: ['sponsor'],
  routed: [],
  assigned: [],
  proposed_by: 'prn-visser',
  created_by: 'prn-visser',
};

describe('mayDecide', () => {
  it('admits the role the gate names', () => {
    expect(mayDecide(decider).allowed).toBe(true);
  });

  it('refuses an agent before resolving anything else', () => {
    const verdict = mayDecide({ ...decider, decider: agent, roles: ['sponsor'] });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/Only a named human decides/);
  });

  it('refuses someone without the role, and says which role', () => {
    const verdict = mayDecide({ ...decider, roles: ['author'] });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('sponsor');
  });

  it('refuses the creator where exclude_creator is declared', () => {
    const verdict = mayDecide({ ...decider, created_by: 'prn-dekker' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/exclude_creator/);
  });

  it('admits the creator where the gate declares no separation of duties', () => {
    const { separation_of_duties: _omitted, ...withoutSod } = gate;
    const verdict = mayDecide({ ...decider, gate: withoutSod as GateDeclaration, created_by: 'prn-dekker' });
    expect(verdict.allowed).toBe(true);
  });

  it('resolves through a routing table', () => {
    const routed = {
      ...decider,
      gate: {
        ...gate,
        owner: { resolver: 'routing_table' as const, table: './reviewers.yaml', key: 'sponsor' },
      },
      roles: [],
      routed: ['prn-dekker'],
    };
    expect(mayDecide(routed).allowed).toBe(true);
    expect(mayDecide({ ...routed, routed: ['prn-other'] }).allowed).toBe(false);
  });

  it('resolves through an explicit assignment', () => {
    const assigned = {
      ...decider,
      gate: { ...gate, owner: { resolver: 'assignment' as const } },
      roles: [],
      assigned: ['prn-dekker'],
    };
    expect(mayDecide(assigned).allowed).toBe(true);
    expect(mayDecide({ ...assigned, assigned: [] }).allowed).toBe(false);
  });

  // An id this service minted before it read identity-service's `prn` names the same person as the
  // `prn` that superseded it (ADR-0022): the record keeps the old id, and the rules still see through it.
  describe('a principal that supersedes an older id', () => {
    const adopted: Principal = { ...human, id: 'prn-h-identity', supersedes: ['prn-dekker'] };

    it('is still the creator separation of duties excludes', () => {
      const verdict = mayDecide({ ...decider, decider: adopted, created_by: 'prn-dekker' });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/exclude_creator/);
    });

    it('is still the proposer exclude_proposer excludes', () => {
      const verdict = mayDecide({
        ...decider,
        gate: { ...gate, separation_of_duties: 'exclude_proposer' },
        decider: adopted,
        proposed_by: 'prn-dekker',
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/exclude_proposer/);
    });

    it('is still the one a routing table or an assignment names by the old id', () => {
      const routed = {
        ...decider,
        decider: adopted,
        gate: {
          ...gate,
          owner: { resolver: 'routing_table' as const, table: './reviewers.yaml', key: 'sponsor' },
        },
        roles: [],
        routed: ['prn-dekker'],
      };
      expect(mayDecide(routed).allowed).toBe(true);
      const assigned = {
        ...decider,
        decider: adopted,
        gate: { ...gate, owner: { resolver: 'assignment' as const } },
        roles: [],
        assigned: ['prn-dekker'],
      };
      expect(mayDecide(assigned).allowed).toBe(true);
    });
  });
});

const profile: AttributionProfile = {
  id: 'default',
  required: ['accountable', 'acting'],
  rules: {
    accountable: { must_resolve_to: 'principal', kind: 'human' },
    acting: { must_resolve_to: 'principal' },
  },
  optional: ['seat', 'oversight_level'],
  field_labels: {},
};

const directory = new Map([
  [human.id, human],
  [agent.id, agent],
]);
const resolve = (id: string) => directory.get(id);

describe('attribution', () => {
  it('accepts a decision naming a human as accountable', () => {
    expect(checkAttribution(profile, { accountable: 'prn-dekker', acting: 'prn-dekker' }, resolve)).toEqual(
      [],
    );
  });

  it('permits an agent as acting, which is the point of separating the two fields', () => {
    expect(checkAttribution(profile, { accountable: 'prn-dekker', acting: 'prn-agent-3' }, resolve)).toEqual(
      [],
    );
  });

  it('refuses a decision naming an agent as accountable', () => {
    const issues = checkAttribution(profile, { accountable: 'prn-agent-3', acting: 'prn-agent-3' }, resolve);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/an agent can never be answerable/);
  });

  it('refuses a decision missing a required field', () => {
    const issues = checkAttribution(profile, { accountable: 'prn-dekker' } as never, resolve);
    expect(issues.map((i) => i.field)).toContain('acting');
  });

  it('refuses a field naming an unknown principal', () => {
    const issues = checkAttribution(profile, { accountable: 'prn-ghost', acting: 'prn-dekker' }, resolve);
    expect(issues[0]!.message).toMatch(/does not/);
  });

  it('records extra context rather than discarding it', () => {
    const issues = checkAttribution(
      profile,
      { accountable: 'prn-dekker', acting: 'prn-dekker', seat: 'sponsor', unexpected: 'kept' },
      resolve,
    );
    expect(issues).toEqual([]);
  });

  it('throws with every issue when asserting', () => {
    expect(() =>
      assertAttribution(profile, { accountable: 'prn-agent-3', acting: 'prn-agent-3' }, resolve),
    ).toThrow(AttributionRefused);
  });
});

describe('questions_resolved', () => {
  it('holds the gate shut while a question is open, only when the gate declares it', () => {
    const declared = { ...gate, requires: { ...gate.requires, questions_resolved: true } };
    const withOpen = gateRequirements({ ...ready, gate: declared, open_questions: 2 });
    const requirement = withOpen.find((r) => r.id === 'questions_resolved')!;
    expect(requirement.satisfied).toBe(false);
    expect(requirement.blocking).toBe(true);
    expect(requirement.detail).toMatch(/2 open questions/);
    expect(gateIsOpen(withOpen)).toBe(false);

    expect(gateIsOpen(gateRequirements({ ...ready, gate: declared, open_questions: 0 }))).toBe(true);

    // Undeclared: open questions are shown elsewhere and never block.
    const undeclared = gateRequirements({ ...ready, open_questions: 2 });
    expect(undeclared.find((r) => r.id === 'questions_resolved')).toBeUndefined();
    expect(gateIsOpen(undeclared)).toBe(true);
  });
});

describe('pinned_link', () => {
  it('holds the gate shut when the type declares a pin and the version carries none', () => {
    const missing = gateRequirements({
      ...ready,
      pinned_link: {
        type: 'justified_by',
        label: 'Justified by',
        target_label: 'business case',
        present: false,
      },
    });
    const requirement = missing.find((r) => r.id === 'pinned_link')!;
    expect(requirement.satisfied).toBe(false);
    expect(requirement.blocking).toBe(true);
    expect(requirement.title).toBe('Rests on a business case');
    expect(requirement.detail).toMatch(/nothing to freeze to/);
    expect(gateIsOpen(missing)).toBe(false);

    const present = gateRequirements({
      ...ready,
      pinned_link: {
        type: 'justified_by',
        label: 'Justified by',
        target_label: 'business case',
        present: true,
      },
    });
    expect(present.find((r) => r.id === 'pinned_link')!.satisfied).toBe(true);
    expect(gateIsOpen(present)).toBe(true);

    // A type with no pin declares no such requirement.
    expect(gateRequirements(ready).find((r) => r.id === 'pinned_link')).toBeUndefined();
  });
});
