/**
 * The work item service: every command is read → decide → evolve → one conditional transaction
 * (maestro ADR-0019 §4).
 *
 * The head is read strongly; `decide` is pure; the events are folded onto the head by the same
 * `evolve` a rebuild uses; and the write is one `TransactWriteItems` holding the head on the
 * condition that its revision is the one read, the tallies the events move, the edges a raise
 * creates, and one outbox item per event. A condition that fails re-runs the whole thing — a claim
 * that lost the race is decided again against the winner's head and refused with a sentence.
 *
 * Words — a title, a reason — are written to the payload store before the transaction and named on
 * the event by reference and digest.
 */

import { uuidv7 } from '@fps4/maestro-spine';
import type { RequestContext } from '../auth/context.js';
import type { Store } from '../db/client.js';
import { Conflict, type Transaction } from '../db/handle.js';
import type { Edge } from '../db/work-items.js';
import * as decide from '../domain/decide.js';
import type { Actor, ClaimResult, Env, RaiseInput, ResolveOutcome } from '../domain/decide.js';
import type { WorkspaceHandle } from '../db/handle.js';
import type { Notifier } from '../notify/notifier.js';
import { evolve, talliesOf, type ItemEvent } from '../domain/events.js';
import { itemId, type PrincipalKind } from '../domain/ids.js';
import { isClosed, isHeld, nextAt, type State, type WorkItem } from '../domain/item.js';
import { armed } from '../domain/evidence.js';
import { NotFound } from '../http/errors.js';
import { itemPayloadKey, writePayload, type PayloadStore } from '../record/payload-store.js';
import { emit, type Recordable } from './recorder.js';
import type { WorkspaceRegistry } from './workspaces.js';

export interface WorkItemDeps {
  store: Store;
  payloads: PayloadStore;
  workspaces: WorkspaceRegistry;
  now: () => string;
}

export interface Raised {
  item: WorkItem;
  /** The caller's key had raised this item already; nothing new was recorded. */
  replayed: boolean;
}

export interface FrontierQuery {
  for?: string;
  application?: string;
  milestone?: string;
  limit?: number;
}

export interface FrontierRow {
  item_id: string;
  class: WorkItem['class'];
  title: string;
  about: WorkItem['about'];
  accountable: string;
  acting?: string;
  state: State;
  severity: WorkItem['severity'];
  due: string;
  next_human_touchpoint: string;
}

/** An item another one waits on, or one waiting on it: enough to say who moves it and by when. */
export interface EdgeRow {
  item_id: string;
  class: WorkItem['class'];
  title: string;
  state: State;
  accountable: string;
  due: string;
}

export interface Blocking {
  item_id: string;
  /** The open items it waits on. A blocker that closed no longer blocks, whatever its outcome. */
  blocked_by: EdgeRow[];
  /** The open items waiting on it. */
  blocks: EdgeRow[];
}

/** The board's columns: the state machine, left to right, and what closed today. */
export const BOARD_COLUMNS = ['open', 'assigned', 'in_progress', 'blocked', 'resolved', 'escalated'] as const;

export interface Board {
  columns: Record<(typeof BOARD_COLUMNS)[number], FrontierRow[]>;
  /** Closed since midnight UTC, newest first, with the outcome each closed with. */
  closed_today: Array<FrontierRow & { outcome: string; closed_at: string }>;
}

/** A person's slice of the frontier. specs-service's half — decisions and questions — is its own read. */
export interface Today {
  principal: string;
  /** Items the person holds, or answers for with no one holding them: theirs to move. */
  owes: FrontierRow[];
  /** Items the person answers for while an agent acts on them: the runs they are accountable for. */
  oversees: FrontierRow[];
}

export interface Rates {
  application: string;
  closed: Record<string, number>;
  refusals: Record<string, number>;
  escalated_out_rate: number | null;
  months: Array<{ month: string; metric: string; count: number }>;
}

/** Who acts, where: a request's caller, or the sweep acting as this service's workload. */
export interface Scope {
  workspace: string;
  handle: WorkspaceHandle;
  actor: Actor;
}

export const scopeOf = (ctx: RequestContext): Scope => ({
  workspace: ctx.workspace,
  handle: ctx.handle,
  actor: {
    principal: ctx.caller.principal,
    kind: ctx.caller.kind,
    roles: ctx.caller.roles,
    ...(ctx.caller.accountable ? { accountable: ctx.caller.accountable } : {}),
  },
});

/** Who a person reaches next about an item: its human holder, else its accountable human. */
export function nextHumanTouchpoint(item: WorkItem): string {
  return item.assigned_to?.startsWith('prn-h-') && isHeld(item) ? item.assigned_to : item.accountable;
}

