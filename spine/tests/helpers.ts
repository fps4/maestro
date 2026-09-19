import type { EmittableEvent, PrincipalResolver, SpineEvent } from '../src/domain/event.js';
import { uuidv7 } from '../src/domain/ids.js';

export const WS = 'ws-aannemer-x';

export const principals: Record<string, { kind: 'human' | 'agent' | 'workload' }> = {
  'prn-h-jdekker': { kind: 'human' },
  'prn-h-mvries': { kind: 'human' },
  'prn-a-remed-2': { kind: 'agent' },
  'prn-w-specs-relay': { kind: 'workload' },
};

export const resolve: PrincipalResolver = (id) => principals[id];

let clock = Date.parse('2026-09-18T09:14:22.418Z');
export function tick(): string {
  clock += 1000;
  return new Date(clock).toISOString();
}

/** A well-formed event with the given seq. Everything else is a sensible default. */
export function event(seq: number, overrides: Partial<SpineEvent> = {}): SpineEvent {
  const at = tick();
  return {
    event_id: uuidv7(),
    workspace_id: WS,
    seq,
    subject_type: 'work_item',
    subject_id: `wrk-${8000 + seq}`,
    subject_seq: 1,
    type: 'WorkItemRaised',
    type_version: 1,
    occurred_at: at,
    recorded_at: at,
    accountable: 'prn-h-jdekker',
    acting: 'prn-a-remed-2',
    seat: 'operations',
    oversight_level: 'O2',
    consequence_class: 'c2',
    causation_id: null,
    correlation_id: uuidv7(),
    body: { class: 'remediation', severity: 'sev2' },
    ...overrides,
  };
}

export function emittable(overrides: Partial<EmittableEvent> = {}): Omit<EmittableEvent, 'seq'> {
  const { seq: _seq, event_id: _id, recorded_at: _rec, ...rest } = event(1, overrides as Partial<SpineEvent>);
  return rest;
}
