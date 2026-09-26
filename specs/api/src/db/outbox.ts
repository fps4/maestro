/**
 * The record sink: the transactional outbox, holding maestro's spine envelope.
 *
 * Every state change — a version proposed, a decision recorded, a question closed — is emitted
 * **transactionally with the change itself**, and what is emitted is the envelope the spine's
 * relay will carry unchanged (ADR-0019). Attribution is fixed here, at the act: who acted, under
 * which seat, answerable to whom, at what oversight level. Nothing downstream joins a row to
 * whatever the registry or the definition say later.
 *
 * The transaction is the whole point. Writing the change and then emitting the event is two
 * operations that can half-happen, and a record whose event stream disagrees with its state is
 * exactly the corruption the sink exists to make detectable.
 */

import {
  AppendRefused,
  assertEvent,
  uuidv7,
  type OversightLevel,
  type PrincipalResolver,
  type SpineEvent,
  type TypeSchemas,
} from '@fps4/maestro-spine';
import { spineWorkspaceId, versionRef } from '../domain/ids.js';
import type { PrincipalKind } from '../domain/types.js';
import { consequenceClassFor, type Seat, type WorkspaceDefinition } from '../domain/workspace-definition.js';
import type { Transaction, WorkspaceHandle } from './handle.js';
import { RECORD_TYPES } from './record-types.js';

export type { OutboxRow } from './handle.js';

/**
 * Who is acting, and what this workspace has granted them. For an agent, `accountable` is the
 * human its membership names — without one an agent cannot act (ADR-0019 §2).
 */
export interface Actor {
  principal: string;
  kind: PrincipalKind;
  roles: string[];
  accountable?: string;
  /** Ids this principal was known by here before `prn` (ADR-0022); never written to a record. */
  supersedes?: string[];
}

/** What a service records. Everything the envelope needs beyond this is derived at emit. */
export interface Act {
  type: string;
  subject: { artifact: string; ordinal: number };
  /** The artifact's type, for the consequence class. Absent means the workspace's. */
  artifact_type?: string;
  /** The seat the act is authorised under. */
  seat: Seat;
  body: Record<string, unknown>;
  occurred_at?: string;
  /**
   * What the body cannot say — a version's text, a reasoning, a question — written to the payload
   * store before this transaction and named here by locator and digest (ADR-0020 §2). Copied onto
   * the envelope as `payload_ref` and `payload_digest`.
   */
  payload?: { ref: string; digest: string };
  /**
   * A decision's attribution comes from its profile and must agree with the occupancy; anything
   * else is derived. Only a decision sets this.
   */
  attribution?: { accountable?: string; acting?: string; seat?: string; oversight_level?: string };
}

export class ActRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActRefused';
  }
}

export interface RecorderDeps {
  handle: WorkspaceHandle;
  workspace: string;
  definition: WorkspaceDefinition;
  actor: Actor;
  /** The registry, over the ids an emit touches. */
  principals: (ids: string[]) => Promise<Map<string, { kind: PrincipalKind }>>;
  /** One per request, minted at the edge. */
  correlation_id: string;
  types?: TypeSchemas;
  now?: () => string;
}

export const toSpineKind = (kind: PrincipalKind): 'human' | 'agent' | 'workload' =>
  kind === 'service' ? 'workload' : kind;

/**
 * The attribution an act carries, from the actor and the seat (ADR-0019 §2). Pure, so the rule
 * is testable without a database: a human answers for their own act; an agent answers to the
 * human its membership names, and only in a seat whose level admits an agent.
 */
export function attributionFor(
  actor: Actor,
  seat: Seat,
  definition: WorkspaceDefinition,
  declared: Act['attribution'] = {},
): { accountable: string; acting: string; seat: Seat; oversight_level: OversightLevel } {
  const level = definition.seats[seat].oversight_level;
  if (actor.kind === 'human') {
    return {
      accountable: declared.accountable ?? actor.principal,
      acting: declared.acting ?? actor.principal,
      seat,
      oversight_level: (declared.oversight_level as OversightLevel | undefined) ?? level,
    };
  }
  if (level === 'O0') {
    throw new ActRefused(
      `\`${seat}\` is a human's seat (O0); \`${actor.principal}\` is ${article(actor.kind)} ${actor.kind}.`,
    );
  }
  if (!actor.accountable) {
    throw new ActRefused(
      `\`${actor.principal}\` is ${article(actor.kind)} ${actor.kind} with no answerable human named on its membership; it cannot act in \`${seat}\`.`,
    );
  }
  return {
    accountable: actor.accountable,
    acting: actor.principal,
    seat,
    oversight_level: (declared.oversight_level as OversightLevel | undefined) ?? level,
  };
}

