/**
 * Labels — what a reader sees for every identifier a workspace declares.
 *
 * The record carries identifiers: `business_case`, `request_changes`, `justified_by`. A person
 * approving something on their phone should never meet one. Every id a definition declares gets a
 * label here, taken from the definition where it gave one and humanised from the id where it did
 * not — so a screen can always show a word, and a workspace that wants a *particular* word only has
 * to say so.
 *
 * The fallback is deliberate and the rule is stated once: **no surface shows an identifier a
 * workspace could have labelled.** A humanised id (`request changes`) is a weaker label than a
 * declared one (`Ask for changes`), but it is a label; the raw id is not.
 */

import type { WorkspaceDefinition } from './workspace-definition.js';

export interface TypeLabel {
  title: string;
  description?: string;
}

export interface GateLabel {
  title: string;
  description?: string;
  outcomes: Record<string, string>;
}

export interface Labels {
  types: Record<string, TypeLabel>;
  gates: Record<string, GateLabel>;
  phases: Record<string, string>;
  /** Keyed by link id. Two types may declare the same link id; the first declared label wins. */
  links: Record<string, string>;
  /** Keyed by attribution field. Merged across profiles; the first declared label wins. */
  attribution: Record<string, string>;
}

/** `request_changes` → `Request changes`. The fallback for anything a definition did not label. */
export function humanise(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim();
  return words.length === 0 ? id : words.charAt(0).toUpperCase() + words.slice(1);
}

export function labelsFor(def: WorkspaceDefinition): Labels {
  const types: Labels['types'] = {};
  const links: Labels['links'] = {};
  for (const type of def.types) {
    types[type.id] = {
      title: type.title ?? humanise(type.id),
      ...(type.description ? { description: type.description } : {}),
    };
    for (const link of type.links) {
      links[link.id] ??= link.label ?? humanise(link.id);
    }
  }

  const gates: Labels['gates'] = {};
  for (const gate of def.gates) {
    gates[gate.id] = {
      title: gate.title ?? humanise(gate.id),
      ...(gate.description ? { description: gate.description } : {}),
      outcomes: Object.fromEntries(
        gate.outcomes.map((outcome) => [outcome, gate.outcome_labels[outcome] ?? humanise(outcome)]),
      ),
    };
  }

  const phases: Labels['phases'] = Object.fromEntries(
    def.lifecycle.phases.map((phase) => [phase, def.lifecycle.phase_labels[phase] ?? humanise(phase)]),
  );

  const attribution: Labels['attribution'] = {};
  for (const profile of def.attribution_profiles) {
    for (const field of [...profile.required, ...profile.optional]) {
      attribution[field] ??= profile.field_labels[field] ?? humanise(field);
    }
  }

  return { types, gates, phases, links, attribution };
}