export function frontierRow(i: WorkItem): FrontierRow {
  return {
    item_id: i.item_id,
    class: i.class,
    title: i.title,
    about: i.about,
    accountable: i.accountable,
    ...(isHeld(i) && i.assigned_to ? { acting: i.assigned_to } : {}),
    state: i.state,
    severity: i.severity,
    due: isClosed(i) ? i.closed_at! : nextAt(i),
    next_human_touchpoint: nextHumanTouchpoint(i),
  };
}

const edgeRow = (i: WorkItem): EdgeRow => ({
  item_id: i.item_id,
  class: i.class,
  title: i.title,
  state: i.state,
  accountable: i.accountable,
  due: nextAt(i),
});

export class WorkItemService {
  constructor(private readonly deps: WorkItemDeps) {}

  async env(scope: Scope): Promise<Env> {
    return {
      definition: await this.deps.workspaces.current(scope.workspace),
      actor: scope.actor,
      now: this.deps.now(),
    };
  }

  private principals = async (ids: string[]): Promise<Map<string, PrincipalKind>> => {
    const found = await this.deps.store.control.principals.getMany(ids);
    return new Map(found.map((p) => [p.id, p.kind]));
  };

  /**
   * Fold the events onto the head and stage everything they imply on `tx`. Returns the new head.
   */
  async stage(
    tx: Transaction,
    ctx: Scope,
    correlation: string,
    before: WorkItem | null,
    events: ItemEvent[],
    edges: Edge[] = [],
  ): Promise<WorkItem | null> {
    if (events.length === 0) return before;
    let head = before;
    const tallies = new Map<string, number>();
    const recordables: Recordable[] = [];
    for (const event of events) {
      head = evolve(head, event);
      for (const t of talliesOf(head, event)) tallies.set(t, (tallies.get(t) ?? 0) + 1);
      const payload = event.payload
        ? await writePayload(
            this.deps.payloads,
            itemPayloadKey(ctx.workspace, event.item, `${head.revision}-${event.type}`),
            event.payload,
          )
        : undefined;
      recordables.push({
        event,
        subject_seq: head.revision,
        consequence_class: head.consequence_class,
        ...(payload ? { payload } : {}),
      });
    }
    ctx.handle.items.stage(tx, before, head!);
    // The expectations follow the head: what it waits on now is written, what it no longer waits on
    // is removed, in the same transaction (ADR-0019 §5).
    const was = new Map((before ? armed(before) : []).map((a) => [`${a.key}\u0000${a.index}`, a]));
    const is = new Map(armed(head!).map((a) => [`${a.key}\u0000${a.index}`, a]));
    for (const [k, a] of was) {
      if (!is.has(k))
        ctx.handle.expectations.stageDelete(tx, { key: a.key, item_id: head!.item_id, index: a.index });
    }
    for (const [k, a] of is) {
      if (!was.has(k))
        ctx.handle.expectations.stagePut(tx, { key: a.key, item_id: head!.item_id, index: a.index });
    }
    for (const [name, by] of tallies) ctx.handle.tallies.stageAdd(tx, name, by);
    for (const edge of edges) ctx.handle.items.stageEdge(tx, edge);
    await emit(
      tx,
      {
        handle: ctx.handle,
        workspace: ctx.workspace,
        correlation_id: correlation,
        principals: this.principals,
      },
      recordables,
    );
    return head;
  }

  async raise(request: RequestContext, input: RaiseInput, key?: string): Promise<Raised> {
    const ctx = scopeOf(request);
    const { handle } = ctx;
    if (key) {
      const seen = await handle.requests.get(ctx.actor.principal, key);
      if (seen) return { item: (await handle.items.get(seen.item_id))!, replayed: true };
    }
    const env = await this.env(ctx);
    const correlation = uuidv7();
    try {
      return await handle.transaction(async (tx) => {
        const edges: Edge[] = [];
        for (const [rel, id] of [
          ['child', input.parent],
          ['member', input.milestone],
        ] as const) {
          if (!id) continue;
          if (!(await handle.items.get(id))) throw new NotFound(`No item \`${id}\` in this workspace.`);
          edges.push({ from: id, rel, to: '' });
        }
        for (const blocker of new Set(input.blocked_by ?? [])) {
          const head = await handle.items.get(blocker);
          if (!head) throw new NotFound(`No item \`${blocker}\` in this workspace.`);
          if (isClosed(head)) {
            throw new decide.Refusal(`\`${blocker}\` is closed (\`${head.outcome}\`): it blocks nothing.`);
          }
          edges.push({ from: blocker, rel: 'blocks', to: '' });
        }
        const item = await this.raiseIn(tx, ctx, env, correlation, input, {}, edges);
        if (key) {
          handle.requests.stage(tx, { principal: ctx.actor.principal, key, item_id: item.item_id }, env.now);
        }
        return { item, replayed: false };
      });
    } catch (error) {
      // Two publishes with one key raced, and the other won: answer with what it raised.
      if (key && error instanceof Conflict && !error.retry) {
        const seen = await handle.requests.get(ctx.actor.principal, key);
        if (seen) return { item: (await handle.items.get(seen.item_id))!, replayed: true };
      }
      throw error;
    }
  }

