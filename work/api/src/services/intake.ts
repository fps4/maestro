/**
 * Signals and facts in (maestro ADR-0019 §5, §7). A signal is routed by policy (`domain/intake.ts`)
 * and becomes one of four things, each in one transaction with the delivery that carried it, so a
 * redelivery is answered with the first result:
 *
 *   raised    — a new item, and its fingerprint's window;
 *   attached  — a repeat inside the window, on the item it raised (the window moves on);
 *   folded    — a medium or low finding, on the week's obligation (raised by the first of them);
 *   a fact    — an all-clear or a deploy, applied to every item waiting on its key.
 *
 * A fact touches each waiting item in that item's own transaction; satisfying a satisfied entry
 * decides nothing, so a fact delivered twice is harmless and its delivery is recorded after.
 */

import { uuidv7 } from '@fps4/maestro-spine';
import { Conflict } from '../db/handle.js';
import * as decide from '../domain/decide.js';
import type { Fact } from '../domain/evidence.js';
import { route, type Signal } from '../domain/intake.js';
import type { Scope, WorkItemService } from './work-items.js';

export interface IntakeResult {
  outcome: 'raised' | 'attached' | 'folded' | 'satisfied' | 'unmatched';
  items: string[];
  /** The delivery had been taken in already; this is what it became then. */
  replayed?: boolean;
}

export class IntakeService {
  constructor(private readonly items: WorkItemService) {}

  async signal(scope: Scope, s: Signal): Promise<IntakeResult> {
    const { handle } = scope;
    const seen = await handle.deliveries.get(s.source, s.delivery_id);
    if (seen)
      return { outcome: seen.outcome as IntakeResult['outcome'], items: seen.item_ids, replayed: true };

    const env = await this.items.env(scope);
    const r = route(env.definition, s, env.now);
    const delivery = (outcome: IntakeResult['outcome'], items: string[]) => ({
      source: s.source,
      delivery_id: s.delivery_id,
      outcome,
      item_ids: items,
    });

    if (r.action === 'fact') {
      const result = await this.fact(scope, r.fact);
      await handle.deliveries.put(delivery(result.outcome, result.items), env.now);
      return result;
    }

    const correlation = uuidv7();
    try {
      return await handle.transaction(async (tx): Promise<IntakeResult> => {
        if (r.action === 'fold') {
          const fold = await handle.folds.get(r.fold);
          const head = fold ? await handle.items.get(fold.item_id) : null;
          if (head && head.state !== 'closed') {
            const events = decide.attachSignal(env, head, {
              fingerprint: r.fingerprint,
              kind: s.kind,
              fold: true,
            });
            await this.items.stage(tx, scope, correlation, head, events);
            handle.deliveries.stageInsert(tx, delivery('folded', [head.item_id]), env.now);
            return { outcome: 'folded', items: [head.item_id] };
          }
          const item = await this.items.raiseIn(tx, scope, env, correlation, r.input, r.origin);
          handle.folds.stage(tx, { fold: r.fold, item_id: item.item_id }, fold);
          handle.deliveries.stageInsert(tx, delivery('raised', [item.item_id]), env.now);
          return { outcome: 'raised', items: [item.item_id] };
        }

        const until = r.origin.fingerprint_until!;
        const window = await handle.fingerprints.get(r.fingerprint);
        if (window && window.window_until >= env.now) {
          const head = await handle.items.get(window.item_id);
          if (head && head.state !== 'closed') {
            const events = decide.attachSignal(env, head, {
              fingerprint: r.fingerprint,
              kind: s.kind,
              fingerprint_until: until,
            });
            await this.items.stage(tx, scope, correlation, head, events);
            handle.fingerprints.stage(tx, { ...window, window_until: until }, window);
            handle.deliveries.stageInsert(tx, delivery('attached', [head.item_id]), env.now);
            return { outcome: 'attached', items: [head.item_id] };
          }
        }
        const item = await this.items.raiseIn(tx, scope, env, correlation, r.input, r.origin);
        handle.fingerprints.stage(
          tx,
          { fingerprint: r.fingerprint, item_id: item.item_id, window_until: until },
          window,
        );
        handle.deliveries.stageInsert(tx, delivery('raised', [item.item_id]), env.now);
        return { outcome: 'raised', items: [item.item_id] };
      });
    } catch (error) {
      // The same delivery, twice at once: the other one took it in. Answer with what it became.
      if (error instanceof Conflict && !error.retry) {
        const first = await handle.deliveries.get(s.source, s.delivery_id);
        if (first)
          return { outcome: first.outcome as IntakeResult['outcome'], items: first.item_ids, replayed: true };
      }
      throw error;
    }
  }

  /** A fact from the world, applied to every open item waiting on its key. */
  async fact(scope: Scope, fact: Fact): Promise<IntakeResult> {
    const waiting = await scope.handle.expectations.waitingOn(fact.key);
    const met: string[] = [];
    for (const id of [...new Set(waiting.map((w) => w.item_id))]) {
      const { result } = await this.items.act(scope, id, (env, head) => {
        const events = decide.satisfy(env, head, fact);
        return { events, result: events.length > 0 };
      });
      if (result) met.push(id);
    }
    return { outcome: met.length > 0 ? 'satisfied' : 'unmatched', items: met };
  }
}
