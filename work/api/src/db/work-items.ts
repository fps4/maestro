/**
 * Work items in the table (maestro ADR-0019 §2–§4): the head in its own partition with its edges
 * beside it, the open set and the closed months on `gsi1`, an application's items on `gsi2`, the
 * tallies, and the publish idempotency cache. One method per access pattern.
 */

import type { WorkItem } from '../domain/item.js';
import { isClosed, nextAt } from '../domain/item.js';
import type { Bound } from './handle.js';
import { strip, type Item, type Transaction } from './items.js';
import { KINDS, type EdgeRel, type WorkspaceKeys } from './keys.js';
import { PK } from './table.js';

export function itemToRow(keys: WorkspaceKeys, head: WorkItem): Item {
  return {
    ...keys.item(head.item_id),
    kind: KINDS.item,
    ...head,
    ...(isClosed(head)
      ? keys.closedKey(head.closed_at!, head.item_id)
      : keys.openKey(nextAt(head), head.item_id)),
    ...(head.about.application
      ? keys.applicationKey(head.about.application, head.opened_at, head.item_id)
      : {}),
  };
}

export interface Edge {
  from: string;
  rel: EdgeRel;
  to: string;
}

export interface Tally {
  application: string;
  metric: string;
  month: string;
  count: number;
}

/** A publish already answered: the caller's key → the item it raised. Not record; a day's TTL. */
export interface RequestRecord {
  principal: string;
  key: string;
  item_id: string;
}

export const REQUEST_TTL_SECONDS = 86_400;

export class WorkItemRepository {
  constructor(private readonly b: Bound) {}

  /** #1 — strongly consistent. */
  async get(id: string): Promise<WorkItem | null> {
    const row = await this.b.items.get(this.b.keys.item(id));
    return row ? strip<WorkItem>(row) : null;
  }

  async getMany(ids: string[]): Promise<WorkItem[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const rows = await this.b.items.batchGet(unique.map((id) => this.b.keys.item(id)));
    return rows.map((r) => strip<WorkItem>(r));
  }

  /** #2 — the item's edges: `blocks`, `child`, `member`. */
  async edges(id: string): Promise<Edge[]> {
    const rows = await this.b.items.query(this.b.keys.itemPartition(id), { sk: { beginsWith: 'edge#' } });
    return rows.map((r) => {
      const [, rel, to] = (r.sk as string).split('#');
      return { from: id, rel: rel as EdgeRel, to: to! };
    });
  }

  /** #3 — the open set, soonest first: the frontier, the board and Today are this, filtered. */
  async open(): Promise<WorkItem[]> {
    const rows = await this.b.items.query(this.b.keys.open, { index: 'gsi1' });
    return rows.map((r) => strip<WorkItem>(r));
  }

  /** #6 — open items whose `next_at` has come: the sweep's read. */
  async due(now: string): Promise<WorkItem[]> {
    const rows = await this.b.items.query(this.b.keys.open, {
      index: 'gsi1',
      sk: { between: ['0', `${now}#~`] },
    });
    return rows.map((r) => strip<WorkItem>(r));
  }

  /** #4 — what closed in a month, from `since` on. */
  async closedSince(since: string): Promise<WorkItem[]> {
    const rows = await this.b.items.query(this.b.keys.closed(since.slice(0, 7)), {
      index: 'gsi1',
      sk: { between: [since, `${since.slice(0, 7)}-99`] },
    });
    return rows.map((r) => strip<WorkItem>(r));
  }

  /** #7 — an application's items, open and closed, newest first. */
  async ofApplication(app: string, limit?: number): Promise<WorkItem[]> {
    const rows = await this.b.items.query(this.b.keys.application(app), {
      index: 'gsi2',
      forward: false,
      ...(limit ? { limit } : {}),
    });
    return rows.map((r) => strip<WorkItem>(r));
  }

