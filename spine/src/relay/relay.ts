/**
 * The relay: drain a component's outbox in sequence order, write each event to the archive, publish
 * it for delivery, and acknowledge. Idempotent — a run that dies anywhere is repeated on the next
 * schedule and lands the same events once.
 *
 * It never skips an event. One that fails the append rules stops its workspace where it stands, the
 * outbox keeps it undelivered, and the report names it; relay lag is the alarm. Silently dropping an
 * unrecordable event would make the archive disagree with the component that emitted it, which is
 * the one corruption the spine exists to make impossible.
 */

import { append } from '../archive/writer.js';
import type { ArchiveStore } from '../archive/port.js';
import type { Delivery } from '../delivery/port.js';
import {
  AppendRefused,
  checkEvent,
  type AppendIssue,
  type PrincipalResolver,
  type SpineEvent,
  type TypeSchemas,
} from '../domain/event.js';
import type { OutboxSource } from './port.js';

export interface RelayDeps {
  source: OutboxSource;
  archive: ArchiveStore;
  delivery: Delivery;
  resolve: PrincipalResolver;
  types?: TypeSchemas;
  /** The archive day to write to: today, UTC. Injectable so a test can cross midnight. */
  today?: () => string;
}

export interface RelayReport {
  archived: number;
  published: number;
  acked: number;
  refused: Array<{ workspace_id: string; seq: number; issues: AppendIssue[] }>;
}

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function relayOnce(deps: RelayDeps, batch = 100): Promise<RelayReport> {
  const { source, archive, delivery, resolve, types } = deps;
  const today = deps.today ?? utcDay;
  const report: RelayReport = { archived: 0, published: 0, acked: 0, refused: [] };

  const pending = await source.pending(batch);
  if (pending.length === 0) return report;

  const byWorkspace = new Map<string, SpineEvent[]>();
  for (const event of pending) {
    const group = byWorkspace.get(event.workspace_id) ?? [];
    group.push(event);
    byWorkspace.set(event.workspace_id, group);
  }

  for (const [workspace, group] of byWorkspace) {
    group.sort((a, b) => a.seq - b.seq);

    // Validate up to the first refusal; everything before it is still recordable in order.
    const accepted: SpineEvent[] = [];
    for (const event of group) {
      const issues = checkEvent(event, resolve, types);
      if (issues.length > 0) {
        report.refused.push({ workspace_id: workspace, seq: event.seq, issues });
        break;
      }
      accepted.push(event);
    }
    if (accepted.length === 0) continue;

    const result = await append(archive, accepted, today());
    report.archived += result.written;
    await delivery.publish(accepted);
    report.published += accepted.length;
    await source.ack(accepted);
    report.acked += accepted.length;
  }

  return report;
}

/** Run until the outbox is drained or an event is refused. */
export async function relayUntilDrained(deps: RelayDeps, batch = 100): Promise<RelayReport> {
  const total: RelayReport = { archived: 0, published: 0, acked: 0, refused: [] };
  for (;;) {
    const report = await relayOnce(deps, batch);
    total.archived += report.archived;
    total.published += report.published;
    total.acked += report.acked;
    total.refused.push(...report.refused);
    if (report.acked === 0 || report.refused.length > 0) return total;
  }
}

export { AppendRefused };
