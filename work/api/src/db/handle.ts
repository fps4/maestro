/**
 * The workspace handle: typed repositories bound to one workspace's key prefix.
 *
 * A handle is acquired once per request, for the one workspace the caller is a member of, and no
 * repository here accepts a workspace id or a raw client — every key is built from the handle's
 * own layout, and the item access under it refuses any key outside `ws#<workspace>#` before a
 * request is made (maestro ADR-0018). One method per access pattern (maestro ADR-0019 §3); a
 * pattern nobody reads has no method.
 */

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { SpineEvent } from '@fps4/maestro-spine';
import { Conflict, Items, strip, type Item, type Transaction } from './items.js';
import { KINDS, workspaceKeys, type WorkspaceKeys } from './keys.js';
import { PK } from './table.js';
import { RequestRepository, TallyRepository, WorkItemRepository } from './work-items.js';

export { Conflict, IsolationViolation, Transaction } from './items.js';

/** One outbox row: the envelope plus the relay's bookkeeping. `workspace` is this service's id. */
export interface OutboxRow extends SpineEvent {
  workspace: string;
  delivered: boolean;
  delivered_at?: string;
  attempts: number;
}

/**
 * What a workspace grants a principal: the seats it may occupy and the service roles it holds
 * (`intake`, `workspace_admin`). For an agent, the human answerable for what it does here — without
 * one an agent holds seats it cannot act in. Memberships are grants, not record.
 */
export interface Membership {
  principal: string;
  roles: string[];
  accountable?: string;
  granted_at: string;
  granted_by: string;
}

/**
 * How events are projected into this workspace's items. A change to the projection bumps this, and
 * a workspace whose `meta` item is behind refuses to serve until it is rebuilt from the archive.
 */
export const PROJECTION_VERSION = 1;

export interface ProjectionMeta {
  projection_version: number;
}

const RETRIES = 4;

export interface Bound {
  items: Items;
  keys: WorkspaceKeys;
  workspace: string;
}

export class MembershipRepository {
  constructor(private readonly b: Bound) {}

  async get(principal: string): Promise<Membership | null> {
    const item = await this.b.items.get(this.b.keys.membership(principal));
    return item ? strip<Membership>(item) : null;
  }

  async list(): Promise<Membership[]> {
    const items = await this.b.items.query(this.b.keys.memberships);
    return items.map((i) => strip<Membership>(i));
  }

  /** Grant or replace. A grant is the operator's act; it is not emitted to the spine. */
  async put(membership: Membership): Promise<void> {
    await this.b.items.put({
      ...this.b.keys.membership(membership.principal),
      kind: KINDS.membership,
      ...membership,
    });
  }
}

function outboxToItem(keys: WorkspaceKeys, row: OutboxRow): Item {
  return {
    ...keys.outboxItem(row.seq),
    kind: KINDS.outbox,
    ...(row.delivered ? {} : keys.pending(row.seq)),
    ...row,
  };
}

export class OutboxRepository {
  constructor(private readonly b: Bound) {}

  /** Every row, in sequence. */
  async list(): Promise<OutboxRow[]> {
    const items = await this.b.items.query(this.b.keys.outbox);
    return items.map((i) => strip<OutboxRow>(i));
  }

  /** Undelivered rows, oldest first (the sparse `pending` index). */
  async pending(limit: number): Promise<OutboxRow[]> {
    const items = await this.b.items.query(this.b.keys.outbox, { index: 'pending', limit });
    return items.map((i) => strip<OutboxRow>(i));
  }

  /** `(workspace, seq)` is the key: the spine's rule, enforced by the put. */
  insert(row: OutboxRow, tx: Transaction): void {
    tx.insert(outboxToItem(this.b.keys, row), `Outbox seq ${row.seq} is already taken.`);
  }

  /** A rebuild's: rows restored from the archive, already delivered. */
  async insertMany(rows: OutboxRow[]): Promise<void> {
    await this.b.items.batchWrite(rows.map((row) => outboxToItem(this.b.keys, row)));
  }

