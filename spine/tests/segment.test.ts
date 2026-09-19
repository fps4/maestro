import { describe, expect, it } from 'vitest';
import { SealRefused, eventLine, seal, segmentDigest } from '../src/domain/segment.js';
import { leafHash, merkleRoot } from '../src/domain/merkle.js';
import { WS, event } from './helpers.js';

const SEALED_AT = '2026-09-19T00:07:11Z';

describe('sealing a day', () => {
  it('produces a manifest whose root is over the leaves and whose digest is over itself', () => {
    const lines = [1, 2, 3].map((n) => eventLine(event(n)));
    const manifest = seal({
      workspace_id: WS,
      period: '2026-09-18',
      lines,
      previous: null,
      sealed_at: SEALED_AT,
    });
    expect(manifest).toMatchObject({
      first_seq: 1,
      last_seq: 3,
      event_count: 3,
      prev_segment_digest: null,
      sealer_version: 1,
    });
    expect(manifest.leaves).toEqual(lines.map(leafHash));
    expect(manifest.merkle_root).toBe(merkleRoot(manifest.leaves as `sha256:${string}`[]));
    const { segment_digest, ...body } = manifest;
    expect(segmentDigest(body)).toBe(segment_digest);
  });

  it('chains to the previous segment and continues its sequence', () => {
    const day1 = seal({
      workspace_id: WS,
      period: '2026-09-18',
      lines: [eventLine(event(1)), eventLine(event(2))],
      previous: null,
      sealed_at: SEALED_AT,
    });
    const day2 = seal({
      workspace_id: WS,
      period: '2026-09-19',
      lines: [eventLine(event(3))],
      previous: day1,
      sealed_at: SEALED_AT,
    });
    expect(day2.first_seq).toBe(3);
    expect(day2.prev_segment_digest).toBe(day1.segment_digest);
  });

  it('refuses a gap, naming the missing seq', () => {
    expect(() =>
      seal({
        workspace_id: WS,
        period: '2026-09-18',
        lines: [eventLine(event(1)), eventLine(event(3))],
        previous: null,
        sealed_at: SEALED_AT,
      }),
    ).toThrow(SealRefused);
    try {
      seal({
        workspace_id: WS,
        period: '2026-09-18',
        lines: [eventLine(event(1)), eventLine(event(3))],
        previous: null,
        sealed_at: SEALED_AT,
      });
    } catch (error) {
      expect((error as SealRefused).seq).toBe(2);
    }
  });

  it('refuses a day that does not start where the previous one ended', () => {
    const day1 = seal({
      workspace_id: WS,
      period: '2026-09-18',
      lines: [eventLine(event(1))],
      previous: null,
      sealed_at: SEALED_AT,
    });
    expect(() =>
      seal({
        workspace_id: WS,
        period: '2026-09-19',
        lines: [eventLine(event(3))],
        previous: day1,
        sealed_at: SEALED_AT,
      }),
    ).toThrow(/expected seq 2, found 3/);
  });

  it('refuses a non-canonical line: the bytes sealed are the bytes hashed', () => {
    const pretty = JSON.stringify(event(1), null, 2);
    expect(() =>
      seal({ workspace_id: WS, period: '2026-09-18', lines: [pretty], previous: null, sealed_at: SEALED_AT }),
    ).toThrow(/canonical/);
  });

  it("refuses another workspace's event", () => {
    const foreign = eventLine(event(1, { workspace_id: 'ws-other' }));
    expect(() =>
      seal({
        workspace_id: WS,
        period: '2026-09-18',
        lines: [foreign],
        previous: null,
        sealed_at: SEALED_AT,
      }),
    ).toThrow(/belongs to ws-other/);
  });

  it('refuses an empty day and a previous segment that is not earlier', () => {
    expect(() =>
      seal({ workspace_id: WS, period: '2026-09-18', lines: [], previous: null, sealed_at: SEALED_AT }),
    ).toThrow(/nothing to seal/);
    const day = seal({
      workspace_id: WS,
      period: '2026-09-18',
      lines: [eventLine(event(1))],
      previous: null,
      sealed_at: SEALED_AT,
    });
    expect(() =>
      seal({
        workspace_id: WS,
        period: '2026-09-18',
        lines: [eventLine(event(2))],
        previous: day,
        sealed_at: SEALED_AT,
      }),
    ).toThrow(/not earlier/);
  });
});
