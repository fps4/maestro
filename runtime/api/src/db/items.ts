/**
 * Item access bound to a key prefix — the mechanism under every handle (maestro ADR-0018).
 *
 * `Items` reads and writes the table, and every key that passes through it must begin with the
 * prefix it was built for: a workspace's `ws#<id>#`, or `ctl#`. A key outside the prefix is an
 * `IsolationViolation`, thrown before any request is made. The repositories in `handle.ts` build
 * keys from their workspace's layout so they never trip it; the guard exists for the code that
 * would, one refactor from now.
 *
 * Reads of the table are strongly consistent — a service reads, decides, and writes on a
 * condition, and a stale read would only turn into a spurious refusal, but why pay for one. Index
 * reads are eventually consistent; DynamoDB offers nothing else, and the ADR says where that shows.
 */

import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
  type CancellationReason,
} from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { Expr } from './expr.js';
import type { Key } from './keys.js';
import {
  GSI1,
  GSI1_PK,
  GSI1_SK,
  GSI2,
  GSI2_PK,
  GSI2_SK,
  KEY_ATTRIBUTES,
  PENDING,
  PENDING_PK,
  PENDING_SK,
  PK,
  SK,
  type IndexName,
} from './table.js';

export type { Key } from './keys.js';

export class IsolationViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsolationViolation';
  }
}

/**
 * A write was refused by its condition: the item moved between the read and the write. `retry`
 * says whether re-running the whole read–decide–write is the right response (a counter or an
 * item's revision moved: someone else recorded first, so read again and decide again) or the
 * caller must be told (a uniqueness the caller asked for is taken).
 */
export class Conflict extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
    this.name = 'Conflict';
  }
}

export type Item = Record<string, unknown> & Key;

export interface SortCondition {
  eq?: string;
  beginsWith?: string;
  between?: [string, string];
}

export interface QueryOptions {
  index?: IndexName;
  sk?: SortCondition;
  /** A filter clause built on `expr`, applied after the read. */
  filter?: (e: Expr) => string;
  /** Stop after this many items; without it, every page. */
  limit?: number;
  /** Ascending by sort key unless false. */
  forward?: boolean;
  /** Attributes to return; the keys always come. */
  projection?: string[];
}

export interface WriteOptions {
  /** A condition on the item as it is; `onConflict` is the sentence when it fails. */
  condition?: (e: Expr) => string;
  onConflict?: string;
}

export interface UpdateSpec extends WriteOptions {
  set?: Record<string, unknown>;
  setRaw?: (e: Expr) => Array<[field: string, expression: string]>;
  remove?: string[];
  add?: Record<string, number>;
}

const INDEX_KEYS: Record<IndexName, [string, string]> = {
  [GSI1]: [GSI1_PK, GSI1_SK],
  [GSI2]: [GSI2_PK, GSI2_SK],
  [PENDING]: [PENDING_PK, PENDING_SK],
};

const BATCH_GET = 100;
const BATCH_WRITE = 25;
export const TRANSACTION_LIMIT = 100;

