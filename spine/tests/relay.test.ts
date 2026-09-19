import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsArchive } from '../src/archive/fs.js';
import { MemoryArchive } from '../src/archive/memory.js';
import { type ArchiveStore, partName } from '../src/archive/port.js';
import { ArchiveRefused, append, readDay, sealBefore, sealDay, verifyRange } from '../src/archive/writer.js';
import { InProcessDelivery } from '../src/delivery/port.js';
import { parseEventLine } from '../src/domain/segment.js';
import { MemoryOutbox } from '../src/relay/memory.js';
import { relayOnce, relayUntilDrained } from '../src/relay/relay.js';
import { main as verifyCli } from '../src/cli/verify.js';
import { WS, emittable, event, resolve } from './helpers.js';

const DAY1 = '2026-09-18';
const DAY2 = '2026-09-19';

function rig(archive: ArchiveStore = new MemoryArchive(), day = DAY1) {
  const source = new MemoryOutbox(resolve);
  const delivery = new InProcessDelivery();
  const received: Array<{ ws: string; seq: number }> = [];
  delivery.subscribe((events) => {
    received.push(...events.map((e) => ({ ws: e.workspace_id, seq: e.seq })));
  });
  let today = day;
  const deps = { source, archive, delivery, resolve, today: () => today };
  return { source, archive, delivery, received, deps, setDay: (d: string) => (today = d) };
}

