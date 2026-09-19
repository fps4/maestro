import { describe, expect, it } from 'vitest';
import { eventLine, seal, type SegmentManifest } from '../src/domain/segment.js';
import { verify } from '../src/domain/verify.js';
import { WS, event } from './helpers.js';

const SEALED_AT = '2026-09-19T00:07:11Z';

function archive(): { segments: Array<{ manifest: SegmentManifest; lines: string[] }> } {
  const d1 = [1, 2, 3].map((n) => eventLine(event(n)));
  const m1 = seal({
    workspace_id: WS,
    period: '2026-09-17',
    lines: d1,
    previous: null,
    sealed_at: SEALED_AT,
  });
  const d2 = [4, 5].map((n) => eventLine(event(n)));
  const m2 = seal({ workspace_id: WS, period: '2026-09-18', lines: d2, previous: m1, sealed_at: SEALED_AT });
  const d3 = [6, 7, 8, 9].map((n) => eventLine(event(n)));
  const m3 = seal({ workspace_id: WS, period: '2026-09-19', lines: d3, previous: m2, sealed_at: SEALED_AT });
  return {
    segments: [
      { manifest: m1, lines: d1 },
      { manifest: m2, lines: d2 },
      { manifest: m3, lines: d3 },
    ],
  };
}

function tamper(line: string, patch: (e: Record<string, unknown>) => void): string {
  const e = JSON.parse(line) as Record<string, unknown>;
  patch(e);
  return eventLine(e as never);
}

describe('the verifier', () => {
  it('passes an untouched chain', () => {
    const { segments } = archive();
    expect(verify(segments)).toEqual({ ok: true, workspace_id: WS, first_seq: 1, last_seq: 9, segments: 3 });
  });

  it('names the event that was altered', () => {
    const { segments } = archive();
    segments[1]!.lines[1] = tamper(segments[1]!.lines[1]!, (e) => {
      e.body = { class: 'remediation', severity: 'sev4' };
    });
    expect(verify(segments)).toEqual({
      ok: false,
      period: '2026-09-18',
      seq: 5,
      reason: 'event does not match its sealed digest',
    });
  });

  it('names the event that was removed', () => {
    const { segments } = archive();
    segments[2]!.lines.splice(1, 1); // seq 7 gone
    expect(verify(segments)).toEqual({
      ok: false,
      period: '2026-09-19',
      seq: 7,
      reason: 'expected seq 7, found 8',
    });
  });

  it('names the event that was inserted', () => {
    const { segments } = archive();
    segments[0]!.lines.splice(1, 0, eventLine(event(2)));
    expect(verify(segments)).toEqual({
      ok: false,
      period: '2026-09-17',
      seq: 2,
      reason: 'event does not match its sealed digest',
    });
  });

  it('catches a rewritten manifest through its digest', () => {
    const { segments } = archive();
    segments[1]!.manifest = { ...segments[1]!.manifest, event_count: 3, last_seq: 6 };
    expect(verify(segments)).toEqual({
      ok: false,
      period: '2026-09-18',
      seq: 4,
      reason: 'segment digest does not match the manifest',
    });
  });

  it('catches a re-sealed day through the chain', () => {
    const { segments } = archive();
    const s = segments[1]!;
    s.lines[0] = tamper(s.lines[0]!, (e) => {
      e.acting = 'prn-h-jdekker';
    });
    // The attacker re-seals the day consistently; the next day's link exposes it.
    s.manifest = seal({
      workspace_id: WS,
      period: '2026-09-18',
      lines: s.lines,
      previous: segments[0]!.manifest,
      sealed_at: SEALED_AT,
    });
    expect(verify(segments)).toEqual({
      ok: false,
      period: '2026-09-19',
      seq: 6,
      reason: 'chain broken: prev_segment_digest does not match the previous segment',
    });
  });

  it('verifies a range given the manifest before it, and refuses a gap between segments', () => {
    const { segments } = archive();
    expect(verify(segments.slice(1), segments[0]!.manifest).ok).toBe(true);
    expect(verify([segments[0]!, segments[2]!])).toMatchObject({
      ok: false,
      period: '2026-09-19',
      seq: 4,
      reason: expect.stringMatching(/^gap:/),
    });
  });

  it('refuses nothing and a malformed manifest', () => {
    expect(verify([]).ok).toBe(false);
    expect(verify([{ manifest: { period: '2026-09-18' }, lines: [] }])).toMatchObject({
      ok: false,
      period: '2026-09-18',
      seq: null,
    });
  });
});
