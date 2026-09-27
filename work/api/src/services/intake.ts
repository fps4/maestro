/**
 * Signals and facts in (maestro ADR-0019 §5, §7). A signal is routed by policy (`domain/intake.ts`)
 * and becomes one of four things, each in one transaction with the delivery that carried it, so a
 * redelivery is answered with the first result:
 *
 *   raised    — a new item, and its fingerprint's window;
 *   attached  — a repeat inside the window, on the item it raised (the window moves on);
 *   folded    — a medium or low finding, on the week's obligation (raised by the first of them);
 *   a fact    — an all-clear or a deploy, applied to every item waiting on its key;
 *   stale     — an alarm older than the all-clear already taken in for it (ADR-0028 §3): nothing.
 *
 * An alarm in a failure domain (ADR-0028 §2) attaches to the domain's outage — its detector's item
 * while that is open, else the item its first alarm raised inside the correlation window — and owes
 * its own all-clear there; with no outage open it raises its item and opens the domain's outage.
 *
 * A fact touches each waiting item in that item's own transaction; satisfying a satisfied entry
 * decides nothing, so a fact delivered twice is harmless and its delivery is recorded after.
 */

import { uuidv7 } from '@fps4/maestro-spine';
import { Conflict } from '../db/handle.js';
import * as decide from '../domain/decide.js';
import { addDuration } from '../domain/definition.js';
import type { Fact } from '../domain/evidence.js';
import { route, type Signal } from '../domain/intake.js';
import type { Scope, WorkItemService } from './work-items.js';

export interface IntakeResult {
  outcome: 'raised' | 'attached' | 'folded' | 'satisfied' | 'unmatched' | 'stale';
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
      // Its own time, kept whether it closes anything or not: an alarm older than it is stale.
      if (r.fact.kind === 'signal_ok') {
        await handle.allClears.record({ fingerprint: s.fingerprint, last_ok: s.occurred_at }, env.now);
      }
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

        // An alarm older than an all-clear already taken in for it arrived out of order: the OK is
        // the latest word, and the alarm raises nothing (ADR-0028 §3).
        const clear = await handle.allClears.get(r.fingerprint);
        if (clear && Date.parse(clear.last_ok) > Date.parse(s.occurred_at)) {
          handle.deliveries.stageInsert(tx, delivery('stale', []), env.now);
          return { outcome: 'stale', items: [] };
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
        // One outage in a failure domain is one item (ADR-0028 §2): the detector's while its own alarm
        // is open, else the domain's first alarm's inside the correlation window.
        const domain = r.correlate?.domain;
        if (domain) {
          for (const role of ['detector', 'site'] as const) {
            const outage = await handle.outages.get(role, domain);
            if (!outage) continue;
            if (
              role === 'site' &&
              addDuration(outage.opened_at, env.definition.policy.correlation_window) < env.now
            )
              continue;
            const head = await handle.items.get(outage.item_id);
            if (!head || head.state === 'closed') continue;
            const events = decide.attachSignal(env, head, {
              fingerprint: r.fingerprint,
              kind: s.kind,
              fingerprint_until: until,
              outage: true,
            });
            await this.items.stage(tx, scope, correlation, head, events);
            // A repeat of this alarm attaches here too, while its window runs.
            handle.fingerprints.stage(
              tx,
              { fingerprint: r.fingerprint, item_id: head.item_id, window_until: until },
              window,
            );
            handle.deliveries.stageInsert(tx, delivery('attached', [head.item_id]), env.now);
            return { outcome: 'attached', items: [head.item_id] };
          }
        }

        const detects = r.correlate?.detects ?? [];
        const origin = {
          ...r.origin,
          ...(domain ? { failure_domain: domain } : {}),
          ...(detects.length ? { detects } : {}),
        };
        const item = await this.items.raiseIn(tx, scope, env, correlation, r.input, origin);
        handle.fingerprints.stage(
          tx,
          { fingerprint: r.fingerprint, item_id: item.item_id, window_until: until },
          window,
        );
        for (const [role, d] of [
          ...(domain ? [['site', domain] as const] : []),
          ...detects.map((d) => ['detector', d] as const),
        ]) {
          handle.outages.stage(
            tx,
            { role, domain: d, item_id: item.item_id, opened_at: item.opened_at },
            await handle.outages.get(role, d),
          );
        }
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