describe('the relay', () => {
  it('gate 1: drains the outbox into the archive and the consumer receives in order per workspace', async () => {
    const r = rig();
    for (let i = 0; i < 7; i += 1) r.source.emit(emittable());
    for (let i = 0; i < 3; i += 1) r.source.emit(emittable({ workspace_id: 'ws-other' }));

    const report = await relayUntilDrained(r.deps, 4);
    expect(report).toEqual({ archived: 10, published: 10, acked: 10, refused: [] });
    expect(r.source.undelivered()).toBe(0);

    const ours = r.received.filter((x) => x.ws === WS).map((x) => x.seq);
    const theirs = r.received.filter((x) => x.ws === 'ws-other').map((x) => x.seq);
    expect(ours).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(theirs).toEqual([1, 2, 3]);

    const lines = await readDay(r.archive, WS, DAY1);
    expect(lines.map((l) => parseEventLine(l).seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(await r.archive.readHead(WS)).toEqual({ last_seq: 7, day: DAY1 });
  });

  it('is idempotent: a second run over already-delivered events changes nothing', async () => {
    const r = rig();
    r.source.emit(emittable());
    r.source.emit(emittable());
    await relayUntilDrained(r.deps);
    const before = new Map((r.archive as MemoryArchive).objects);
    const again = await relayOnce(r.deps);
    expect(again).toEqual({ archived: 0, published: 0, acked: 0, refused: [] });
    expect((r.archive as MemoryArchive).objects).toEqual(before);
  });

  it('exactly-once into the archive: a run that died before acking lands the same events once', async () => {
    const r = rig();
    for (let i = 0; i < 5; i += 1) r.source.emit(emittable());
    // First attempt: archive written, delivery accepted, ack never happened.
    const dying = {
      ...r.deps,
      source: {
        pending: (n: number) => r.source.pending(n),
        ack: async () => {
          throw new Error('died');
        },
      },
    };
    await expect(relayOnce(dying, 3)).rejects.toThrow('died');
    expect(await r.archive.readHead(WS)).toEqual({ last_seq: 3, day: DAY1 });

    const report = await relayUntilDrained(r.deps, 3);
    expect(report.archived).toBe(2); // only 4 and 5 were new to the archive
    expect(report.acked).toBe(5);
    const lines = await readDay(r.archive, WS, DAY1);
    expect(lines.map((l) => parseEventLine(l).seq)).toEqual([1, 2, 3, 4, 5]);
    // Delivery is at-least-once; the archive is not.
    expect(r.received.filter((x) => x.seq === 1)).toHaveLength(2);
  });

  it('completes a part written by a run that died before moving the head, without duplicating it', async () => {
    const archive = new MemoryArchive();
    const batch = [1, 2, 3, 4].map((n) => event(n));
    // The crashed run wrote seqs 1–2 as the part at seq 1 and never touched the head.
    await archive.putPart(
      WS,
      DAY1,
      1,
      batch.slice(0, 2).map((e) => JSON.stringify(sortKeys(e))),
    );
    const report = await append(archive, batch, DAY1);
    expect(report).toMatchObject({ written: 2, skipped: 0, last_seq: 4 });
    expect(await archive.listParts(WS, DAY1)).toEqual([1, 3]);
    expect((await readDay(archive, WS, DAY1)).map((l) => parseEventLine(l).seq)).toEqual([1, 2, 3, 4]);
  });

  it('refuses to bridge a gap and refuses bytes that differ from what is archived', async () => {
    const archive = new MemoryArchive();
    await append(archive, [event(1), event(2)], DAY1);
    await expect(append(archive, [event(4)], DAY1)).rejects.toThrow(ArchiveRefused);
    await expect(append(archive, [event(4)], DAY1)).rejects.toMatchObject({ seq: 3 });

    const other = new MemoryArchive();
    await other.putPart(WS, DAY1, 1, [JSON.stringify(sortKeys(event(1, { seat: 'owner' })))]);
    await expect(append(other, [event(1)], DAY1)).rejects.toMatchObject({ seq: 1 });
  });

  it('gate 4: an event with an agent in `accountable` stops its workspace and stays in the outbox; the other workspace proceeds', async () => {
    const r = rig();
    r.source.emit(emittable());
    r.source.emitUnchecked(event(2, { accountable: 'prn-a-remed-2' }));
    r.source.emit(emittable()); // seq 3, behind the refused one
    r.source.emit(emittable({ workspace_id: 'ws-other' }));

    const report = await relayOnce(r.deps);
    expect(report.refused).toEqual([
      { workspace_id: WS, seq: 2, issues: [expect.objectContaining({ field: 'accountable' })] },
    ]);
    expect(report.acked).toBe(2); // seq 1 here, seq 1 there
    expect(r.source.undelivered()).toBe(2); // 2 and 3 wait; the relay never skips
    expect(await r.archive.readHead(WS)).toEqual({ last_seq: 1, day: DAY1 });
    expect(await r.archive.readHead('ws-other')).toEqual({ last_seq: 1, day: DAY1 });
  });

  it('refuses an identity provider subject in the outbox', async () => {
    const r = rig();
    r.source.emitUnchecked(event(1, { acting: 'auth0|5f1c2e' } as never));
    const report = await relayOnce(r.deps);
    expect(report.refused[0]?.issues[0]).toMatchObject({ field: 'acting' });
  });
});

describe('sealing and verifying over a store', () => {
  it('seals past days, chains them, skips empty days, and leaves today open', async () => {
    const r = rig();
    r.source.emit(emittable());
    r.source.emit(emittable());
    await relayUntilDrained(r.deps);
    r.setDay('2026-09-20');
    r.source.emit(emittable());
    await relayUntilDrained(r.deps);

    const sealed = await sealBefore(r.archive, '2026-09-20', '2026-09-20T00:07:11Z');
    expect(sealed.map((m) => [m.period, m.first_seq, m.last_seq])).toEqual([[DAY1, 1, 2]]);
    expect(await r.archive.readManifest(WS, '2026-09-20')).toBeNull();
    expect(await sealBefore(r.archive, '2026-09-20')).toEqual([]); // idempotent

    await expect(verifyRange(r.archive, WS, { to: DAY1 })).resolves.toMatchObject({ ok: true, last_seq: 2 });
    await expect(verifyRange(r.archive, WS)).resolves.toMatchObject({
      ok: false,
      period: '2026-09-20',
      reason: 'day holds events and is not sealed',
    });

    const day3 = await sealDay(r.archive, WS, '2026-09-20', '2026-09-21T00:07:11Z');
    expect(day3).toMatchObject({ first_seq: 3, last_seq: 3, prev_segment_digest: sealed[0]!.segment_digest });
    await expect(verifyRange(r.archive, WS)).resolves.toMatchObject({
      ok: true,
      first_seq: 1,
      last_seq: 3,
      segments: 2,
    });
    await expect(verifyRange(r.archive, WS, { from: '2026-09-20' })).resolves.toMatchObject({
      ok: true,
      first_seq: 3,
      segments: 1,
    });
  });

  it('refuses to append to a sealed day', async () => {
    const archive = new MemoryArchive();
    await append(archive, [event(1)], DAY1);
    await sealDay(archive, WS, DAY1);
    await expect(append(archive, [event(2)], DAY1)).rejects.toThrow(/sealed/);
    await expect(append(archive, [event(2)], DAY2)).resolves.toMatchObject({ last_seq: 2 });
  });

  it('refuses to seal a day while an earlier day with events is unsealed', async () => {
    const archive = new MemoryArchive();
    await append(archive, [event(1)], DAY1);
    await append(archive, [event(2)], DAY2);
    await expect(sealDay(archive, WS, DAY2)).rejects.toThrow(/seal it before/);
  });
});

describe('gate 3: the verifier from a laptop with every service off', () => {
  it('passes a sealed range on disk and names the first divergent seq on a tampered copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spine-'));
    const r = rig(new FsArchive(root));
    for (let i = 0; i < 6; i += 1) r.source.emit(emittable());
    await relayUntilDrained(r.deps, 4); // two parts: 1–4, 5–6
    r.setDay(DAY2);
    r.source.emit(emittable());
    await relayUntilDrained(r.deps);
    await sealBefore(r.archive, '2026-09-20');

    const logs: string[] = [];
    const log = console.log;
    console.log = (line: string) => logs.push(line);
    try {
      expect(await verifyCli([root, '--workspace', WS])).toBe(0);
      expect(logs.at(-1)).toMatch(/^pass {2}ws-aannemer-x {2}seq 1–7 {2}2 segment/);

      // Tamper with seq 5 in the second part of day 1, keeping it canonical.
      const part = join(root, WS, DAY1, partName(5));
      const lines = (await readFile(part, 'utf8')).split('\n').filter(Boolean);
      const e = JSON.parse(lines[0]!);
      e.oversight_level = 'O4';
      lines[0] = JSON.stringify(sortKeys(e));
      await writeFile(part, lines.map((l) => `${l}\n`).join(''));

      expect(await verifyCli([root, '--workspace', WS])).toBe(1);
      expect(logs.at(-1)).toMatch(
        /^FAIL {2}ws-aannemer-x {2}2026-09-18 {2}seq 5 {2}event does not match its sealed digest/,
      );
      expect(await verifyCli([root, '--workspace', WS, '--from', DAY2])).toBe(0);
    } finally {
      console.log = log;
    }
  });
});

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