  /**
   * Raise an item on `tx`: the next id from the workspace's counter, decided and recorded. The caller
   * stages whatever else the raise implies (a request key, a fingerprint, a fold, a delivery).
   */
  async raiseIn(
    tx: Transaction,
    scope: Scope,
    env: Env,
    correlation: string,
    input: RaiseInput,
    origin: decide.Origin = {},
    edges: Edge[] = [],
  ): Promise<WorkItem> {
    const n = await scope.handle.counters.get('item');
    const id = itemId(n + 1);
    const events = decide.raise(env, id, input, origin);
    scope.handle.counters.bump('item', n, 1, tx);
    const item = await this.stage(
      tx,
      scope,
      correlation,
      null,
      events,
      edges.map((e) => ({ ...e, to: id })),
    );
    return item!;
  }

  async act<R>(
    ctx: Scope,
    id: string,
    command: (
      env: Env,
      head: WorkItem,
    ) => { events: ItemEvent[]; result: R } | Promise<{ events: ItemEvent[]; result: R }>,
  ): Promise<{ item: WorkItem; result: R }> {
    const env = await this.env(ctx);
    const correlation = uuidv7();
    return ctx.handle.transaction(async (tx) => {
      const head = await ctx.handle.items.get(id);
      if (!head) throw new NotFound(`No item \`${id}\` in this workspace.`);
      const { events, result } = await command({ ...env, now: this.deps.now() }, head);
      const item = await this.stage(tx, ctx, correlation, head, events);
      return { item: item!, result };
    });
  }

  claim(ctx: RequestContext, id: string): Promise<{ item: WorkItem; result: ClaimResult }> {
    return this.act(scopeOf(ctx), id, (env, head) => decide.claim(env, head));
  }

  async release(ctx: RequestContext, id: string): Promise<WorkItem> {
    return (
      await this.act(scopeOf(ctx), id, (env, head) => ({ events: decide.release(env, head), result: null }))
    ).item;
  }

  async transition(ctx: RequestContext, id: string, to: State): Promise<WorkItem> {
    return (
      await this.act(scopeOf(ctx), id, (env, head) => ({
        events: decide.transition(env, head, to),
        result: null,
      }))
    ).item;
  }

  async resolve(
    ctx: RequestContext,
    id: string,
    outcome: ResolveOutcome,
    reason?: string,
  ): Promise<WorkItem> {
    return (
      await this.act(scopeOf(ctx), id, (env, head) => ({
        events: decide.resolve(env, head, outcome, reason),
        result: null,
      }))
    ).item;
  }

  /** Link the pull request or the artifact the evidence waits on; arms the entry that needs it. */
  async link(
    ctx: RequestContext,
    id: string,
    kind: 'pull_request' | 'artifact',
    ref: string,
  ): Promise<WorkItem> {
    return (
      await this.act(scopeOf(ctx), id, (env, head) => ({
        events: decide.link(env, head, kind, ref),
        result: null,
      }))
    ).item;
  }

  async heartbeat(ctx: RequestContext, id: string): Promise<WorkItem> {
    return (
      await this.act(scopeOf(ctx), id, (env, head) => ({ events: decide.heartbeat(env, head), result: null }))
    ).item;
  }

  /**
   * The passing of time, for one item (ADR-0019 §6): decided by `tick`, each ladder step delivered
   * through the notifier before the transaction, and what the delivery did recorded on its event.
   * Returns the events recorded — none when another sweep got there first.
   */
  async tick(scope: Scope, id: string, notifier: Notifier): Promise<ItemEvent[]> {
    const { result } = await this.act(scope, id, async (env, head) => {
      const events = decide.tick(env, head);
      for (const event of events) {
        if (event.type !== 'WorkItemChased' || !event.body.to) continue;
        event.body.delivery = await notifier.deliver({
          workspace: scope.workspace,
          item_id: head.item_id,
          title: head.title,
          step: event.body.step,
          to: event.body.to,
          accountable: head.accountable,
          ...(head.resolve_by ? { due: head.resolve_by } : {}),
        });
      }
      return { events, result: events };
    });
    return result;
  }