export class Items {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
    readonly prefix: string,
  ) {}

  /** The guard. Every partition key this instance touches must carry its prefix. */
  guard(pk: unknown, what = 'key'): void {
    if (typeof pk !== 'string' || !pk.startsWith(this.prefix)) {
      throw new IsolationViolation(
        `A ${what} \`${String(pk)}\` is outside \`${this.prefix}\`: this handle serves one prefix and reaches no other.`,
      );
    }
  }

  private guardItem(item: Record<string, unknown>): void {
    this.guard(item[PK]);
    for (const attribute of [GSI1_PK, GSI2_PK, PENDING_PK]) {
      if (item[attribute] !== undefined) this.guard(item[attribute], `${attribute} value`);
    }
  }

  async get<T = Item>(key: Key, projection?: string[]): Promise<T | null> {
    this.guard(key.pk);
    const e = new Expr();
    const { Item: found } = await this.doc.send(
      new GetCommand({
        TableName: this.table,
        Key: key,
        ConsistentRead: true,
        ...(projection ? { ProjectionExpression: projection.map((p) => e.n(p)).join(', ') } : {}),
        ...e.attributes(),
      }),
    );
    return (found as T | undefined) ?? null;
  }

  /** Up to a hundred at a time, in the order asked; a missing key is simply absent. */
  async batchGet<T = Item>(keys: Key[], projection?: string[]): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < keys.length; i += BATCH_GET) {
      let pending: Key[] = keys.slice(i, i + BATCH_GET);
      for (const key of pending) this.guard(key.pk);
      while (pending.length > 0) {
        const e = new Expr();
        const { Responses, UnprocessedKeys } = await this.doc.send(
          new BatchGetCommand({
            RequestItems: {
              [this.table]: {
                Keys: pending,
                ConsistentRead: true,
                ...(projection ? { ProjectionExpression: projection.map((p) => e.n(p)).join(', ') } : {}),
                ...(e.attributes().ExpressionAttributeNames
                  ? { ExpressionAttributeNames: e.attributes().ExpressionAttributeNames }
                  : {}),
              },
            },
          }),
        );
        out.push(...((Responses?.[this.table] ?? []) as T[]));
        pending = (UnprocessedKeys?.[this.table]?.Keys ?? []) as Key[];
      }
    }
    return out;
  }

  /** A partition, or a slice of one, paged to the end (or to `limit`). */
  async query<T = Item>(pk: string, options: QueryOptions = {}): Promise<T[]> {
    this.guard(pk);
    const [pkName, skName] = options.index ? INDEX_KEYS[options.index] : [PK, SK];
    const e = new Expr();
    const clauses = [`${e.n(pkName)} = ${e.v(pk)}`];
    if (options.sk?.eq !== undefined) clauses.push(`${e.n(skName)} = ${e.v(options.sk.eq)}`);
    if (options.sk?.beginsWith !== undefined)
      clauses.push(`begins_with(${e.n(skName)}, ${e.v(options.sk.beginsWith)})`);
    if (options.sk?.between)
      clauses.push(`${e.n(skName)} BETWEEN ${e.v(options.sk.between[0])} AND ${e.v(options.sk.between[1])}`);
    const filter = options.filter?.(e);
    const projection = options.projection?.map((p) => e.n(p)).join(', ');

    const out: T[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const { Items: page, LastEvaluatedKey } = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          ...(options.index ? { IndexName: options.index } : { ConsistentRead: true }),
          KeyConditionExpression: clauses.join(' AND '),
          ...(filter ? { FilterExpression: filter } : {}),
          ...(projection ? { ProjectionExpression: projection } : {}),
          ...e.attributes(),
          ScanIndexForward: options.forward ?? true,
          ...(options.limit ? { Limit: options.limit - out.length } : {}),
          ...(start ? { ExclusiveStartKey: start } : {}),
        }),
      );
      out.push(...((page ?? []) as T[]));
      start = LastEvaluatedKey;
    } while (start && (!options.limit || out.length < options.limit));
    return out;
  }

  async put(item: Item, options: WriteOptions = {}): Promise<void> {
    this.guardItem(item);
    const e = new Expr();
    const condition = options.condition?.(e);
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: item,
          ...(condition ? { ConditionExpression: condition } : {}),
          ...e.attributes(),
        }),
      );
    } catch (error) {
      throw conflictOr(error, options.onConflict);
    }
  }

  /** Put an item that must not exist yet: the key is the unique value (maestro ADR-0018). */
  async insert(item: Item, onConflict: string): Promise<void> {
    await this.put(item, { condition: (e) => `attribute_not_exists(${e.n(PK)})`, onConflict });
  }

  /** Update in place and return the item as it now is. */
  async update<T = Item>(key: Key, spec: UpdateSpec): Promise<T> {
    this.guard(key.pk);
    const e = updateExpr(spec);
    const condition = spec.condition?.(e);
    try {
      const { Attributes } = await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: key,
          UpdateExpression: e.updateExpression(),
          ...(condition ? { ConditionExpression: condition } : {}),
          ...e.attributes(),
          ReturnValues: 'ALL_NEW',
        }),
      );
      return Attributes as T;
    } catch (error) {
      throw conflictOr(error, spec.onConflict);
    }
  }

  async delete(key: Key, options: WriteOptions = {}): Promise<void> {
    this.guard(key.pk);
    const e = new Expr();
    const condition = options.condition?.(e);
    try {
      await this.doc.send(
        new DeleteCommand({
          TableName: this.table,
          Key: key,
          ...(condition ? { ConditionExpression: condition } : {}),
          ...e.attributes(),
        }),
      );
    } catch (error) {
      throw conflictOr(error, options.onConflict);
    }
  }

  /** Unconditional puts and deletes, twenty-five at a time, unprocessed ones retried. */
  async batchWrite(puts: Item[], deletes: Key[] = []): Promise<void> {
    for (const item of puts) this.guardItem(item);
    for (const key of deletes) this.guard(key.pk);
    const requests = [
      ...puts.map((item) => ({ PutRequest: { Item: item } })),
      ...deletes.map((key) => ({ DeleteRequest: { Key: key } })),
    ];
    for (let i = 0; i < requests.length; i += BATCH_WRITE) {
      let pending = requests.slice(i, i + BATCH_WRITE);
      while (pending.length > 0) {
        const { UnprocessedItems } = await this.doc.send(
          new BatchWriteCommand({ RequestItems: { [this.table]: pending } }),
        );
        pending = (UnprocessedItems?.[this.table] ?? []) as typeof pending;
      }
    }
  }

  transaction(): Transaction {
    return new Transaction(
      this.doc,
      this.table,
      (item) => this.guardItem(item),
      (pk) => this.guard(pk),
    );
  }
}

/** A record as the caller sees it: the item without the table's own attributes. */
export function strip<T>(item: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...item };
  for (const attribute of KEY_ATTRIBUTES) delete out[attribute];
  return out as T;
}

