/**
 * The rebuild: a workspace's items from the archive and the payloads alone (maestro ADR-0019 §4).
 *
 * Verify first — an archive the spine's verifier does not pass is not rebuilt from. Then replay
 * every event in `seq` order through the same `evolve` the live path uses, fetching each payload by
 * reference and checking it against the event's digest before anything reads it. Heads, edges and
 * tallies are all derived from the events, so what comes out reads identically to what was dropped.
 *
 * Not rebuilt: memberships (grants, re-applied from the tenant's configuration), deliveries and
 * requests (idempotency caches with a TTL).
 */

import {
  parseEventLine,
  readDay,
  verifyRange,
  type ArchiveStore,
  type SpineEvent,
} from '@fps4/maestro-spine';
import type { Store } from '../db/client.js';
import { PROJECTION_VERSION, type OutboxRow } from '../db/handle.js';
import type { Edge, FingerprintWindow, FoldRecord } from '../db/work-items.js';
import { armed } from '../domain/evidence.js';
import { evolve, talliesOf, type ItemEvent } from '../domain/events.js';
import { spineWorkspaceId } from '../domain/ids.js';
import type { WorkItem } from '../domain/item.js';
import { readPayload, type PayloadStore } from '../record/payload-store.js';

export class RebuildRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RebuildRefused';
  }
}

export interface RebuildInput {
  workspace: string;
  archive: ArchiveStore;
  payloads: PayloadStore;
  /** Drop a populated target first. Without it a populated target is refused. */
  force?: boolean;
  now?: () => string;
}

export interface RebuildReport {
  workspace: string;
  events: number;
  items: number;
  open: number;
  closed: number;
}

const OUTBOX_BATCH = 500;

export class RebuildService {
  constructor(private readonly store: Store) {}

  async rebuild(input: RebuildInput): Promise<RebuildReport> {
    const now = input.now ?? (() => new Date().toISOString());
    const ws = spineWorkspaceId(input.workspace);

    const verdict = await verifyRange(input.archive, ws);
    if (!verdict.ok) {
      throw new RebuildRefused(
        `The archive for \`${ws}\` does not verify at ${verdict.period || '(no period)'}` +
          `${verdict.seq === null ? '' : `, seq ${verdict.seq}`}: ${verdict.reason}. ` +
          'A workspace is not rebuilt from an unverified archive.',
      );
    }

    if (input.force) await this.store.dropWorkspace(input.workspace);
    const populated = await this.store.populatedRecordKinds(input.workspace);
    if (populated.length > 0) {
      throw new RebuildRefused(
        `Workspace \`${input.workspace}\` is not empty (it holds ${populated.join(', ')} items). ` +
          'Pass --force to drop it and rebuild from the archive.',
      );
    }
    const handle = await this.store.handle(input.workspace);

    const heads = new Map<string, WorkItem>();
    const edges: Edge[] = [];
    // Derived from the events like the heads: each fingerprint's window and the item it names, each
    // week's fold; the expectations from the heads as they end.
    const windows = new Map<string, FingerprintWindow>();
    const folds = new Map<string, FoldRecord>();
    const tallies = new Map<string, number>();
    const rows: OutboxRow[] = [];
    let expected = 1;
    let last = 0;
    let highest = 0;
    const deliveredAt = now();

    for (const day of await input.archive.listDays(ws)) {
      for (const line of await readDay(input.archive, ws, day)) {
        const event = parseEventLine(line);
        if (event.seq !== expected) {
          throw new RebuildRefused(
            `The archive for \`${ws}\` skips from seq ${expected - 1} to ${event.seq}.`,
          );
        }
        const item = await this.itemEvent(event, input.payloads);
        let head: WorkItem;
        try {
          head = evolve(heads.get(item.item) ?? null, item);
        } catch (error) {
          throw refuse(event, (error as Error).message);
        }
        if (head.revision !== event.subject_seq) {
          throw refuse(
            event,
            `the item is at revision ${head.revision}, but the event says ${event.subject_seq}`,
          );
        }
        heads.set(item.item, head);
        for (const t of talliesOf(head, item)) tallies.set(t, (tallies.get(t) ?? 0) + 1);
        if (item.type === 'WorkItemRaised') {
          if (item.body.parent) edges.push({ from: item.body.parent, rel: 'child', to: item.item });
          if (item.body.milestone) edges.push({ from: item.body.milestone, rel: 'member', to: item.item });
          for (const blocker of item.body.blocked_by ?? []) {
            edges.push({ from: blocker, rel: 'blocks', to: item.item });
          }
          highest = Math.max(highest, Number(item.item.slice('wrk-'.length)));
          const { fingerprint, fingerprint_until, fold } = item.body;
          if (fingerprint && fingerprint_until) {
            windows.set(fingerprint, { fingerprint, item_id: item.item, window_until: fingerprint_until });
          }
          if (fold) folds.set(fold, { fold, item_id: item.item });
        }
        if (item.type === 'WorkItemSignalAttached' && item.body.fingerprint_until) {
          const w = windows.get(item.body.fingerprint);
          if (w && w.item_id === item.item) w.window_until = item.body.fingerprint_until;
        }
        rows.push({
          ...event,
          workspace: input.workspace,
          delivered: true,
          delivered_at: deliveredAt,
          attempts: 1,
        });
        if (rows.length >= OUTBOX_BATCH) await handle.outbox.insertMany(rows.splice(0));
        last = event.seq;
        expected += 1;
      }
    }
    if (rows.length > 0) await handle.outbox.insertMany(rows);

    await handle.items.putMany([...heads.values()], edges);
    await handle.fingerprints.putMany([...windows.values()]);
    await handle.folds.putMany([...folds.values()]);
    await handle.expectations.putMany(
      [...heads.values()].flatMap((h) =>
        armed(h).map((a) => ({ key: a.key, item_id: h.item_id, index: a.index })),
      ),
    );
    await handle.tallies.putMany(tallies);
    const counters = [
      ...(last > 0 ? [{ name: 'outbox', value: last }] : []),
      ...(highest > 0 ? [{ name: 'item', value: highest }] : []),
    ];
    if (counters.length > 0) await handle.counters.putMany(counters);
    await handle.meta.put({ projection_version: PROJECTION_VERSION });

    const all = [...heads.values()];
    const closed = all.filter((h) => h.state === 'closed').length;
    return { workspace: input.workspace, events: last, items: all.length, open: all.length - closed, closed };
  }

  /** The envelope as the fold reads it, with its payload fetched and checked against its digest. */
  private async itemEvent(event: SpineEvent, payloads: PayloadStore): Promise<ItemEvent> {
    if (event.subject_type !== 'work_item') {
      throw refuse(event, `subject type \`${event.subject_type}\` is not projected`);
    }
    let payload: unknown;
    if (event.payload_ref && event.payload_digest) {
      try {
        payload = await readPayload(payloads, { ref: event.payload_ref, digest: event.payload_digest });
      } catch (error) {
        throw refuse(event, (error as Error).message);
      }
    }
    return {
      type: event.type,
      item: event.subject_id,
      at: event.occurred_at,
      accountable: event.accountable,
      acting: event.acting,
      seat: event.seat,
      oversight_level: event.oversight_level,
      body: event.body,
      ...(payload !== undefined ? { payload } : {}),
    } as ItemEvent;
  }
}

function refuse(event: SpineEvent, why: string): RebuildRefused {
  return new RebuildRefused(`Cannot project seq ${event.seq} (${event.type}, ${event.subject_id}): ${why}`);
}
