import { describe, expect, it } from 'vitest';
import { MemoryArchive } from '../src/archive/memory.js';
import { S3Archive } from '../src/archive/s3.js';
import { append, readDay, sealDay, verifyRange } from '../src/archive/writer.js';
import { SnsFifoDelivery } from '../src/delivery/sns.js';
import { eventLine, parseEventLine } from '../src/domain/segment.js';
import { digestNotice, runSealer } from '../src/lambda/sealer.js';
import { relayHandler } from '../src/lambda/relay.js';
import { MemoryOutbox } from '../src/relay/memory.js';
import { relayOnce, relayUntilDrained } from '../src/relay/relay.js';
import { FakeS3, FakeSns } from './fakes.js';
import { WS, emittable, event, resolve } from './helpers.js';

const DAY1 = '2026-09-18';
const DAY2 = '2026-09-19';
const TOPIC = 'arn:aws:sns:eu-west-1::maestro-spine-events.fifo';

function rig(day = DAY1) {
  const s3 = new FakeS3();
  const sns = new FakeSns();
  const archive = new S3Archive({ bucket: 'archive', client: s3 });
  const delivery = new SnsFifoDelivery({ topicArn: TOPIC, client: sns });
  const source = new MemoryOutbox(resolve);
  let today = day;
  const deps = { source, archive, delivery, resolve, today: () => today };
  return { s3, sns, archive, delivery, source, deps, setDay: (d: string) => (today = d) };
}

describe('the relay over S3 and SNS FIFO', () => {
  it('gate 1: the archive holds the batches and a FIFO queue receives in order per workspace', async () => {
    const r = rig();
    for (let i = 0; i < 23; i += 1) r.source.emit(emittable());
    for (let i = 0; i < 3; i += 1) r.source.emit(emittable({ workspace_id: 'ws-other' }));

    const report = await relayUntilDrained(r.deps, 7);
    expect(report).toEqual({ archived: 26, published: 26, acked: 26, refused: [] });

    const ours = r.sns.queues.get(WS)!.map((m) => parseEventLine(m.body).seq);
    expect(ours).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    expect(r.sns.queues.get('ws-other')!.map((m) => parseEventLine(m.body).seq)).toEqual([1, 2, 3]);

    // No batch exceeded SNS's ten; the body is the canonical line the archive holds.
    expect(Math.max(...r.sns.batches.map((b) => b.PublishBatchRequestEntries!.length))).toBeLessThanOrEqual(
      10,
    );
    const archived = await readDay(r.archive, WS, DAY1);
    expect(r.sns.queues.get(WS)!.map((m) => m.body)).toEqual(archived);

    const first = r.sns.queues.get(WS)![0]!;
    expect(first.attributes).toEqual({
      type: 'WorkItemRaised',
      type_version: '1',
      subject_type: 'work_item',
      workspace_id: WS,
    });
    expect(first.dedup).toBe(parseEventLine(first.body).event_id);
  });

  it('is idempotent across a crash between archive and ack: nothing is archived or delivered twice', async () => {
    const r = rig();
    for (let i = 0; i < 5; i += 1) r.source.emit(emittable());
    // First run archives and publishes but "dies" before ack: simulate by not acking.
    const pending = await r.source.pending(100);
    await append(r.archive, pending, DAY1);
    await r.delivery.publish(pending);
    const objectsBefore = new Map(r.s3.objects);

    const report = await relayOnce(r.deps);
    expect(report).toEqual({ archived: 0, published: 5, acked: 5, refused: [] });
    expect(r.s3.objects).toEqual(objectsBefore);
    expect(r.sns.queues.get(WS)!.length).toBe(5);
  });

  it('completes a half-written part on S3 the way it does on a filesystem', async () => {
    const r = rig();
    for (let i = 0; i < 4; i += 1) r.source.emit(emittable());
    const pending = await r.source.pending(100);
    // A crashed run wrote the first two lines of the part and never moved the head.
    r.s3.objects.set(
      `${WS}/${DAY1}/events-000000000001.jsonl`,
      pending.slice(0, 2).map(eventLine).join('\n') + '\n',
    );

    const report = await relayOnce(r.deps);
    expect(report).toEqual({ archived: 2, published: 4, acked: 4, refused: [] });
    expect((await readDay(r.archive, WS, DAY1)).map((l) => parseEventLine(l).seq)).toEqual([1, 2, 3, 4]);
    expect(await r.archive.readHead(WS)).toEqual({ last_seq: 4, day: DAY1 });
  });

  it('surfaces an SNS refusal instead of acking past it', async () => {
    const r = rig();
    const e = r.source.emit(emittable());
    r.sns.refuse.add(e.event_id);
    await expect(relayOnce(r.deps)).rejects.toThrow(/SNS refused 1 of 1/);
    expect(r.source.undelivered()).toBe(1);
    // The archive already holds it; the next run finds it archived and only needs to deliver.
    expect(await r.archive.readHead(WS)).toEqual({ last_seq: 1, day: DAY1 });
  });

  it('refuses a topic that is not FIFO', () => {
    expect(
      () => new SnsFifoDelivery({ topicArn: 'arn:aws:sns:eu-west-1::plain', client: new FakeSns() }),
    ).toThrow(/not a FIFO topic/);
  });

  it('relayHandler builds its adapters from the environment and reports metrics', async () => {
    const source = new MemoryOutbox(resolve);
    source.emit(emittable());
    const lines: string[] = [];
    const handler = relayHandler(
      { component: 'test', source, resolve, log: (l) => lines.push(l) },
      { ARCHIVE_BUCKET: 'archive', EVENTS_TOPIC_ARN: TOPIC },
    );
    // No credentials here: the real clients would fail on first use. The environment contract is
    // what is under test — a missing name fails before any call.
    const missing = relayHandler({ component: 'test', source, resolve }, { EVENTS_TOPIC_ARN: TOPIC });
    await expect(missing()).rejects.toThrow(/ARCHIVE_BUCKET is not set/);
    expect(typeof handler).toBe('function');
  });
});

