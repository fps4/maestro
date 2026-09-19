/**
 * Append, seal, verify — over a store.
 *
 * `append` is exactly-once by `(workspace, seq)`: a batch the relay already wrote is recognised and
 * skipped, a batch that would leave a gap is refused, and a partial write from a crashed run is
 * completed rather than duplicated. `seal` closes a day into a segment chained to the one before.
 * `verifyRange` is the pure verifier fed from the store.
 */

import { type SegmentManifest, SealRefused, seal, eventLine } from '../domain/segment.js';
import type { SpineEvent } from '../domain/event.js';
import { verify, type Verdict } from '../domain/verify.js';
import type { ArchiveStore } from './port.js';

export class ArchiveRefused extends Error {
  constructor(
    message: string,
    readonly seq?: number,
  ) {
    super(message);
    this.name = 'ArchiveRefused';
  }
}

export interface AppendReport {
  workspace_id: string;
  written: number;
  /** Already in the archive from an earlier run; not written again. */
  skipped: number;
  last_seq: number;
}

/**
 * Append one workspace's events, in `seq` order, to the given archive day.
 */
export async function append(
  store: ArchiveStore,
  events: readonly SpineEvent[],
  day: string,
): Promise<AppendReport> {
  const first = events[0];
  if (!first) throw new ArchiveRefused('nothing to append');
  const workspace = first.workspace_id;
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i]!;
    if (e.workspace_id !== workspace)
      throw new ArchiveRefused(`seq ${e.seq} belongs to ${e.workspace_id}, not ${workspace}`, e.seq);
    if (e.seq !== first.seq + i)
      throw new ArchiveRefused(`${workspace}: batch is not contiguous at seq ${e.seq}`, e.seq);
  }

  const head = await store.readHead(workspace);
  const last = head?.last_seq ?? 0;
  if (head && day < head.day)
    throw new ArchiveRefused(`${workspace}: archive day ${day} is before the head's ${head.day}`);
  if (await store.readManifest(workspace, day))
    throw new ArchiveRefused(`${workspace}/${day} is sealed; append to a later day`);

  const fresh = events.filter((e) => e.seq > last);
  const skipped = events.length - fresh.length;
  const start = fresh[0];
  if (!start) return { workspace_id: workspace, written: 0, skipped, last_seq: last };
  if (start.seq !== last + 1) {
    throw new ArchiveRefused(
      `${workspace}: archive ends at seq ${last}, batch starts at ${start.seq}`,
      last + 1,
    );
  }

  const lines = fresh.map(eventLine);
  const outcome = await store.putPart(workspace, day, start.seq, lines);
  let written = lines.length;
  if (outcome === 'exists') {
    // A previous run wrote this part and died before moving the head. Whatever it wrote must be a
    // prefix of what we hold (same seqs, same bytes); anything it did not get to goes in a new part.
    const existing = await store.readPart(workspace, day, start.seq);
    for (let i = 0; i < Math.min(existing.length, lines.length); i += 1) {
      if (existing[i] !== lines[i]) {
        throw new ArchiveRefused(
          `${workspace}/${day}: seq ${start.seq + i} differs from what is already archived`,
          start.seq + i,
        );
      }
    }
    if (existing.length > lines.length) {
      written = 0;
      await store.writeHead(workspace, { last_seq: start.seq + existing.length - 1, day });
      return {
        workspace_id: workspace,
        written,
        skipped: skipped + lines.length,
        last_seq: start.seq + existing.length - 1,
      };
    }
    const rest = lines.slice(existing.length);
    written = rest.length;
    if (rest.length > 0) {
      const r = await store.putPart(workspace, day, start.seq + existing.length, rest);
      if (r === 'exists')
        throw new ArchiveRefused(
          `${workspace}/${day}: part at seq ${start.seq + existing.length} already exists`,
          start.seq + existing.length,
        );
    }
  }

  const lastSeq = start.seq + lines.length - 1;
  await store.writeHead(workspace, { last_seq: lastSeq, day });
  return { workspace_id: workspace, written, skipped, last_seq: lastSeq };
}

/** Every event line of a day, parts in order. */
export async function readDay(store: ArchiveStore, workspace: string, day: string): Promise<string[]> {
  const parts = await store.listParts(workspace, day);
  const lines: string[] = [];
  for (const first of parts) lines.push(...(await store.readPart(workspace, day, first)));
  return lines;
}

/** The sealed manifest of the latest day strictly before `day`, if any. */
export async function previousManifest(
  store: ArchiveStore,
  workspace: string,
  day: string,
): Promise<SegmentManifest | null> {
  const days = (await store.listDays(workspace)).filter((d) => d < day).reverse();
  for (const d of days) {
    const manifest = await store.readManifest(workspace, d);
    if (manifest) return manifest;
    if ((await store.listParts(workspace, d)).length > 0) {
      throw new SealRefused(`${workspace}/${d} holds events and is not sealed; seal it before ${day}`);
    }
  }
  return null;
}

/**
 * Seal a day. Idempotent: an already-sealed day returns its manifest. A day with nothing in it has
 * no segment — the chain simply skips it. A day still being written to must not be sealed; the
 * caller (a scheduled sealer) seals days strictly before the archive's current day.
 */
export async function sealDay(
  store: ArchiveStore,
  workspace: string,
  day: string,
  sealedAt: string = new Date().toISOString(),
): Promise<SegmentManifest | null> {
  const already = await store.readManifest(workspace, day);
  if (already) return already;
  const lines = await readDay(store, workspace, day);
  if (lines.length === 0) return null;
  const previous = await previousManifest(store, workspace, day);
  const manifest = seal({ workspace_id: workspace, period: day, lines, previous, sealed_at: sealedAt });
  await store.putManifest(workspace, day, manifest);
  return manifest;
}

/** Seal every day of every workspace before `today`. Returns what was sealed this time. */
export async function sealBefore(
  store: ArchiveStore,
  today: string,
  sealedAt?: string,
): Promise<SegmentManifest[]> {
  const sealed: SegmentManifest[] = [];
  for (const workspace of await store.listWorkspaces()) {
    for (const day of await store.listDays(workspace)) {
      if (day >= today) break;
      if (await store.readManifest(workspace, day)) continue;
      const manifest = await sealDay(store, workspace, day, sealedAt);
      if (manifest) sealed.push(manifest);
    }
  }
  return sealed;
}

/**
 * Verify a workspace's sealed segments over a period range (inclusive; both optional). A day inside
 * the range that holds events but no manifest is a failure: an unsealed day is not a record yet.
 */
export async function verifyRange(
  store: ArchiveStore,
  workspace: string,
  range: { from?: string; to?: string } = {},
): Promise<Verdict> {
  const days = (await store.listDays(workspace)).filter(
    (d) => (range.from === undefined || d >= range.from) && (range.to === undefined || d <= range.to),
  );
  const segments = [];
  for (const day of days) {
    const manifest = await store.readManifest(workspace, day);
    const lines = await readDay(store, workspace, day);
    if (!manifest) {
      if (lines.length === 0) continue;
      return { ok: false, period: day, seq: null, reason: 'day holds events and is not sealed' };
    }
    segments.push({ manifest, lines });
  }
  const before = range.from === undefined ? null : await previousSealed(store, workspace, range.from);
  return verify(segments, before);
}

async function previousSealed(
  store: ArchiveStore,
  workspace: string,
  day: string,
): Promise<SegmentManifest | null> {
  const days = (await store.listDays(workspace)).filter((d) => d < day).reverse();
  for (const d of days) {
    const manifest = await store.readManifest(workspace, d);
    if (manifest) return manifest;
  }
  return null;
}
