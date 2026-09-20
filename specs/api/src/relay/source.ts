/**
 * The outbox as the spine sees it: one `OutboxSource` over every workspace database, oldest
 * first within a workspace. The relay never sees a database; it sees pending envelopes and acks
 * them (ADR-0019 §6).
 *
 * Principals are resolved for the relay's own check from the control database, per batch — the
 * envelope was validated at emit, and the relay checks again because that is what the relay does.
 */

import type { OutboxSource, PrincipalResolver, SpineEvent } from '@fps4/maestro-spine';
import { OUTBOX, WORKSPACES } from '../db/collections.js';
import type { Store } from '../db/client.js';
import { type OutboxRow, toSpineKind } from '../db/outbox.js';
import type { PrincipalDirectory } from '../services/principals.js';

export class MongoOutboxSource implements OutboxSource {
  private readonly kinds = new Map<string, { kind: 'human' | 'agent' | 'workload' }>();
  /** event_id → this service's workspace id, for the ack; the envelope carries the spine's form. */
  private readonly homes = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly directory: PrincipalDirectory,
  ) {}

  /** The relay's resolver: whatever `pending` last loaded. */
  readonly resolve: PrincipalResolver = (id) => this.kinds.get(id);

  async pending(limit: number): Promise<SpineEvent[]> {
    const out: SpineEvent[] = [];
    const workspaces = await this.store
      .control()
      .collection<{ id: string }>(WORKSPACES)
      .find({}, { projection: { _id: 0, id: 1 } })
      .sort({ id: 1 })
      .toArray();
    for (const { id } of workspaces) {
      if (out.length >= limit) break;
      const handle = await this.store.handle(id);
      const rows = await handle
        .collection<OutboxRow>(OUTBOX)
        .find({ delivered: false }, { projection: { _id: 0, delivered: 0, delivered_at: 0, attempts: 0 } })
        .sort({ seq: 1 })
        .limit(limit - out.length)
        .toArray();
      for (const { workspace, ...event } of rows) {
        this.homes.set(event.event_id, workspace);
        out.push(event as SpineEvent);
      }
    }
    const principals = await this.directory.getMany(out.flatMap((e) => [e.accountable, e.acting]));
    for (const [id, record] of principals) this.kinds.set(id, { kind: toSpineKind(record.kind) });
    return out;
  }

  async ack(events: readonly SpineEvent[]): Promise<void> {
    const byWorkspace = new Map<string, string[]>();
    for (const e of events) {
      const home = this.homes.get(e.event_id);
      if (!home) throw new Error(`ack of ${e.event_id}, which this source did not hand out`);
      byWorkspace.set(home, [...(byWorkspace.get(home) ?? []), e.event_id]);
    }
    const now = new Date().toISOString();
    for (const [workspace, ids] of byWorkspace) {
      const handle = await this.store.handle(workspace);
      await handle
        .collection<OutboxRow>(OUTBOX)
        .updateMany(
          { event_id: { $in: ids } },
          { $set: { delivered: true, delivered_at: now }, $inc: { attempts: 1 } },
        );
    }
  }
}
