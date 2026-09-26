/**
 * The key layout (maestro ADR-0019 §2): where every kind of item lives in the table.
 *
 * A workspace's items share the prefix `ws#<workspace>#`, and the handle that serves a workspace
 * refuses any other prefix — isolation by key (maestro ADR-0018). Control items — workspaces,
 * definitions, principals — live under `ctl#`. Every item carries `kind`.
 *
 * A work item is a partition: its head at `sk = head`, and its edges beside it. The head's `gsi1`
 * keys put it in the workspace's open set, sorted by when it next needs attention, or in the month
 * it closed; its `gsi2` keys put it under its application.
 *
 * Numbers in keys are zero-padded so a string sort is a numeric sort; timestamps are ISO 8601 UTC,
 * which sorts as time. The widths are generous because a key is forever.
 */

/** A workspace's outbox sequence. */
export const SEQ_WIDTH = 12;
/** A definition version. */
export const ORDINAL_WIDTH = 10;

export const padSeq = (n: number): string => String(n).padStart(SEQ_WIDTH, '0');
export const padOrdinal = (n: number): string => String(n).padStart(ORDINAL_WIDTH, '0');

/** An open item with no clock sorts last in the open set. */
export const NEVER = '9999-12-31T23:59:59Z';

export const CONTROL_PREFIX = 'ctl#';
export const workspacePrefix = (workspace: string): string => `ws#${workspace}#`;

/** The item kinds — the `kind` attribute. */
export const KINDS = {
  item: 'item',
  edge: 'edge',
  expectation: 'expectation',
  fingerprint: 'fingerprint',
  fold: 'fold',
  tally: 'tally',
  delivery: 'delivery',
  request: 'request',
  membership: 'membership',
  outbox: 'outbox',
  counter: 'counter',
  meta: 'meta',
  workspace: 'workspace',
  workspace_definition: 'workspace_definition',
  principal: 'principal',
} as const;
export type Kind = (typeof KINDS)[keyof typeof KINDS];

/**
 * The kinds that are a projection of the record — what a rebuild from the archive writes back.
 * Deliveries and requests are idempotency caches with a TTL; memberships are grants.
 */
export const RECORD_KINDS: readonly Kind[] = [
  KINDS.item,
  KINDS.edge,
  KINDS.expectation,
  KINDS.fingerprint,
  KINDS.fold,
  KINDS.tally,
  KINDS.outbox,
  KINDS.counter,
];

export interface Key {
  pk: string;
  sk: string;
}

export const HEAD = 'head';

/** Relationships stored as edges in the `from` item's partition. */
export type EdgeRel = 'blocks' | 'child' | 'member';

/** The workspace half of the layout. Every function here returns a key under the workspace's prefix. */
export function workspaceKeys(workspace: string) {
  const p = workspacePrefix(workspace);
  return {
    prefix: p,

    itemPartition: (id: string): string => `${p}item#${id}`,
    item: (id: string): Key => ({ pk: `${p}item#${id}`, sk: HEAD }),
    edge: (from: string, rel: EdgeRel, to: string): Key => ({
      pk: `${p}item#${from}`,
      sk: `edge#${rel}#${to}`,
    }),

    /** gsi1: the open set, soonest first — the frontier, the board, Today and the sweep. */
    open: `${p}open`,
    openKey: (nextAt: string, id: string) => ({ gsi1pk: `${p}open`, gsi1sk: `${nextAt}#${id}` }),
    /** gsi1: what closed in a month, by when. */
    closed: (month: string): string => `${p}closed#${month}`,
    closedKey: (closedAt: string, id: string) => ({
      gsi1pk: `${p}closed#${closedAt.slice(0, 7)}`,
      gsi1sk: `${closedAt}#${id}`,
    }),
    /** gsi2: an application's items, open and closed. */
    application: (app: string): string => `${p}app#${app}`,
    applicationKey: (app: string, openedAt: string, id: string) => ({
      gsi2pk: `${p}app#${app}`,
      gsi2sk: `${openedAt}#${id}`,
    }),

    /** An armed evidence entry, under the key the fact that satisfies it will compute. */
    expectations: (match: string): string => `${p}expect#${match}`,
    expectation: (match: string, id: string, entry: number): Key => ({
      pk: `${p}expect#${match}`,
      sk: `${id}#${entry}`,
    }),

    fingerprint: (fp: string): Key => ({ pk: `${p}fingerprint`, sk: fp }),
    fold: (name: string, period: string): Key => ({ pk: `${p}fold`, sk: `${name}#${period}` }),

    tallies: `${p}tally`,
    tally: (name: string): Key => ({ pk: `${p}tally`, sk: name }),

    delivery: (source: string, id: string): Key => ({ pk: `${p}delivery`, sk: `${source}#${id}` }),
    request: (principal: string, key: string): Key => ({ pk: `${p}request`, sk: `${principal}#${key}` }),

    memberships: `${p}membership`,
    membership: (principal: string): Key => ({ pk: `${p}membership`, sk: principal }),

    outbox: `${p}outbox`,
    outboxItem: (seq: number): Key => ({ pk: `${p}outbox`, sk: padSeq(seq) }),
    /** The sparse index: set while undelivered, removed by the ack. */
    pending: (seq: number) => ({ pending_pk: `${p}outbox`, pending_sk: padSeq(seq) }),

    counters: `${p}counter`,
    counter: (name: string): Key => ({ pk: `${p}counter`, sk: name }),

    meta: (): Key => ({ pk: `${p}meta`, sk: 'projection' }),
  };
}

export type WorkspaceKeys = ReturnType<typeof workspaceKeys>;

/** The control half: never per workspace. */
export const controlKeys = {
  prefix: CONTROL_PREFIX,

  workspaces: `${CONTROL_PREFIX}workspaces`,
  workspace: (id: string): Key => ({ pk: `${CONTROL_PREFIX}workspaces`, sk: id }),

  definitions: `${CONTROL_PREFIX}workspace_definitions`,
  definition: (workspace: string, version: number): Key => ({
    pk: `${CONTROL_PREFIX}workspace_definitions`,
    sk: `${workspace}#${padOrdinal(version)}`,
  }),

  principals: `${CONTROL_PREFIX}principals`,
  principal: (id: string): Key => ({ pk: `${CONTROL_PREFIX}principals`, sk: id }),
};
