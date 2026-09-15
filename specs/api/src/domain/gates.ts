/**
 * Gates — what must be true before a decision can be taken, and who may take it.
 *
 * The service resolves who *may* decide and refuses everyone else. **It never decides** (ADR-0005).
 *
 * Every check returns a reason rather than a boolean, because the console renders these as a
 * checklist a reviewer reads before acting. "You cannot decide this" is not an answer; "you
 * proposed this version, and this gate declares exclude_creator" is.
 */

import { gateReadiness } from './facets.js';
import type { EvaluationResult, Facets, Principal, PrincipalId, ProvenanceMap } from './types.js';
import type { GateDeclaration } from './workspace-definition.js';

export interface Requirement {
  id: string;
  satisfied: boolean;
  title: string;
  detail: string;
  /** Advisory requirements are shown and recorded, but do not hold the gate shut. */
  blocking: boolean;
}

/** The state of a standard's acceptance, as far as a gate is concerned (ADR-0010). */
export interface AcceptanceState {
  standard: string;
  status: 'active' | 'lapsed' | 'absent' | 'overridden';
  accepted_by?: string;
  pack_version?: string;
}

export interface GateInput {
  gate: GateDeclaration;
  facets: Facets;
  provenance: ProvenanceMap;
  /** Verdicts recorded against this exact version's digest. */
  evaluations: EvaluationResult[];
  subject_digest: string;
  acceptances: AcceptanceState[];
  /** Questions asked of this version and not yet resolved by a human. */
  open_questions: number;
  /**
   * The pinned link the type declares, if any, and whether this version carries one. A pin that
   * points at nothing accepted is refused at acceptance; a version with no pin at all must not
   * slip past that refusal by having nothing to freeze.
   */
  pinned_link?: { type: string; label: string; target_label: string; present: boolean };
}

/**
 * Every requirement this gate declares, satisfied or not.
 *
 * Returned in full even when the gate is open, because the console shows the passing checks too —
 * a reviewer approving something is entitled to see what was verified on their behalf.
 */
