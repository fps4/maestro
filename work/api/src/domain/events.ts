/**
 * The item's events and `evolve`: the head as a fold of them (maestro ADR-0019 §4, §8).
 *
 * The same `evolve` writes the head live and rebuilds it from the archive, so the two are equal by
 * construction. An event carries everything its fold needs — the bodies are tokens (the spine's
 * floor), and the words (a title, a reason) arrive as the event's payload, fetched and checked
 * against its digest on a rebuild.
 */

import type {
  ChaseStep,
  ClaimCheck,
  Clock,
  EvidenceKind,
  ItemClass,
  OnboardingLevel,
  Outcome,
  RaisedBy,
  RemediationClass,
  Severity,
  State,
  WorkItem,
} from './item.js';

export interface Attribution {
  accountable: string;
  acting: string;
  seat: string;
  oversight_level: string;
}

interface Base<T extends string, B, P = undefined> extends Attribution {
  type: T;
  item: string;
  at: string;
  body: B;
  payload?: P;
}

export type Raised = Base<
  'WorkItemRaised',
  {
    class: ItemClass;
    raised_by: RaisedBy;
    raised_cause?: string;
    application?: string;
    environment?: string;
    subject_type?: string;
    subject_ref?: string;
    parent?: string;
    milestone?: string;
    /** The items it waits on, named at raise: each holds a `blocks` edge to it. */
    blocked_by?: string[];
    severity: Severity;
    tier?: string;
    onboarding_level?: OnboardingLevel;
    remediation_class?: RemediationClass;
    reversible?: boolean;
    evidence_plan: EvidenceKind[];
    respond_by?: string;
    resolve_by?: string;
    review_by: string;
    definition_version: number;
    consequence_class: string;
    /** The ladder that chases it and its steps before the breach, copied on at raise. */
    chase_ladder?: string;
    chase_steps?: Exclude<ChaseStep, 'breach'>[];
    /** Raised by a signal: its fingerprint, and until when a repeat attaches rather than raises. */
    fingerprint?: string;
    fingerprint_until?: string;
    /** Raised as a weekly obligation: `<fold>#<ISO week>`. */
    fold?: string;
  },
  { title: string }
>;
export type Assigned = Base<'WorkItemAssigned', { assigned_to: string; lease_expires_at: string }>;
export type ClaimRefused = Base<
  'WorkItemClaimRefused',
  {
    principal: string;
    check: ClaimCheck;
    remediation_class?: RemediationClass;
    onboarding_level?: OnboardingLevel;
  }
>;
export type Released = Base<'WorkItemReleased', { released: string; reason: 'released' | 'lease_expired' }>;
export type StateChanged = Base<'WorkItemStateChanged', { from: State; to: State }>;
export type Escalated = Base<'WorkItemEscalated', { to: string }>;
/**
 * A ladder step, delivered through the notifier — the delivery is part of the fact: `delivered`,
 * `failed`, or `no_recipient` when the step names nobody this workspace can reach.
 */
export type Chased = Base<
  'WorkItemChased',
  {
    step: Exclude<ChaseStep, 'breach'>;
    index: number;
    to?: string;
    delivery: 'delivered' | 'failed' | 'no_recipient';
  }
>;
export type Linked = Base<'WorkItemLinked', { link: 'pull_request' | 'artifact'; ref: string }>;
/** An armed evidence entry met by a fact. `occurred_at` is the fact's own time. */
export type EvidenceSatisfied = Base<
  'WorkItemEvidenceSatisfied',
  { index: number; kind: EvidenceKind; key: string; fact: string; occurred_at: string }
>;
/**
 * A further signal on an item: a repeat of its fingerprint inside the window (the window moves on),
 * or a finding folded into a weekly obligation (which gains that finding's own `rescan_clear`).
 */
export type SignalAttached = Base<
  'WorkItemSignalAttached',
  { fingerprint: string; signal_kind: string; fingerprint_until?: string; adds_rescan_clear?: boolean }
>;
/** A clock passed with its commitment unmet. Recorded, never a closure. */
export type Breached = Base<'WorkItemBreached', { clock: Clock; due: string }>;
export type Closed = Base<'WorkItemClosed', { outcome: Outcome }, { reason: string }>;

export type ItemEvent =
  | Raised
  | Assigned
  | ClaimRefused
  | Released
  | StateChanged
  | Escalated
  | Chased
  | Breached
  | Linked
  | EvidenceSatisfied
  | SignalAttached
  | Closed;
export type ItemEventType = ItemEvent['type'];

export class EvolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvolveError';
  }
}

