/**
 * The sweep (maestro ADR-0019 §6): once a minute, every workspace's open items whose `next_at` has
 * come are ticked — a lease expires, a ladder step is delivered and recorded, a breach is recorded,
 * an item past `review_by` closes `expired`. Each item is its own transaction on its revision, so two
 * sweeps that overlap race harmlessly: one wins, the other re-decides and finds nothing due.
 *
 * The sweep acts as this service's workload principal. Every act it records is still answered for
 * by the item's accountable human.
 */

import type { Store } from '../db/client.js';
import type { Notifier } from '../notify/notifier.js';
import type { PayloadStore } from '../record/payload-store.js';
import { WorkItemService } from './work-items.js';
import { WorkspaceRegistry } from './workspaces.js';

export interface SweepDeps {
  store: Store;
  payloads: PayloadStore;
  notifier: Notifier;
  /** The workload principal the sweep acts as (prn-w-…). */
  principal: string;
  now: () => string;
}

export interface SweepReport {
  at: string;
  workspaces: number;
  due: number;
  events: Record<string, number>;
  failed: Array<{ workspace: string; item: string; error: string }>;
}

export class SweepService {
  private readonly items: WorkItemService;

  constructor(private readonly deps: SweepDeps) {
    this.items = new WorkItemService({
      store: deps.store,
      payloads: deps.payloads,
      workspaces: new WorkspaceRegistry(deps.store),
      now: deps.now,
    });
  }

  async once(): Promise<SweepReport> {
    const at = this.deps.now();
    const report: SweepReport = { at, workspaces: 0, due: 0, events: {}, failed: [] };
    await this.deps.store.control.principals.seen(this.deps.principal, 'workload', at);
    const workspaces = (await this.deps.store.control.workspaces.list()).filter(
      (w) => w.definition_version > 0,
    );
    for (const { id: workspace } of workspaces) {
      report.workspaces += 1;
      const handle = await this.deps.store.handle(workspace);
      const scope = {
        workspace,
        handle,
        actor: { principal: this.deps.principal, kind: 'workload' as const, roles: [] },
      };
      for (const item of await handle.items.due(at)) {
        report.due += 1;
        try {
          for (const event of await this.items.tick(scope, item.item_id, this.deps.notifier)) {
            report.events[event.type] = (report.events[event.type] ?? 0) + 1;
          }
        } catch (error) {
          // One item's failure is reported and the sweep goes on; the item stays due for the next.
          report.failed.push({ workspace, item: item.item_id, error: (error as Error).message });
        }
      }
    }
    return report;
  }
}
