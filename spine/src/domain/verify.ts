/**
 * The verifier. Given a run of sealed segments and their event lines, recompute everything the
 * sealer computed and compare. Pass, or the first divergent sequence number and why.
 *
 * Pure: it takes bytes and returns a verdict. The CLI and the API wrap it over a store; the exit
 * deliverable ships it over a directory (ADR-0004). It trusts nothing in the manifest it can
 * recompute, and it checks the chain between manifests so a rewritten day cannot hide behind a
 * consistent-looking root of its own.
 */

import { canonicalize } from './canonical.js';
import type { Digest } from './digest.js';
import { leafHash, merkleRoot } from './merkle.js';
import { type SegmentManifest, manifestSchema, segmentDigest } from './segment.js';
import { eventSchema } from './event.js';

export interface SegmentInput {
  manifest: unknown;
  lines: readonly string[];
}

export type Verdict =
  | { ok: true; workspace_id: string; first_seq: number; last_seq: number; segments: number }
  | { ok: false; period: string; seq: number | null; reason: string };

/**
 * `segments` in period order. `previous` is the manifest sealed just before the first one, when the
 * range does not start at the beginning of the workspace; without it the first segment's chain link
 * is taken on trust and reported as such.
 */
export function verify(segments: readonly SegmentInput[], previous: SegmentManifest | null = null): Verdict {
  if (segments.length === 0) return { ok: false, period: '', seq: null, reason: 'nothing to verify' };

  let prev = previous;
  let workspace: string | null = null;
  let firstSeq: number | null = null;

  for (const { manifest: raw, lines } of segments) {
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) {
      const period =
        typeof (raw as { period?: unknown })?.period === 'string' ? (raw as { period: string }).period : '?';
      return {
        ok: false,
        period,
        seq: null,
        reason: `manifest is malformed: ${parsed.error.issues[0]?.message}`,
      };
    }
    const manifest = parsed.data;
    const { period } = manifest;
    const fail = (seq: number | null, reason: string): Verdict => ({ ok: false, period, seq, reason });

    if (workspace === null) workspace = manifest.workspace_id;
    if (manifest.workspace_id !== workspace) return fail(null, `segment belongs to ${manifest.workspace_id}`);

    // The manifest's own digest, then its link to the previous one.
    const { segment_digest, ...body } = manifest;
    if (segmentDigest(body) !== segment_digest)
      return fail(manifest.first_seq, 'segment digest does not match the manifest');
    if (prev) {
      if (prev.period >= period)
        return fail(manifest.first_seq, `segment ${period} does not follow ${prev.period}`);
      if (manifest.first_seq !== prev.last_seq + 1)
        return fail(
          Math.min(manifest.first_seq, prev.last_seq + 1),
          `gap: previous segment ended at ${prev.last_seq}, this one starts at ${manifest.first_seq}`,
        );
      if (manifest.prev_segment_digest !== prev.segment_digest)
        return fail(
          manifest.first_seq,
          'chain broken: prev_segment_digest does not match the previous segment',
        );
    }

    // The events against the leaves, one by one, so a tampered copy is named to the event.
    if (manifest.event_count !== manifest.last_seq - manifest.first_seq + 1)
      return fail(manifest.first_seq, 'event_count does not match the sequence range');
    if (manifest.leaves.length !== manifest.event_count)
      return fail(manifest.first_seq, 'leaf count does not match event_count');
    // Walk what is on disk against what was sealed before comparing counts, so an insertion or a
    // removal is named at the event where the two first disagree, not at the end of the day.
    let expected = manifest.first_seq;
    const walk = Math.min(lines.length, manifest.event_count);
    for (let i = 0; i < walk; i += 1) {
      const line = lines[i]!;
      let event;
      try {
        event = eventSchema.parse(JSON.parse(line));
      } catch {
        return fail(expected, 'event line is not a well-formed event');
      }
      if (event.seq !== expected)
        return fail(Math.min(expected, event.seq), `expected seq ${expected}, found ${event.seq}`);
      if (event.workspace_id !== workspace) return fail(expected, `event belongs to ${event.workspace_id}`);
      if (canonicalize(event) !== line) return fail(expected, 'event line is not in canonical form');
      if (leafHash(line) !== manifest.leaves[i])
        return fail(expected, 'event does not match its sealed digest');
      expected += 1;
    }
    if (lines.length !== manifest.event_count) {
      return fail(expected, `${lines.length} events on disk, ${manifest.event_count} sealed`);
    }
    if (merkleRoot(manifest.leaves as Digest[]) !== manifest.merkle_root)
      return fail(manifest.first_seq, 'merkle root does not match the leaves');

    if (firstSeq === null) firstSeq = manifest.first_seq;
    prev = manifest;
  }

  return {
    ok: true,
    workspace_id: workspace!,
    first_seq: firstSeq!,
    last_seq: prev!.last_seq,
    segments: segments.length,
  };
}