  /** Delivered: leave the pending index, count the attempt. Idempotent. */
  async ack(seq: number, at: string): Promise<void> {
    await this.b.items.update(this.b.keys.outboxItem(seq), {
      set: { delivered: true, delivered_at: at },
      remove: ['pending_pk', 'pending_sk'],
      add: { attempts: 1 },
      condition: (e) => `attribute_exists(${e.n(PK)})`,
      onConflict: `Outbox seq ${seq} does not exist.`,
    });
  }
}

export class CounterRepository {
  constructor(private readonly b: Bound) {}

  async get(name: string): Promise<number> {
    const item = await this.b.items.get<{ value: number }>(this.b.keys.counter(name), ['value']);
    return item?.value ?? 0;
  }

  /**
   * Move a counter from the value that was read, in a transaction: the condition is what makes a
   * sequence a property of the stream. A counter that moved re-runs the caller.
   */
  bump(name: string, expected: number, by: number, tx: Transaction): void {
    tx.update(this.b.keys.counter(name), {
      set: { kind: KINDS.counter, value: expected + by },
      condition: (e) =>
        expected === 0 ? `attribute_not_exists(${e.n(PK)})` : `${e.n('value')} = ${e.v(expected)}`,
      onConflict: `The workspace's \`${name}\` counter moved: another act was recorded first.`,
      retry: true,
    });
  }

  /** A rebuild's: the counters the emitting transactions would have left. */
  async putMany(counters: Array<{ name: string; value: number }>): Promise<void> {
    await this.b.items.batchWrite(
      counters.map((c) => ({ ...this.b.keys.counter(c.name), kind: KINDS.counter, value: c.value })),
    );
  }
}

export class MetaRepository {
  constructor(private readonly b: Bound) {}

  async get(): Promise<ProjectionMeta | null> {
    const item = await this.b.items.get(this.b.keys.meta());
    return item ? strip<ProjectionMeta>(item) : null;
  }

  async put(meta: ProjectionMeta): Promise<void> {
    await this.b.items.put({ ...this.b.keys.meta(), kind: KINDS.meta, ...meta });
  }

  /** Stamp a workspace nothing has stamped; leave an existing stamp alone. */
  async putIfAbsent(meta: ProjectionMeta): Promise<void> {
    try {
      await this.b.items.insert({ ...this.b.keys.meta(), kind: KINDS.meta, ...meta }, 'stamped');
    } catch (error) {
      if (!(error instanceof Conflict)) throw error;
    }
  }
}

/** Reads and writes, bound to exactly one workspace's key prefix. */
export interface WorkspaceHandle {
  readonly workspace: string;
  readonly memberships: MembershipRepository;
  readonly outbox: OutboxRepository;
  readonly counters: CounterRepository;
  readonly meta: MetaRepository;
  readonly items: WorkItemRepository;
  readonly tallies: TallyRepository;
  readonly requests: RequestRepository;
  /**
   * One transaction over this workspace's items: `work` reads what it needs and stages its writes
   * on `tx`, each with the condition that makes its reads still true; the commit is all or nothing.
   * A condition marked `retry` that fails — a counter or a revision moved — re-runs `work`, which
   * reads again and decides again; anything else is a `Conflict` for the caller.
   */
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}

export function bind(doc: DynamoDBDocumentClient, table: string, workspace: string): Bound {
  const keys = workspaceKeys(workspace);
  return { items: new Items(doc, table, keys.prefix), keys, workspace };
}

export function workspaceHandle(
  doc: DynamoDBDocumentClient,
  table: string,
  workspace: string,
): WorkspaceHandle {
  const b = bind(doc, table, workspace);
  return {
    workspace,
    memberships: new MembershipRepository(b),
    outbox: new OutboxRepository(b),
    counters: new CounterRepository(b),
    meta: new MetaRepository(b),
    items: new WorkItemRepository(b),
    tallies: new TallyRepository(b),
    requests: new RequestRepository(b),
    async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
      for (let attempt = 1; ; attempt += 1) {
        const tx = b.items.transaction();
        const result = await work(tx);
        try {
          await tx.commit();
          return result;
        } catch (error) {
          if (error instanceof Conflict && error.retry && attempt < RETRIES) continue;
          throw error;
        }
      }
    },
  };
}
