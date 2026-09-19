/**
 * An outbox in memory: the local default, and what tests drive the relay with. Same contract as a
 * component's real outbox — per-workspace sequence assigned at emit, delivered flag per event.
 */

import {
  type EmittableEvent,
  type SpineEvent,
  assertEvent,
  type PrincipalResolver,
  type TypeSchemas,
} from '../domain/event.js';
import { uuidv7 } from '../domain/ids.js';
import type { OutboxSource } from './port.js';

interface Row {
  event: SpineEvent;
  delivered: boolean;
}

export class MemoryOutbox implements OutboxSource {
  private readonly rows: Row[] = [];
  private readonly counters = new Map<string, number>();

  constructor(
    private readonly resolve: PrincipalResolver,
    private readonly types?: TypeSchemas,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Emit with the sequence assigned here — the shape a component's transactional outbox has. The
   * caller's `seq` is ignored; `event_id` and `recorded_at` are minted if absent.
   */
  emit(input: Omit<EmittableEvent, 'seq'> & { seq?: number }): SpineEvent {
    const seq = (this.counters.get(input.workspace_id) ?? 0) + 1;
    const candidate = {
      ...input,
      seq,
      event_id: input.event_id ?? uuidv7(),
      recorded_at: input.recorded_at ?? this.now(),
    };
    const event = assertEvent(candidate, this.resolve, this.types);
    this.counters.set(input.workspace_id, seq);
    this.rows.push({ event, delivered: false });
    return event;
  }

  /** Insert without checking — for tests that need an unrecordable event in the outbox. */
  emitUnchecked(event: SpineEvent): void {
    this.counters.set(event.workspace_id, Math.max(this.counters.get(event.workspace_id) ?? 0, event.seq));
    this.rows.push({ event, delivered: false });
  }

  async pending(limit: number): Promise<SpineEvent[]> {
    return this.rows
      .filter((r) => !r.delivered)
      .map((r) => r.event)
      .sort((a, b) => a.workspace_id.localeCompare(b.workspace_id) || a.seq - b.seq)
      .slice(0, limit);
  }

  async ack(events: readonly SpineEvent[]): Promise<void> {
    const keys = new Set(events.map((e) => `${e.workspace_id}#${e.seq}`));
    for (const row of this.rows)
      if (keys.has(`${row.event.workspace_id}#${row.event.seq}`)) row.delivered = true;
  }

  undelivered(): number {
    return this.rows.filter((r) => !r.delivered).length;
  }
}