  /** fetch: the item with its evidence and clocks, its edges, and who a person reaches next about it. */
  async get(
    ctx: RequestContext,
    id: string,
  ): Promise<{ item: WorkItem; edges: Edge[]; next_human_touchpoint: string }> {
    const item = await this.head(ctx, id);
    return {
      item,
      edges: await ctx.handle.items.edges(id),
      next_human_touchpoint: nextHumanTouchpoint(item),
    };
  }

  /** blocking: what the item waits on, and what waits on it — open items only, both ways. */
  async blocking(ctx: RequestContext, id: string): Promise<Blocking> {
    const item = await this.head(ctx, id);
    const waiting = (await ctx.handle.items.edges(id)).filter((e) => e.rel === 'blocks').map((e) => e.to);
    const heads = await ctx.handle.items.getMany([...(item.blocked_by ?? []), ...waiting]);
    const byId = new Map(heads.map((h) => [h.item_id, h]));
    const rows = (ids: string[]) =>
      ids
        .map((i) => byId.get(i))
        .filter((h): h is WorkItem => !!h && !isClosed(h))
        .map(edgeRow);
    return { item_id: id, blocked_by: rows(item.blocked_by ?? []), blocks: rows(waiting) };
  }

  /** The frontier: the open set, soonest first, filtered in memory (ADR-0019 §3). */
  async frontier(ctx: RequestContext, q: FrontierQuery): Promise<FrontierRow[]> {
    const me = q.for === 'me' ? ctx.caller.principal : q.for;
    const rows = (await ctx.handle.items.open())
      .filter((i) => !q.application || i.about.application === q.application)
      .filter((i) => !q.milestone || i.milestone === q.milestone)
      .filter(
        (i) =>
          !me ||
          (isHeld(i) && i.assigned_to === me) ||
          (i.accountable === me && (!isHeld(i) || !i.assigned_to?.startsWith('prn-h-'))),
      )
      .map(frontierRow);
    return q.limit ? rows.slice(0, q.limit) : rows;
  }

  /**
   * The board: the frontier's set by state, and what closed today (ADR-0019 §3, #4). Filters by
   * milestone and application apply to both.
   */
  async board(ctx: RequestContext, q: Omit<FrontierQuery, 'for' | 'limit'>): Promise<Board> {
    const columns = Object.fromEntries(
      BOARD_COLUMNS.map((c) => [c, [] as FrontierRow[]]),
    ) as Board['columns'];
    for (const row of await this.frontier(ctx, q)) {
      if (row.state !== 'closed') columns[row.state].push(row);
    }
    const today = this.deps.now().slice(0, 10);
    const closed_today = (await ctx.handle.items.closedSince(today))
      .filter((i) => !q.application || i.about.application === q.application)
      .filter((i) => !q.milestone || i.milestone === q.milestone)
      .sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? ''))
      .map((i) => ({ ...frontierRow(i), outcome: i.outcome!, closed_at: i.closed_at! }));
    return { columns, closed_today };
  }

  /** Today for the caller: what they owe, and the agents' work they answer for. */
  async today(ctx: RequestContext): Promise<Today> {
    const principal = ctx.caller.principal;
    const rows = await this.frontier(ctx, { for: principal });
    const byAgent = (r: FrontierRow) => !!r.acting && !r.acting.startsWith('prn-h-');
    return {
      principal,
      owes: rows.filter((r) => !byAgent(r)),
      oversees: rows.filter(byAgent),
    };
  }

  private async head(ctx: RequestContext, id: string): Promise<WorkItem> {
    const item = await ctx.handle.items.get(id);
    if (!item) throw new NotFound(`No item \`${id}\` in this workspace.`);
    return item;
  }

  /** Closures by outcome and refusals by check and class for one application: one query. */
  async rates(ctx: RequestContext, application: string): Promise<Rates> {
    const tallies = await ctx.handle.tallies.ofApplication(application);
    const closed: Record<string, number> = {};
    const refusals: Record<string, number> = {};
    for (const t of tallies) {
      if (t.metric.startsWith('closed_')) {
        const outcome = t.metric.slice('closed_'.length);
        closed[outcome] = (closed[outcome] ?? 0) + t.count;
      } else if (t.metric.startsWith('refused_')) {
        const what = t.metric.slice('refused_'.length);
        refusals[what] = (refusals[what] ?? 0) + t.count;
      }
    }
    const total = Object.values(closed).reduce((a, b) => a + b, 0);
    return {
      application,
      closed,
      refusals,
      escalated_out_rate: total === 0 ? null : (closed.escalated_out ?? 0) / total,
      months: tallies.map((t) => ({ month: t.month, metric: t.metric, count: t.count })),
    };
  }
}