/**
 * The seat an ordinary act is authorised under: the first of `seats` the actor holds (ADR-0019
 * §2 — raising a question, recording an evaluation). Deciding is resolved per gate, never here.
 */
export function firstSeat<S extends Seat>(actor: Actor, seats: readonly S[]): S {
  for (const seat of seats) if (actor.roles.includes(seat)) return seat;
  throw new ActRefused(
    `\`${actor.principal}\` holds none of ${seats.map((s) => `\`${s}\``).join(', ')} in this workspace.`,
  );
}

export interface Recorder {
  /** Stage on the caller's transaction. Returns what will be written, in order, once it commits. */
  emit(tx: Transaction, acts: Act[], causation?: string | null): Promise<SpineEvent[]>;
}

/**
 * A recorder bound to one request: one workspace, one actor, one correlation id.
 *
 * `seq` is allocated from the workspace's counter in the same transaction — read here, moved on
 * the condition that it has not moved (ADR-0021 §2) — so ordering is a property of the stream
 * rather than of when a relay happened to read it; `subject_seq` likewise, per subject. A counter
 * that moved cancels the transaction and the handle re-runs the caller. Events of one call chain
 * by `causation_id` to the first of them.
 */
export function createRecorder(deps: RecorderDeps): Recorder {
  const now = deps.now ?? (() => new Date().toISOString());
  const types = deps.types ?? RECORD_TYPES;

  return {
    async emit(tx, acts, causation = null) {
      if (acts.length === 0) return [];

      const attributed = acts.map((act) => ({
        act,
        attribution: attributionFor(deps.actor, act.seat, deps.definition, act.attribution),
      }));

      const known = await deps.principals(
        attributed.flatMap(({ attribution }) => [attribution.accountable, attribution.acting]),
      );
      const resolve: PrincipalResolver = (id) => {
        const p = known.get(id);
        return p ? { kind: toSpineKind(p.kind) } : undefined;
      };

      const { counters, outbox } = deps.handle;
      const start = await counters.get('outbox');
      counters.bump('outbox', start, acts.length, tx);

      // One counter item per subject, moved once by however many acts name it: a transaction
      // touches an item once.
      const subjects = new Map<string, { start: number; used: number }>();
      for (const { act } of attributed) {
        const subjectId = versionRef(act.subject.artifact, act.subject.ordinal);
        if (!subjects.has(subjectId)) {
          subjects.set(subjectId, { start: await counters.get(`subject#${subjectId}`), used: 0 });
        }
      }

      const events: SpineEvent[] = [];
      for (let i = 0; i < attributed.length; i += 1) {
        const { act, attribution } = attributed[i]!;
        const subjectId = versionRef(act.subject.artifact, act.subject.ordinal);
        const subject = subjects.get(subjectId)!;
        subject.used += 1;
        const recordedAt = now();
        const candidate = {
          event_id: uuidv7(),
          workspace_id: spineWorkspaceId(deps.workspace),
          seq: start + i + 1,
          subject_type: 'version',
          subject_id: subjectId,
          subject_seq: subject.start + subject.used,
          type: act.type,
          type_version: 1,
          occurred_at: act.occurred_at ?? recordedAt,
          recorded_at: recordedAt,
          ...attribution,
          consequence_class: consequenceClassFor(deps.definition, act.artifact_type),
          causation_id: i === 0 ? causation : events[0]!.event_id,
          correlation_id: deps.correlation_id,
          body: act.body,
          ...(act.payload ? { payload_ref: act.payload.ref, payload_digest: act.payload.digest } : {}),
        };
        // The spine's own rules, at emit. An event the relay would refuse never reaches the outbox.
        events.push(assertEvent(candidate, resolve, types));
      }

      for (const [subjectId, { start: from, used }] of subjects) {
        counters.bump(`subject#${subjectId}`, from, used, tx);
      }
      for (const event of events) {
        outbox.insert({ ...event, workspace: deps.workspace, delivered: false, attempts: 0 }, tx);
      }
      return events;
    },
  };
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

export { AppendRefused };
