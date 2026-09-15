/**
 * What each outcome at a gate would do, in words.
 *
 * A decision whose effects are invisible is one nobody can take responsibly. The console used to
 * guess these on the client from the outcome's name; this computes them from the definition and the
 * stored state, so the person reading "Approve" sees exactly what will supersede, what will freeze,
 * and where the artifact moves — and sees it the same way over MCP, where an agent is explaining the
 * decision to them.
 *
 * Plain language throughout. The only identifiers that survive are ordinals (`@3`), which are what
 * a person cites when they talk about a version.
 */

import type { Labels } from './labels.js';
import { phaseAfterGate } from './lifecycle.js';
import type { Artifact, Link, Version } from './types.js';
import {
  acceptingOutcome,
  type GateDeclaration,
  type TypeDeclaration,
  type WorkspaceDefinition,
} from './workspace-definition.js';

export interface OutcomeConsequence {
  outcome: string;
  label: string;
  accepts: boolean;
  reopens: boolean;
  /** One sentence per effect, in the order they happen. */
  effects: string[];
  /** True when this outcome would be refused by the service even if chosen — a pin with nothing to freeze to. */
  blocked?: string;
}

export interface ConsequenceInput {
  def: WorkspaceDefinition;
  gate: GateDeclaration;
  type: TypeDeclaration;
  labels: Labels;
  version: Pick<Version, 'ordinal' | 'links'>;
  artifact: Pick<Artifact, 'phase' | 'accepted_ordinal'>;
  /** The accepted ordinal of each link target, as of now — what a pin would freeze to. */
  acceptedByArtifact: Map<string, number>;
  /** Link targets by id, for naming them rather than citing them. */
  targetTitles: Map<string, string>;
}

export function consequencesOf(input: ConsequenceInput): OutcomeConsequence[] {
  const { def, gate, type, labels, version, artifact } = input;
  const typeTitle = labels.types[type.id]?.title ?? type.id;
  const accepting = acceptingOutcome(gate);

  return gate.outcomes.map((outcome) => {
    const accepts = outcome === accepting;
    const reopens = outcome === gate.reopens_on;
    const effects: string[] = [];
    let blocked: string | undefined;

    if (accepts) {
      effects.push(`Version @${version.ordinal} becomes the accepted ${typeTitle.toLowerCase()}.`);
      if (artifact.accepted_ordinal && artifact.accepted_ordinal !== version.ordinal) {
        effects.push(
          `Version @${artifact.accepted_ordinal} stops being current. It is superseded, not deleted — it stays readable.`,
        );
      }
      for (const link of pinnedLinks(version.links, type)) {
        const target = input.targetTitles.get(link.target) ?? link.target;
        const linkLabel = labels.links[link.type] ?? link.type;
        const frozenTo = input.acceptedByArtifact.get(link.target);
        if (link.pinned_to != null) {
          effects.push(`"${linkLabel}" stays frozen to ${target} @${link.pinned_to}.`);
        } else if (frozenTo !== undefined) {
          effects.push(
            `"${linkLabel}" freezes to ${target} @${frozenTo}, and reads against that version however often ${target} changes afterwards.`,
          );
        } else {
          blocked = `"${linkLabel}" points at ${target}, which has no accepted version yet. There is nothing honest to freeze to, so this would be refused.`;
        }
      }
    } else if (reopens) {
      effects.push(
        `A new draft opens, based on @${version.ordinal}, carrying your reasoning for the author to work from.`,
      );
      effects.push(`Version @${version.ordinal} stays in the record as not accepted. Nothing is erased.`);
    } else {
      effects.push(
        `Version @${version.ordinal} is not accepted and stays in the record with your reasoning. Nothing else changes.`,
      );
    }

    const to = phaseAfterGate(def, artifact.phase, gate.id, outcome);
    if (to && to !== artifact.phase) {
      effects.push(
        `The ${typeTitle.toLowerCase()} moves from ${labels.phases[artifact.phase] ?? artifact.phase} to ${labels.phases[to] ?? to}.`,
      );
    }

    return {
      outcome,
      label: labels.gates[gate.id]?.outcomes[outcome] ?? outcome,
      accepts,
      reopens,
      effects,
      ...(blocked ? { blocked } : {}),
    };
  });
}

function pinnedLinks(links: Link[], type: TypeDeclaration): Link[] {
  const pinnedType = type.links.find((l) => l.pinned)?.id;
  return pinnedType ? links.filter((l) => l.type === pinnedType) : [];
}
