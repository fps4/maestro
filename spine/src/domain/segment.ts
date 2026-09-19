/**
 * A segment: one workspace, one archive day, sealed.
 *
 * The manifest names the sequence range, the Merkle root over the day's canonical events, the digest
 * of every leaf (so a tampered copy can be named to the event, not the day), and the previous
 * segment's digest — the link that makes the archive a chain. The segment's own digest is the digest
 * of the manifest with that field absent; the next day's manifest carries it.
 *
 * The day is the archive's day: the UTC date the relay wrote the events, not the date they occurred.
 * Each event carries its own `occurred_at` and `recorded_at`; the day is a physical partition, and
 * contiguity of `seq` across segments is what guarantees nothing fell between two of them.
 */

import { z } from 'zod';
import { canonicalize } from './canonical.js';
import { DIGEST, type Digest, sha256 } from './digest.js';
import { type SpineEvent, eventSchema } from './event.js';
import { WORKSPACE_ID } from './ids.js';
import { leafHash, merkleRoot } from './merkle.js';

export const SEALER_VERSION = 1;

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const manifestSchema = z
  .object({
    workspace_id: z.string().regex(WORKSPACE_ID),
    period: z.string().regex(DAY),
    first_seq: z.number().int().positive(),
    last_seq: z.number().int().positive(),
    event_count: z.number().int().positive(),
    merkle_root: z.string().regex(DIGEST),
    leaves: z.array(z.string().regex(DIGEST)),
    prev_segment_digest: z.string().regex(DIGEST).nullable(),
    segment_digest: z.string().regex(DIGEST),
    sealed_at: z.string(),
    sealer_version: z.literal(SEALER_VERSION),
  })
  .strict();

export type SegmentManifest = z.infer<typeof manifestSchema>;

export class SealRefused extends Error {
  constructor(
    message: string,
    readonly seq?: number,
  ) {
    super(message);
    this.name = 'SealRefused';
  }
}

/** The canonical line of an event: what the archive stores and what a leaf is hashed over. */
export function eventLine(event: SpineEvent): string {
  return canonicalize(event);
}

export function parseEventLine(line: string): SpineEvent {
  return eventSchema.parse(JSON.parse(line));
}

/** The digest of a manifest is over everything but its own digest. */
export function segmentDigest(manifest: Omit<SegmentManifest, 'segment_digest'>): Digest {
  return sha256(canonicalize(manifest));
}

/**
 * Seal a day. The lines must be the day's canonical event lines in `seq` order, contiguous, and —
 * if there is a previous segment — starting where it ended. Anything else is refused, naming the
 * first sequence number that is wrong, because a sealer that pads over a gap has manufactured a
 * record.
 */
export function seal(input: {
  workspace_id: string;
  period: string;
  lines: readonly string[];
  previous: SegmentManifest | null;
  sealed_at: string;
}): SegmentManifest {
  const { workspace_id, period, lines, previous, sealed_at } = input;
  if (lines.length === 0) throw new SealRefused(`${workspace_id}/${period}: nothing to seal`);
  if (previous && previous.workspace_id !== workspace_id) {
    throw new SealRefused(`${workspace_id}/${period}: previous segment belongs to ${previous.workspace_id}`);
  }
  if (previous && previous.period >= period) {
    throw new SealRefused(`${workspace_id}/${period}: previous segment ${previous.period} is not earlier`);
  }

  let expected = previous ? previous.last_seq + 1 : 1;
  const first = expected;
  const leaves: Digest[] = [];
  for (const line of lines) {
    const event = parseEventLine(line);
    if (event.workspace_id !== workspace_id) {
      throw new SealRefused(
        `seq ${event.seq} belongs to ${event.workspace_id}, not ${workspace_id}`,
        event.seq,
      );
    }
    if (event.seq !== expected) {
      throw new SealRefused(
        `${workspace_id}/${period}: expected seq ${expected}, found ${event.seq}`,
        Math.min(expected, event.seq),
      );
    }
    if (eventLine(event) !== line) {
      throw new SealRefused(
        `${workspace_id}/${period}: seq ${event.seq} is not in canonical form`,
        event.seq,
      );
    }
    leaves.push(leafHash(line));
    expected += 1;
  }

  const body = {
    workspace_id,
    period,
    first_seq: first,
    last_seq: expected - 1,
    event_count: lines.length,
    merkle_root: merkleRoot(leaves),
    leaves,
    prev_segment_digest: previous ? previous.segment_digest : null,
    sealed_at,
    sealer_version: SEALER_VERSION,
  } satisfies Omit<SegmentManifest, 'segment_digest'>;

  return { ...body, segment_digest: segmentDigest(body) };
}