/** Apply one event to the head. A head of `null` is an item not yet raised. */
export function evolve(head: WorkItem | null, event: ItemEvent): WorkItem {
  if (event.type === 'WorkItemRaised') {
    if (head) throw new EvolveError(`${event.item} is raised twice.`);
    if (!event.payload) throw new EvolveError(`${event.item} is raised without its title.`);
    const b = event.body;
    const about = {
      ...(b.application ? { application: b.application } : {}),
      ...(b.environment ? { environment: b.environment } : {}),
      ...(b.subject_type ? { subject_type: b.subject_type } : {}),
      ...(b.subject_ref ? { subject_id: b.subject_ref } : {}),
    };
    return {
      item_id: event.item,
      class: b.class,
      title: event.payload.title,
      about,
      ...(b.parent ? { parent: b.parent } : {}),
      ...(b.milestone ? { milestone: b.milestone } : {}),
      ...(b.blocked_by ? { blocked_by: b.blocked_by } : {}),
      raised_by: b.raised_by,
      ...(b.raised_cause ? { raised_cause: b.raised_cause } : {}),
      raised_by_principal: event.acting,
      consequence_class: b.consequence_class,
      definition_version: b.definition_version,
      accountable: event.accountable,
      seat: event.seat,
      oversight_level: event.oversight_level,
      ...(b.tier ? { tier: b.tier } : {}),
      ...(b.onboarding_level ? { onboarding_level: b.onboarding_level } : {}),
      ...(b.remediation_class ? { remediation_class: b.remediation_class } : {}),
      ...(b.reversible !== undefined ? { reversible: b.reversible } : {}),
      evidence_plan: b.evidence_plan.map((kind) =>
        b.fingerprint && (kind === 'signal_ok' || kind === 'rescan_clear')
          ? { kind, fingerprint: b.fingerprint }
          : { kind },
      ),
      ...(b.fingerprint ? { fingerprint: b.fingerprint } : {}),
      ...(b.fold ? { fold: b.fold } : {}),
      severity: b.severity,
      opened_at: event.at,
      ...(b.respond_by ? { respond_by: b.respond_by } : {}),
      ...(b.resolve_by ? { resolve_by: b.resolve_by } : {}),
      review_by: b.review_by,
      ...(b.chase_ladder && b.chase_steps
        ? { chase: { ladder: b.chase_ladder, steps: b.chase_steps, next: 0 } }
        : {}),
      state: 'open',
      revision: 1,
    };
  }

  if (!head) throw new EvolveError(`${event.type} on ${event.item}, which was never raised.`);
  if (head.state === 'closed') throw new EvolveError(`${event.type} on ${event.item}, which is closed.`);
  const next: WorkItem = { ...head, revision: head.revision + 1 };

  switch (event.type) {
    case 'WorkItemAssigned':
      // The holder assigned again is a heartbeat: the lease moves, the claim and the state stand.
      if (head.assigned_to === event.body.assigned_to && head.state !== 'open') {
        return { ...next, lease_expires_at: event.body.lease_expires_at };
      }
      return {
        ...next,
        assigned_to: event.body.assigned_to,
        lease_expires_at: event.body.lease_expires_at,
        claimed_at: event.at,
        responded_at: head.responded_at ?? event.at,
        state: 'assigned',
      };
    case 'WorkItemReleased': {
      const { assigned_to: _a, lease_expires_at: _l, claimed_at: _c, ...rest } = next;
      return { ...rest, state: 'open' };
    }
    case 'WorkItemClaimRefused':
      // A refusal is on the record and changes nothing about the item; what follows it (an
      // escalation and a closure, for the onboarding check) is its own event.
      return next;
    case 'WorkItemStateChanged':
      if (head.state !== event.body.from) {
        throw new EvolveError(`${event.item} moves from ${event.body.from}, but it is ${head.state}.`);
      }
      return { ...next, state: event.body.to };
    case 'WorkItemEscalated':
      return { ...next, state: 'escalated' };
    case 'WorkItemChased': {
      if (!head.chase || head.chase.next !== event.body.index) {
        throw new EvolveError(
          `${event.item} is chased at step ${event.body.index}, out of its ladder's order.`,
        );
      }
      return { ...next, chase: { ...head.chase, next: head.chase.next + 1 } };
    }
    case 'WorkItemLinked':
      return { ...next, links: { ...head.links, [event.body.link]: event.body.ref } };
    case 'WorkItemEvidenceSatisfied': {
      const entry = head.evidence_plan[event.body.index];
      if (!entry || entry.kind !== event.body.kind || entry.satisfied_at) {
        throw new EvolveError(
          `${event.item} has no unsatisfied ${event.body.kind} at entry ${event.body.index}.`,
        );
      }
      const plan = head.evidence_plan.map((e, i) =>
        i === event.body.index
          ? { ...e, satisfied_at: event.body.occurred_at, satisfied_by: event.body.fact }
          : e,
      );
      return { ...next, evidence_plan: plan };
    }
    case 'WorkItemSignalAttached':
      return {
        ...next,
        signals: (head.signals ?? 0) + 1,
        ...(event.body.adds_rescan_clear
          ? {
              evidence_plan: [
                ...head.evidence_plan,
                { kind: 'rescan_clear' as const, fingerprint: event.body.fingerprint },
              ],
            }
          : {}),
      };
    case 'WorkItemBreached':
      return { ...next, breached: [...(head.breached ?? []), event.body.clock] };
    case 'WorkItemClosed': {
      if (head.outcome) throw new EvolveError(`${event.item} already has an outcome.`);
      const { lease_expires_at: _l, ...rest } = next;
      return {
        ...rest,
        state: 'closed',
        outcome: event.body.outcome,
        closed_at: event.at,
        ...(event.payload?.reason ? { reason: event.payload.reason } : {}),
      };
    }
    default:
      throw new EvolveError(`\`${(event as ItemEvent).type}\` is not an event this fold knows.`);
  }
}

export function evolveAll(head: WorkItem | null, events: readonly ItemEvent[]): WorkItem | null {
  return events.reduce<WorkItem | null>((h, e) => evolve(h, e), head);
}

/**
 * The tallies an event moves (ADR-0019 §2, §3 #11): closures by outcome, refusals by check and
 * class, and breaches by clock, per application per month — the rate the M2 gate asks for in one read. Items about no
 * application are not tallied. The tally is derived; the events are how it is re-derived.
 */
export function talliesOf(head: WorkItem, event: ItemEvent): string[] {
  const app = head.about.application;
  if (!app) return [];
  const month = event.at.slice(0, 7);
  if (event.type === 'WorkItemClosed') return [`${app}#closed_${event.body.outcome}#${month}`];
  if (event.type === 'WorkItemBreached') return [`${app}#breached_${event.body.clock}#${month}`];
  if (event.type === 'WorkItemClaimRefused') {
    return [`${app}#refused_${event.body.check}_${event.body.remediation_class ?? 'none'}#${month}`];
  }
  return [];
}
