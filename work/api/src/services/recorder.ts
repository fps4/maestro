/**
 * The record sink: an item's events as the spine's envelope, staged on the same transaction as the
 * head they move (maestro ADR-0018; ADR-0019 §4). `seq` is the workspace's outbox counter, moved on
 * the condition that it has not; `subject_seq` is the item's revision, which the head's own
 * condition already guards — there is no separate subject counter.
 *
 * Every envelope passes the spine's append check here, at emit: an event the relay would refuse
 * never reaches the outbox.
 */

import { assertEvent, uuidv7, type OversightLevel, type SpineEvent } from '@fps4/maestro-spine';
import type { Transaction, WorkspaceHandle } from '../db/handle.js';
import type { ItemEvent } from '../domain/events.js';
import { spineWorkspaceId, type PrincipalKind } from '../domain/ids.js';
import { RECORD_TYPES } from '../domain/record-types.js';
import type { PayloadRef } from '../record/payload-store.js';

export interface EmitContext {
  handle: WorkspaceHandle;
  workspace: string;
  /** One per request, minted at the edge. */
  correlation_id: string;
  /** The registry, over the ids an emit touches. */
  principals: (ids: string[]) => Promise<Map<string, PrincipalKind>>;
}

export interface Recordable {
  event: ItemEvent;
  /** The item's revision once this event is applied. */
  subject_seq: number;
  consequence_class: string;
  payload?: PayloadRef;
}

export async function emit(
  tx: Transaction,
  ctx: EmitContext,
  recordables: Recordable[],
): Promise<SpineEvent[]> {
  if (recordables.length === 0) return [];
  const known = await ctx.principals(recordables.flatMap((r) => [r.event.accountable, r.event.acting]));
  const resolve = (id: string) => {
    const kind = known.get(id);
    return kind ? { kind } : undefined;
  };

  const start = await ctx.handle.counters.get('outbox');
  ctx.handle.counters.bump('outbox', start, recordables.length, tx);

  const events: SpineEvent[] = [];
  const recordedAt = recordables[0]!.event.at;
  for (let i = 0; i < recordables.length; i += 1) {
    const { event, subject_seq, consequence_class, payload } = recordables[i]!;
    const candidate = {
      event_id: uuidv7(),
      workspace_id: spineWorkspaceId(ctx.workspace),
      seq: start + i + 1,
      subject_type: 'work_item',
      subject_id: event.item,
      subject_seq,
      type: event.type,
      type_version: 1,
      occurred_at: event.at,
      recorded_at: recordedAt,
      accountable: event.accountable,
      acting: event.acting,
      seat: event.seat,
      oversight_level: event.oversight_level as OversightLevel,
      consequence_class,
      causation_id: i === 0 ? null : events[0]!.event_id,
      correlation_id: ctx.correlation_id,
      body: event.body as Record<string, unknown>,
      ...(payload ? { payload_ref: payload.ref, payload_digest: payload.digest } : {}),
    };
    events.push(assertEvent(candidate, resolve, RECORD_TYPES));
  }
  for (const event of events) {
    ctx.handle.outbox.insert({ ...event, workspace: ctx.workspace, delivered: false, attempts: 0 }, tx);
  }
  return events;
}
