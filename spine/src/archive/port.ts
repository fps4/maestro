/**
 * The archive store port. Objects, written once — the layout under one root:
 *
 *   <workspace>/<yyyy-mm-dd>/events-<first_seq>.jsonl   a relay batch: canonical event lines, seq order
 *   <workspace>/<yyyy-mm-dd>/segment.json               the sealed manifest; present once the day is sealed
 *   <workspace>/head.json                               the relay's pointer: last archived seq and day
 *
 * Parts and manifests are immutable: an adapter refuses to overwrite one. `head.json` is the one
 * mutable object and it is not part of the record — the verifier never reads it; the chain is what
 * says where a workspace ends.
 */

import type { SegmentManifest } from '../domain/segment.js';

export interface ArchiveHead {
  last_seq: number;
  day: string;
}

export interface ArchiveStore {
  readHead(workspace: string): Promise<ArchiveHead | null>;
  writeHead(workspace: string, head: ArchiveHead): Promise<void>;

  /** Write-once. Returns `exists` untouched when a part with this first sequence is already there. */
  putPart(
    workspace: string,
    day: string,
    firstSeq: number,
    lines: readonly string[],
  ): Promise<'written' | 'exists'>;
  /** First sequence numbers of the day's parts, ascending. */
  listParts(workspace: string, day: string): Promise<number[]>;
  readPart(workspace: string, day: string, firstSeq: number): Promise<string[]>;

  readManifest(workspace: string, day: string): Promise<SegmentManifest | null>;
  /** Write-once. Throws if the day is already sealed. */
  putManifest(workspace: string, day: string, manifest: SegmentManifest): Promise<void>;

  /** Days that hold anything for this workspace, ascending. */
  listDays(workspace: string): Promise<string[]>;
  listWorkspaces(): Promise<string[]>;
}

export const PART_PREFIX = 'events-';
export const PART_SUFFIX = '.jsonl';
export const MANIFEST_NAME = 'segment.json';
export const HEAD_NAME = 'head.json';

export function partName(firstSeq: number): string {
  return `${PART_PREFIX}${String(firstSeq).padStart(12, '0')}${PART_SUFFIX}`;
}

export function partSeq(name: string): number | null {
  if (!name.startsWith(PART_PREFIX) || !name.endsWith(PART_SUFFIX)) return null;
  const n = Number(name.slice(PART_PREFIX.length, -PART_SUFFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function splitLines(text: string): string[] {
  return text.split('\n').filter((l) => l.length > 0);
}

export function joinLines(lines: readonly string[]): string {
  return lines.map((l) => `${l}\n`).join('');
}
