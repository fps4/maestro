/**
 * Lifecycle — declared phases and which gate authorises each transition.
 *
 * The service holds lifecycle state and decisions. It does not route, escalate or remind: that is
 * orchestration and belongs to the consumer. What lives here is only "is this move legal, and what
 * authorised it".
 */

import type { Transition, WorkspaceDefinition } from './workspace-definition.js';

export class IllegalTransition extends Error {
  constructor(
    readonly from: string,
    readonly because: string,
  ) {
    super(`No declared transition leaves phase \`${from}\` ${because}`);
    this.name = 'IllegalTransition';
  }
}

/** The phase a proposal moves an artifact into, or undefined if proposing does not move it. */
export function phaseAfterPropose(def: WorkspaceDefinition, from: string): string | undefined {
  return def.lifecycle.transitions.find((t) => t.from === from && t.via === 'propose')?.to;
}

/**
 * The phase a gate outcome moves an artifact into.
 *
 * A transition may name the outcome it responds to (`on: request_changes`) or not, in which case it
 * applies to any outcome of that gate. The more specific one wins — otherwise declaring the special
 * case would be impossible without also re-declaring the general one.
 */
export function phaseAfterGate(
  def: WorkspaceDefinition,
  from: string,
  gate: string,
  outcome: string,
): string | undefined {
  const candidates = def.lifecycle.transitions.filter((t) => t.from === from && t.via_gate === gate);
  return (candidates.find((t) => t.on === outcome) ?? candidates.find((t) => !t.on))?.to;
}

/**
 * The phase a system-driven transition moves an artifact into.
 *
 * This exists because expiry has to be set by something, and the two declared authorities — a
 * proposal and a gate decision — are both acts by a principal. A machine-set expiry is neither, so
 * it gets its own transition kind with the acting service recorded.
 */
export function phaseAfterSystem(def: WorkspaceDefinition, from: string): string | undefined {
  return def.lifecycle.transitions.find((t) => t.from === from && t.via === 'system')?.to;
}

export function transitionsFrom(def: WorkspaceDefinition, from: string): Transition[] {
  return def.lifecycle.transitions.filter((t) => t.from === from);
}

/** Whether any declared transition can ever leave this phase. A phase with none is terminal. */
export function isTerminalPhase(def: WorkspaceDefinition, phase: string): boolean {
  return transitionsFrom(def, phase).length === 0;
}