  /**
   * Stage the head: raised on the condition it does not exist; moved on the condition that its
   * revision is the one read (a retry re-reads and re-decides); closed on the condition that it
   * has no outcome yet — write-once by the store as well as by the machine.
   */
  stage(tx: Transaction, before: WorkItem | null, after: WorkItem): void {
    const row = itemToRow(this.b.keys, after);
    if (!before) {
      tx.put(row, {
        condition: (e) => `attribute_not_exists(${e.n(PK)})`,
        onConflict: `\`${after.item_id}\` already exists: the item counter moved.`,
        retry: true,
      });
      return;
    }
    tx.put(row, {
      condition: (e) =>
        `${e.n('revision')} = ${e.v(before.revision)}` +
        (after.outcome && !before.outcome ? ` AND attribute_not_exists(${e.n('outcome')})` : ''),
      onConflict: `\`${after.item_id}\` moved while this was decided.`,
      retry: true,
    });
  }

  stageEdge(tx: Transaction, edge: Edge): void {
    tx.put({ ...this.b.keys.edge(edge.from, edge.rel, edge.to), kind: KINDS.edge, ...edge });
  }

  /** The head written as it is, unconditionally — a rebuild's. */
  async putMany(heads: WorkItem[], edges: Edge[]): Promise<void> {
    await this.b.items.batchWrite([
      ...heads.map((h) => itemToRow(this.b.keys, h)),
      ...edges.map((e) => ({ ...this.b.keys.edge(e.from, e.rel, e.to), kind: KINDS.edge, ...e })),
    ]);
  }
}

export class TallyRepository {
  constructor(private readonly b: Bound) {}

  stageAdd(tx: Transaction, name: string, by: number): void {
    const [application, metric, month] = name.split('#');
    tx.update(this.b.keys.tally(name), {
      set: { kind: KINDS.tally, application, metric, month },
      add: { count: by },
    });
  }

  /** #11 — every tally of one application, in one query. */
  async ofApplication(app: string): Promise<Tally[]> {
    const rows = await this.b.items.query(this.b.keys.tallies, { sk: { beginsWith: `${app}#` } });
    return rows.map((r) => strip<Tally>(r));
  }

  async putMany(counts: Map<string, number>): Promise<void> {
    await this.b.items.batchWrite(
      [...counts].map(([name, count]) => {
        const [application, metric, month] = name.split('#');
        return { ...this.b.keys.tally(name), kind: KINDS.tally, application, metric, month, count };
      }),
    );
  }
}

export class RequestRepository {
  constructor(private readonly b: Bound) {}

  async get(principal: string, key: string): Promise<RequestRecord | null> {
    const row = await this.b.items.get(this.b.keys.request(principal, key));
    return row ? strip<RequestRecord>(row) : null;
  }

  stage(tx: Transaction, record: RequestRecord, now: string): void {
    tx.insert(
      {
        ...this.b.keys.request(record.principal, record.key),
        kind: KINDS.request,
        ...record,
        expires_at: Math.floor(Date.parse(now) / 1000) + REQUEST_TTL_SECONDS,
      },
      `The key \`${record.key}\` was used by \`${record.principal}\` already.`,
    );
  }
}

/** An armed evidence entry, under the key its fact will compute (ADR-0019 §5, §3 #8). */
export interface Expectation {
  key: string;
  item_id: string;
  index: number;
}

export class ExpectationRepository {
  constructor(private readonly b: Bound) {}

  /** #8 — the open items waiting on a fact's key: one partition. */
  async waitingOn(key: string): Promise<Expectation[]> {
    const rows = await this.b.items.query(this.b.keys.expectations(key));
    return rows.map((r) => strip<Expectation>(r));
  }

  stagePut(tx: Transaction, e: Expectation): void {
    tx.put({ ...this.b.keys.expectation(e.key, e.item_id, e.index), kind: KINDS.expectation, ...e });
  }

  stageDelete(tx: Transaction, e: Expectation): void {
    tx.delete(this.b.keys.expectation(e.key, e.item_id, e.index));
  }

  async putMany(all: Expectation[]): Promise<void> {
    await this.b.items.batchWrite(
      all.map((e) => ({
        ...this.b.keys.expectation(e.key, e.item_id, e.index),
        kind: KINDS.expectation,
        ...e,
      })),
    );
  }
}

/** A fingerprint's window: the item it raised and until when a repeat attaches to it (ADR-0019 §7). */
export interface FingerprintWindow {
  fingerprint: string;
  item_id: string;
  window_until: string;
}