function updateExpr(spec: UpdateSpec): Expr {
  const e = new Expr();
  if (spec.set) e.set(spec.set);
  for (const [field, expression] of spec.setRaw?.(e) ?? []) e.setRaw(field, expression);
  if (spec.remove) e.remove(spec.remove);
  for (const [field, by] of Object.entries(spec.add ?? {})) e.add(field, by);
  return e;
}

function conflictOr(error: unknown, message: string | undefined): unknown {
  if (error instanceof ConditionalCheckFailedException) {
    return new Conflict(message ?? 'The item changed between the read and the write.', false);
  }
  return error;
}

interface Staged {
  item: NonNullable<TransactWriteCommandInput['TransactItems']>[number];
  onConflict: string;
  retry: boolean;
}

/**
 * One `TransactWriteItems`: the act's items, the outbox items and the counters, all or nothing
 * (maestro ADR-0018; ADR-0019 §4). Reads happen before; every write carries the condition that makes the read
 * still true. A failed condition cancels the whole transaction, and the staged item's `retry`
 * says whether the caller re-runs (a counter moved) or is refused (the record moved).
 */
export class Transaction {
  private readonly staged: Staged[] = [];
  private readonly keys = new Set<string>();

  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
    private readonly guardItem: (item: Record<string, unknown>) => void,
    private readonly guardKey: (pk: string) => void,
  ) {}

  get size(): number {
    return this.staged.length;
  }

  /** DynamoDB refuses two operations on one item in a transaction; so does this, earlier. */
  private claim(key: Key): void {
    const id = `${key.pk}\u0000${key.sk}`;
    if (this.keys.has(id)) {
      throw new Error(`A transaction touches \`${key.pk}\` / \`${key.sk}\` twice; merge the writes.`);
    }
    this.keys.add(id);
    if (this.staged.length >= TRANSACTION_LIMIT) {
      throw new Error(`A transaction holds at most ${TRANSACTION_LIMIT} items.`);
    }
  }

  put(item: Item, options: WriteOptions & { retry?: boolean } = {}): this {
    this.guardItem(item);
    this.claim(item);
    const e = new Expr();
    const condition = options.condition?.(e);
    this.staged.push({
      item: {
        Put: {
          TableName: this.table,
          Item: item,
          ...(condition ? { ConditionExpression: condition } : {}),
          ...e.attributes(),
        },
      },
      onConflict: options.onConflict ?? 'The item changed between the read and the write.',
      retry: options.retry ?? false,
    });
    return this;
  }

  /** Put an item that must not exist yet. */
  insert(item: Item, onConflict: string): this {
    return this.put(item, { condition: (e) => `attribute_not_exists(${e.n(PK)})`, onConflict });
  }

  update(key: Key, spec: UpdateSpec & { retry?: boolean }): this {
    this.guardKey(key.pk);
    this.claim(key);
    const e = updateExpr(spec);
    const condition = spec.condition?.(e);
    this.staged.push({
      item: {
        Update: {
          TableName: this.table,
          Key: key,
          UpdateExpression: e.updateExpression(),
          ...(condition ? { ConditionExpression: condition } : {}),
          ...e.attributes(),
        },
      },
      onConflict: spec.onConflict ?? 'The item changed between the read and the write.',
      retry: spec.retry ?? false,
    });
    return this;
  }

  delete(key: Key, options: WriteOptions = {}): this {
    this.guardKey(key.pk);
    this.claim(key);
    const e = new Expr();
    const condition = options.condition?.(e);
    this.staged.push({
      item: {
        Delete: {
          TableName: this.table,
          Key: key,
          ...(condition ? { ConditionExpression: condition } : {}),
          ...e.attributes(),
        },
      },
      onConflict: options.onConflict ?? 'The item changed between the read and the write.',
      retry: false,
    });
    return this;
  }

  /** Assert something about an item this transaction does not write. */
  check(key: Key, condition: (e: Expr) => string, onConflict: string): this {
    this.guardKey(key.pk);
    this.claim(key);
    const e = new Expr();
    this.staged.push({
      item: {
        ConditionCheck: {
          TableName: this.table,
          Key: key,
          ConditionExpression: condition(e),
          ...e.attributes(),
        },
      },
      onConflict,
      retry: false,
    });
    return this;
  }

  async commit(): Promise<void> {
    if (this.staged.length === 0) return;
    try {
      await this.doc.send(new TransactWriteCommand({ TransactItems: this.staged.map((s) => s.item) }));
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        const reasons = error.CancellationReasons ?? [];
        const failed = reasons.findIndex((r: CancellationReason) => r.Code === 'ConditionalCheckFailed');
        if (failed >= 0) {
          const staged = this.staged[failed]!;
          throw new Conflict(staged.onConflict, staged.retry);
        }
        // Another transaction held one of these items: nothing about the record is known to have
        // moved, so the caller re-reads and tries again.
        if (reasons.some((r: CancellationReason) => r.Code === 'TransactionConflict')) {
          throw new Conflict('Another transaction held one of these items; try again.', true);
        }
      }
      throw error;
    }
  }
}
