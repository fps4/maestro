/**
 * The outbox as the spine sees it: one `OutboxSource` over every workspace's prefix, oldest first
 * within a workspace. The relay never sees a table; it sees pending envelopes and acks them.
 * Pending is the sparse `pending` index, which an outbox item is on only while undelivered.
 *
 * Principals are resolved for the relay's own check from the registry of principals this
 * deployment has seen — the envelope was validated at emit, and the relay checks again because
 * that is what the relay does.
 */

import type { OutboxSource, PrincipalResolver, SpineEvent } from '@fps4/maestro-spine';
import type { Store } from '../db/client.js';

export class DynamoOutboxSource implements OutboxSource {
  private readonly kinds = new Map<string, { kind: 'human' | 'agent' | 'workload' }>();
  /** event_id → where it lives, for the ack; the envelope carries the spine's workspace form. */
  private readonly homes = new Map<string, { workspace: string; seq: number }>();

  constructor(private readonly store: Store) {}

  /** The relay's resolver: whatever `pending` last loaded. */
  readonly resolve: PrincipalResolver = (id) => this.kinds.get(id);

  async pending(limit: number): Promise<SpineEvent[]> {
    const out: SpineEvent[] = [];
    const workspaces = (await this.store.control.workspaces.list()).sort((a, b) => a.id.localeCompare(b.id));
    for (const { id } of workspaces) {
      if (out.length >= limit) break;
      const handle = await this.store.handle(id);
      for (const row of await handle.outbox.pending(limit - out.length)) {
        const { workspace, delivered: _d, delivered_at: _at, attempts: _n, ...event } = row;
        this.homes.set(event.event_id, { workspace, seq: event.seq });
        out.push(event);
      }
    }
    const principals = await this.store.control.principals.getMany(
      out.flatMap((e) => [e.accountable, e.acting]),
    );
    for (const p of principals) this.kinds.set(p.id, { kind: p.kind });
    return out;
  }

  async ack(events: readonly SpineEvent[]): Promise<void> {
    const now = new Date().toISOString();
    for (const e of events) {
      const home = this.homes.get(e.event_id);
      if (!home) throw new Error(`ack of ${e.event_id}, which this source did not hand out`);
      const handle = await this.store.handle(home.workspace);
      await handle.outbox.ack(home.seq, now);
      this.homes.delete(e.event_id);
    }
  }
}