export function gateRequirements(input: GateInput): Requirement[] {
  const { gate } = input;
  const requirements: Requirement[] = [];

  if (gate.requires.confirmed_facets) {
    const readiness = gateReadiness(input.facets, input.provenance);
    requirements.push({
      id: 'confirmed_facets',
      satisfied: readiness.ready,
      title: 'Every facet confirmed by a human',
      detail: readiness.ready
        ? 'No unconfirmed extraction and no unattributed facet.'
        : [
            readiness.unconfirmed.length
              ? `extracted and unconfirmed: ${readiness.unconfirmed.join(', ')}`
              : '',
            readiness.unattributed.length ? `no provenance: ${readiness.unattributed.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('; '),
      blocking: true,
    });
  }

  for (const evaluatorId of gate.requires.evaluations) {
    // A verdict against different bytes is not a verdict about this version. Matching on the digest
    // is what stops a passing evaluation from surviving an edit it never saw.
    const result = input.evaluations.find(
      (e) => e.evaluator === evaluatorId && e.subject_digest === input.subject_digest,
    );
    requirements.push({
      id: `evaluation:${evaluatorId}`,
      satisfied: result?.verdict === 'pass' || result?.verdict === 'not_applicable',
      title: `Evaluation \`${evaluatorId}\``,
      detail: !result
        ? 'no verdict has been recorded against this version'
        : result.verdict === 'pass'
          ? `passed, recorded ${result.recorded_at}`
          : result.verdict === 'not_applicable'
            ? 'not applicable to this version'
            : `failed, recorded ${result.recorded_at}`,
      blocking: true,
    });
  }

  if (input.pinned_link) {
    const { label, target_label, present } = input.pinned_link;
    requirements.push({
      id: 'pinned_link',
      satisfied: present,
      title: `Rests on a ${target_label}`,
      detail: present
        ? `"${label}" is declared, and freezes to the accepted version at acceptance.`
        : `No "${label}" link. Acceptance would have nothing to freeze to, so this version cannot be accepted until it says which ${target_label} it rests on.`,
      blocking: true,
    });
  }

  if (gate.requires.questions_resolved) {
    const n = input.open_questions;
    requirements.push({
      id: 'questions_resolved',
      satisfied: n === 0,
      title: 'Every question on this version answered and closed',
      detail:
        n === 0
          ? 'No open questions.'
          : `${n} open question${n === 1 ? '' : 's'}. Answer them, or the asker closes them, before this gate opens.`,
      blocking: true,
    });
  }

  // Acceptance state is reported whether or not the gate blocks on it. A lapsed acceptance that
  // does not block *this* gate still belongs on the decision record, so the reviewer's knowledge
  // of it is part of what they decided.
  const lapsed = input.acceptances.filter((a) => a.status === 'lapsed' || a.status === 'absent');
  if (input.acceptances.length > 0) {
    requirements.push({
      id: 'catalogue_acceptances',
      satisfied: lapsed.length === 0,
      title: 'Every referenced standard is accepted and current',
      detail:
        lapsed.length === 0
          ? `${input.acceptances.length} referenced, all active`
          : lapsed
              .map((a) =>
                a.status === 'lapsed'
                  ? `${a.standard}: accepted at pack ${a.pack_version ?? '(unknown)'}, lapsed on a material change`
                  : `${a.standard}: never accepted by this workspace`,
              )
              .join('; '),
      blocking: gate.requires.catalogue_acceptances,
    });
  }

  return requirements;
}

export function gateIsOpen(requirements: Requirement[]): boolean {
  return requirements.every((r) => r.satisfied || !r.blocking);
}

export interface DeciderInput {
  gate: GateDeclaration;
  decider: Principal;
  /** Roles the decider carries in this workspace, from the token and the membership record. */
  roles: string[];
  /** For `resolver: routing_table` — the principals or roles the table names for this key. */
  routed: string[];
  /** For `resolver: assignment` — principals explicitly assigned to this gate. */
  assigned: PrincipalId[];
  proposed_by: PrincipalId;
  created_by: PrincipalId;
}

export interface DeciderVerdict {
  allowed: boolean;
  reason: string;
}

/**
 * Whether this principal may decide at this gate.
 *
 * Two independent questions, and both must pass: do they resolve as the owner, and does separation
 * of duties permit them. Keeping them separate means the refusal can say which one failed, and
 * they fail for genuinely different reasons.
 */
export function mayDecide(input: DeciderInput): DeciderVerdict {
  const { gate, decider } = input;

  // An agent authenticating as a decider is the failure ADR-0005 exists to prevent, and it is
  // checked before anything else so no resolver can accidentally admit one.
  if (decider.kind !== 'human') {
    return {
      allowed: false,
      reason: `\`${decider.id}\` is ${decider.kind === 'agent' ? 'an agent' : 'a service principal'}. Only a named human decides at a gate.`,
    };
  }

  const owner = resolvesAsOwner(input);
  if (!owner.allowed) return owner;

  if (gate.separation_of_duties === 'exclude_proposer' && decider.id === input.proposed_by) {
    return {
      allowed: false,
      reason: `You proposed this version, and \`${gate.id}\` declares separation of duties (exclude_proposer).`,
    };
  }
  if (gate.separation_of_duties === 'exclude_creator' && decider.id === input.created_by) {
    return {
      allowed: false,
      reason: `You created this artifact, and \`${gate.id}\` declares separation of duties (exclude_creator).`,
    };
  }

  return { allowed: true, reason: owner.reason };
}

function resolvesAsOwner(input: DeciderInput): DeciderVerdict {
  const { gate, decider, roles } = input;
  switch (gate.owner.resolver) {
    case 'role': {
      const has = roles.includes(gate.owner.role);
      return {
        allowed: has,
        reason: has
          ? `You hold \`${gate.owner.role}\` in this workspace.`
          : `\`${gate.id}\` is decided by \`${gate.owner.role}\`, which you do not hold here.`,
      };
    }
    case 'routing_table': {
      const has = input.routed.includes(decider.id) || input.routed.some((r) => roles.includes(r));
      return {
        allowed: has,
        reason: has
          ? `The routing table names you for \`${gate.owner.key}\`.`
          : `\`${gate.id}\` routes \`${gate.owner.key}\` to ${input.routed.length ? input.routed.join(', ') : 'nobody'}, which does not include you.`,
      };
    }
    case 'assignment': {
      const has = input.assigned.includes(decider.id);
      return {
        allowed: has,
        reason: has
          ? 'You are assigned to this gate.'
          : `\`${gate.id}\` is decided by explicit assignment, and you are not assigned to it.`,
      };
    }
  }
}
