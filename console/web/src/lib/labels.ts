/**
 * What a reader sees for an identifier.
 *
 * The api returns `labels` with every definition: the word the workspace chose for each type, gate,
 * outcome, phase, link and attribution field, humanised from the id where it chose none. This module
 * is the console's side of that rule — **no screen renders an identifier a workspace could have
 * labelled** — plus the vocabulary for the states the *service* owns, which no definition can name.
 */

import type { Labels, VersionState } from './types';

/** `request_changes` → `Request changes`. The same fallback the api applies. */
export function humanise(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim();
  return words.length === 0 ? id : words.charAt(0).toUpperCase() + words.slice(1);
}

/** Version states are the service's, not the workspace's, so their words live here. */
export const STATE_LABELS: Record<VersionState | 'draft', string> = {
  proposed: 'Awaiting a decision',
  accepted: 'Accepted',
  superseded: 'Superseded',
  rejected: 'Not accepted',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
  draft: 'Draft',
};

export function stateLabel(state: VersionState | 'draft'): string {
  return STATE_LABELS[state] ?? humanise(state);
}

/** An empty label set, for a page that could not load the definition and must still render words. */
export const NO_LABELS: Labels = { types: {}, gates: {}, phases: {}, links: {}, attribution: {} };

export function typeLabel(labels: Labels, type: string): string {
  return labels.types[type]?.title ?? humanise(type);
}

export function typeDescription(labels: Labels, type: string): string | undefined {
  return labels.types[type]?.description;
}

export function phaseLabel(labels: Labels, phase: string): string {
  return labels.phases[phase] ?? humanise(phase);
}

export function gateLabel(labels: Labels, gate: string): string {
  return labels.gates[gate]?.title ?? humanise(gate);
}

export function outcomeLabel(labels: Labels, gate: string, outcome: string): string {
  return labels.gates[gate]?.outcomes[outcome] ?? humanise(outcome);
}

export function linkLabel(labels: Labels, link: string): string {
  return labels.links[link] ?? humanise(link);
}

export function fieldLabel(labels: Labels, field: string): string {
  return labels.attribution[field] ?? humanise(field);
}
