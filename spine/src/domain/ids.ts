/**
 * Identifiers the spine recognises.
 *
 * A principal reference is a maestro principal id and nothing else. An identity provider's subject
 * never reaches a record (CONTEXT.md, "Principal"); the grammar here is what lets the append rule
 * reject one by shape, before the registry is even consulted.
 */

import { randomBytes } from 'node:crypto';

/** `prn-h-…` human, `prn-a-…` agent, `prn-w-…` workload — the kind letter is part of the id. */
export const PRINCIPAL_ID = /^prn-[haw]-[a-z0-9][a-z0-9._-]{0,62}$/;

export type PrincipalKind = 'human' | 'agent' | 'workload';

export function isPrincipalId(value: unknown): value is string {
  return typeof value === 'string' && PRINCIPAL_ID.test(value);
}

/** The kind a principal id claims by its shape. The registry says what it actually is. */
export function claimedKind(id: string): PrincipalKind | undefined {
  const letter = id.slice(4, 5);
  return letter === 'h' ? 'human' : letter === 'a' ? 'agent' : letter === 'w' ? 'workload' : undefined;
}

export const WORKSPACE_ID = /^ws-[a-z0-9][a-z0-9-]{0,62}$/;

export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * UUID version 7 (RFC 9562): a 48-bit millisecond timestamp, then random bits. Time-ordered, so an
 * event id sorts the way the events happened without anyone reading a clock twice.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(now);
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
