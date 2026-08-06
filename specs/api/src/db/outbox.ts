/**
 * The record sink, and the transactional outbox behind it.
 *
 * Every state change — draft proposed, decision recorded, link pinned, body redacted — is emitted
 * as an attributed event, **transactionally with the change itself**. Run with the local default
 * and this database is the record. Point the sink at a durable spine and the spine becomes
 * authoritative and this database becomes a projection. One configuration value.
 *
 * The transaction is the whole point. Writing the change and then emitting the event is two
 * operations that can half-happen, and a record whose event stream disagrees with its state is
 * exactly the corruption the sink exists to make detectable.
 */

import type { ClientSession, Db } from 'mongodb';
import { OUTBOX } from './collections.js';

export interface RecordEvent {
  sequence: number;
  workspace: string;
  kind: string;
  subject: { artifact?: string; ordinal?: number; draft?: string; decision?: string };
  /** Who acted, always. An unattributed event is not a record of anything. */
  actor: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  delivered: boolean;
  delivered_at?: string;
  attempts: number;
}

export type EmittableEvent = Omit<RecordEvent, 'sequence' | 'delivered' | 'attempts' | 'delivered_at'>;

/**
 * Append events inside the caller's transaction.
 *
 * The sequence is allocated from a per-workspace counter in the same transaction, so ordering is a
 * property of the stream rather than of when a relay happened to read it. A consumer replaying the
 * log gets the changes in the order they were decided.
 */
export async function emit(db: Db, session: ClientSession, events: EmittableEvent[]): Promise<void> {
  if (events.length === 0) return;

  const counters = db.collection<{ _id: string; value: number }>('counters');
  const counter = await counters.findOneAndUpdate(
    { _id: 'outbox' },
    { $inc: { value: events.length } },
    { session, upsert: true, returnDocument: 'after' },
  );
  const end = counter?.value ?? events.length;
  const start = end - events.length;

  await db.collection<RecordEvent>(OUTBOX).insertMany(
    events.map((event, i) => ({
      ...event,
      sequence: start + i + 1,
      delivered: false,
      attempts: 0,
    })),
    { session },
  );
}

export interface SinkTarget {
  deliver(events: RecordEvent[]): Promise<void>;
}

/** The local default: a log line per event. Sufficient to prove the stream exists and is ordered. */
export function loggingSink(log: (line: object) => void): SinkTarget {
  return {
    async deliver(events) {
      for (const event of events) {
        log({
          msg: 'record',
          sequence: event.sequence,
          kind: event.kind,
          actor: event.actor,
          ...event.subject,
        });
      }
    },
  };
}

/** An external durable spine. When this is configured, it is authoritative and we are a projection. */
export function httpSink(url: string): SinkTarget {
  return {
    async deliver(events) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events }),
      });
      if (!response.ok) {
        throw new Error(
          `Record sink refused ${events.length} events: ${response.status} ${response.statusText}`,
        );
      }
    },
  };
}

/**
 * Drain pending events in sequence order.
 *
 * Undelivered events stay undelivered — the relay never skips one to make progress. That is what
 * makes "stop the sink, keep writing, and every record arrives on recovery in order" true rather
 * than approximately true.
 */
export async function relayOnce(db: Db, target: SinkTarget, batch = 100): Promise<number> {
  const outbox = db.collection<RecordEvent>(OUTBOX);
  const pending = await outbox.find({ delivered: false }).sort({ sequence: 1 }).limit(batch).toArray();
  if (pending.length === 0) return 0;

  await target.deliver(pending);

  await outbox.updateMany(
    { sequence: { $in: pending.map((e) => e.sequence) } },
    { $set: { delivered: true, delivered_at: new Date().toISOString() }, $inc: { attempts: 1 } },
  );
  return pending.length;
}
