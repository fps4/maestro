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
import { evolve, talliesOf, type ItemEvent } from '../domain/events.js';
import { itemId, type PrincipalKind } from '../domain/ids.js';
import { isHeld, nextAt, type State, type WorkItem } from '../domain/item.js';
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

export interface Rates {
  application: string;
  closed: Record<string, number>;
  refusals: Record<string, number>;
  escalated_out_rate: number | null;
  months: Array<{ month: string; metric: string; count: number }>;
}

const actorOf = (ctx: RequestContext): Actor => ({
  principal: ctx.caller.principal,
  kind: ctx.caller.kind,
  roles: ctx.caller.roles,
  ...(ctx.caller.accountable ? { accountable: ctx.caller.accountable } : {}),
});

/** Who a person reaches next about an item: its human holder, else its accountable human. */
export function nextHumanTouchpoint(item: WorkItem): string {
  return item.assigned_to?.startsWith('prn-h-') && isHeld(item) ? item.assigned_to : item.accountable;
}

export class WorkItemService {
  constructor(private readonly deps: WorkItemDeps) {}

  private async env(ctx: RequestContext): Promise<Env> {
    return {
      definition: await this.deps.workspaces.current(ctx.workspace),
      actor: actorOf(ctx),
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
  private async stage(
    tx: Transaction,
    ctx: RequestContext,
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

  async raise(ctx: RequestContext, input: RaiseInput, key?: string): Promise<Raised> {
    const { handle } = ctx;
    if (key) {
      const seen = await handle.requests.get(ctx.caller.principal, key);
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
        const n = await handle.counters.get('item');
        const id = itemId(n + 1);
        const events = decide.raise(env, id, input);
        handle.counters.bump('item', n, 1, tx);
        if (key) handle.requests.stage(tx, { principal: ctx.caller.principal, key, item_id: id }, env.now);
        const item = await this.stage(
          tx,
          ctx,
          correlation,
          null,
          events,
          edges.map((e) => ({ ...e, to: id })),
        );
        return { item: item!, replayed: false };
      });
    } catch (error) {
      // Two publishes with one key raced, and the other won: answer with what it raised.
      if (key && error instanceof Conflict && !error.retry) {
        const seen = await handle.requests.get(ctx.caller.principal, key);
        if (seen) return { item: (await handle.items.get(seen.item_id))!, replayed: true };
      }
      throw error;
    }
  }

  private async act<R>(
    ctx: RequestContext,
    id: string,
    command: (env: Env, head: WorkItem) => { events: ItemEvent[]; result: R },
  ): Promise<{ item: WorkItem; result: R }> {
    const env = await this.env(ctx);
    const correlation = uuidv7();
    return ctx.handle.transaction(async (tx) => {
      const head = await ctx.handle.items.get(id);
      if (!head) throw new NotFound(`No item \`${id}\` in this workspace.`);
      const { events, result } = command({ ...env, now: this.deps.now() }, head);
      const item = await this.stage(tx, ctx, correlation, head, events);
      return { item: item!, result };
    });
  }

  claim(ctx: RequestContext, id: string): Promise<{ item: WorkItem; result: ClaimResult }> {
    return this.act(ctx, id, (env, head) => decide.claim(env, head));
  }

  async release(ctx: RequestContext, id: string): Promise<WorkItem> {
    return (await this.act(ctx, id, (env, head) => ({ events: decide.release(env, head), result: null })))
      .item;
  }

  async transition(ctx: RequestContext, id: string, to: State): Promise<WorkItem> {
    return (
      await this.act(ctx, id, (env, head) => ({ events: decide.transition(env, head, to), result: null }))
    ).item;
  }

  async resolve(
    ctx: RequestContext,
    id: string,
    outcome: ResolveOutcome,
    reason?: string,
  ): Promise<WorkItem> {
    return (
      await this.act(ctx, id, (env, head) => ({
        events: decide.resolve(env, head, outcome, reason),
        result: null,
      }))
    ).item;
  }

  async get(ctx: RequestContext, id: string): Promise<{ item: WorkItem; edges: Edge[] }> {
    const item = await ctx.handle.items.get(id);
    if (!item) throw new NotFound(`No item \`${id}\` in this workspace.`);
    return { item, edges: await ctx.handle.items.edges(id) };
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
      .map((i): FrontierRow => ({
        item_id: i.item_id,
        class: i.class,
        title: i.title,
        about: i.about,
        accountable: i.accountable,
        ...(isHeld(i) && i.assigned_to ? { acting: i.assigned_to } : {}),
        state: i.state,
        severity: i.severity,
        due: nextAt(i),
        next_human_touchpoint: nextHumanTouchpoint(i),
      }));
    return q.limit ? rows.slice(0, q.limit) : rows;
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