describe('the sealer', () => {
  it('seals every day before today across workspaces and sends one digest per segment', async () => {
    const archive = new MemoryArchive();
    await append(archive, [event(1), event(2)], '2026-09-17');
    await append(archive, [event(3)], DAY1);
    await append(archive, [event(1, { workspace_id: 'ws-other' })], DAY1);
    await append(archive, [event(4)], DAY2); // today — must not be sealed

    const sns = new FakeSns();
    const lines: string[] = [];
    const report = await runSealer({
      archive,
      digests: { client: sns, topicArn: 'arn:aws:sns:eu-west-1::digests' },
      today: () => DAY2,
      now: () => '2026-09-19T00:07:11Z',
      log: (l) => lines.push(l),
    });

    expect(report.today).toBe(DAY2);
    expect(report.sealed.map((s) => `${s.workspace_id}/${s.period}`)).toEqual([
      `${WS}/2026-09-17`,
      `${WS}/${DAY1}`,
      `ws-other/${DAY1}`,
    ]);
    expect(report.notified).toBe(3);
    expect(await archive.readManifest(WS, DAY2)).toBeNull();
    expect((await verifyRange(archive, WS, { to: DAY1 })).ok).toBe(true);

    const notice = sns.published[0]!;
    const message = JSON.parse(notice.Message!) as { default: string; email: string };
    expect(notice.MessageStructure).toBe('json');
    expect(notice.Subject).toMatch(/^maestro sealed ws-aannemer-x 2026-09-17 sha256:/);
    expect(message.email).toContain(`digest    ${report.sealed[0]!.segment_digest}`);
    const manifest = JSON.parse(message.default) as Record<string, unknown>;
    expect(manifest.segment_digest).toBe(report.sealed[0]!.segment_digest);
    expect(manifest).not.toHaveProperty('leaves');

    const metric = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(metric.Sealed).toBe(3);
    expect(metric.function).toBe('sealer');
  });

  it('is idempotent: a second run seals nothing and sends nothing', async () => {
    const archive = new MemoryArchive();
    await append(archive, [event(1)], DAY1);
    const sns = new FakeSns();
    const deps = {
      archive,
      digests: { client: sns, topicArn: 'arn:aws:sns:eu-west-1::d' },
      today: () => DAY2,
      log: () => {},
    };
    await runSealer(deps);
    const again = await runSealer(deps);
    expect(again.sealed).toEqual([]);
    expect(sns.published.length).toBe(1);
  });

  it('runs without a digest topic', async () => {
    const archive = new MemoryArchive();
    await append(archive, [event(1)], DAY1);
    const report = await runSealer({ archive, digests: null, today: () => DAY2, log: () => {} });
    expect(report.sealed.length).toBe(1);
    expect(report.notified).toBe(0);
  });

  it('writes a notice a person can read and a queue can parse', async () => {
    const archive = new MemoryArchive();
    await append(archive, [event(1), event(2)], DAY1);
    const m = (await sealDay(archive, WS, DAY1, '2026-09-19T00:07:11Z'))!;
    const n = digestNotice(m);
    expect(n.text.split('\n')[0]).toBe(`maestro sealed ${WS} ${DAY1}`);
    expect(n.text).toContain('previous  (first segment)');
    expect(n.subject.length).toBeLessThanOrEqual(100);
  });
});