export class FingerprintRepository {
  constructor(private readonly b: Bound) {}

  async get(fp: string): Promise<FingerprintWindow | null> {
    const row = await this.b.items.get(this.b.keys.fingerprint(fp));
    return row ? strip<FingerprintWindow>(row) : null;
  }

  /** Moved on the condition that it has not moved since it was read: two racing signals raise one item. */
  stage(tx: Transaction, next: FingerprintWindow, read: FingerprintWindow | null): void {
    tx.put(
      { ...this.b.keys.fingerprint(next.fingerprint), kind: KINDS.fingerprint, ...next },
      {
        condition: (e) =>
          read
            ? `${e.n('item_id')} = ${e.v(read.item_id)} AND ${e.n('window_until')} = ${e.v(read.window_until)}`
            : `attribute_not_exists(${e.n(PK)})`,
        onConflict: `Fingerprint \`${next.fingerprint}\` moved while this signal was decided.`,
        retry: true,
      },
    );
  }

  async putMany(all: FingerprintWindow[]): Promise<void> {
    await this.b.items.batchWrite(
      all.map((f) => ({ ...this.b.keys.fingerprint(f.fingerprint), kind: KINDS.fingerprint, ...f })),
    );
  }
}

/** The week's obligation a fold raised (ADR-0019 §7, ADR-0025): `<fold>#<application>#<environment>#<period>` → its item. */
export interface FoldRecord {
  fold: string;
  item_id: string;
}

export class FoldRepository {
  constructor(private readonly b: Bound) {}

  private key(fold: string) {
    const at = fold.lastIndexOf('#');
    return this.b.keys.fold(fold.slice(0, at), fold.slice(at + 1));
  }

  async get(fold: string): Promise<FoldRecord | null> {
    const row = await this.b.items.get(this.key(fold));
    return row ? strip<FoldRecord>(row) : null;
  }

  /**
   * Raised once a week: the first finding wins, every later one attaches. Moved only on the condition
   * that it still names the item that was read — when that week's obligation closed early and another
   * finding arrives, it raises the week's next one.
   */
  stage(tx: Transaction, record: FoldRecord, read: FoldRecord | null): void {
    tx.put(
      { ...this.key(record.fold), kind: KINDS.fold, ...record },
      {
        condition: (e) =>
          read ? `${e.n('item_id')} = ${e.v(read.item_id)}` : `attribute_not_exists(${e.n(PK)})`,
        onConflict: `The week's \`${record.fold}\` was raised first by another finding.`,
        retry: true,
      },
    );
  }

  async putMany(all: FoldRecord[]): Promise<void> {
    await this.b.items.batchWrite(all.map((f) => ({ ...this.key(f.fold), kind: KINDS.fold, ...f })));
  }
}

/** A delivery already taken in, and what it became. Not record: an idempotency cache, seven days. */
export interface DeliveryRecord {
  source: string;
  delivery_id: string;
  outcome: string;
  item_ids: string[];
}

export const DELIVERY_TTL_SECONDS = 7 * 86_400;

export class DeliveryRepository {
  constructor(private readonly b: Bound) {}

  async get(source: string, id: string): Promise<DeliveryRecord | null> {
    const row = await this.b.items.get(this.b.keys.delivery(source, id));
    return row ? strip<DeliveryRecord>(row) : null;
  }

  private row(d: DeliveryRecord, now: string): Item {
    return {
      ...this.b.keys.delivery(d.source, d.delivery_id),
      kind: KINDS.delivery,
      ...d,
      expires_at: Math.floor(Date.parse(now) / 1000) + DELIVERY_TTL_SECONDS,
    };
  }

  /** In the raising transaction: a redelivery fails the condition and is answered with the first result. */
  stageInsert(tx: Transaction, d: DeliveryRecord, now: string): void {
    tx.insert(this.row(d, now), `Delivery \`${d.source}:${d.delivery_id}\` was already taken in.`);
  }

  /** After the facts it carried were applied — each of those was idempotent on its own. */
  async put(d: DeliveryRecord, now: string): Promise<void> {
    await this.b.items.put(this.row(d, now));
  }
}
