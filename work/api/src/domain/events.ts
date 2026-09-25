/**
 * The item's events and `evolve`: the head as a fold of them (maestro ADR-0019 §4, §8).
 *
 * The same `evolve` writes the head live and rebuilds it from the archive, so the two are equal by
 * construction. An event carries everything its fold needs — the bodies are tokens (the spine's
 * floor), and the words (a title, a reason) arrive as the event's payload, fetched and checked
 * against its digest on a rebuild.
 */

import type {
  ClaimCheck,
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
export type Closed = Base<'WorkItemClosed', { outcome: Outcome }, { reason: string }>;

export type ItemEvent = Raised | Assigned | ClaimRefused | Released | StateChanged | Escalated | Closed;
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
      evidence_plan: b.evidence_plan.map((kind) => ({ kind })),
      severity: b.severity,
      opened_at: event.at,
      ...(b.respond_by ? { respond_by: b.respond_by } : {}),
      ...(b.resolve_by ? { resolve_by: b.resolve_by } : {}),
      review_by: b.review_by,
      state: 'open',
      revision: 1,
    };
  }

  if (!head) throw new EvolveError(`${event.type} on ${event.item}, which was never raised.`);
  if (head.state === 'closed') throw new EvolveError(`${event.type} on ${event.item}, which is closed.`);
  const next: WorkItem = { ...head, revision: head.revision + 1 };

  switch (event.type) {
    case 'WorkItemAssigned':
      return {
        ...next,
        assigned_to: event.body.assigned_to,
        lease_expires_at: event.body.lease_expires_at,
        claimed_at: event.at,
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
 * The tallies an event moves (ADR-0019 §2, §3 #11): closures by outcome and refusals by check and
 * class, per application per month — the rate the M2 gate asks for in one read. Items about no
 * application are not tallied. The tally is derived; the events are how it is re-derived.
 */
export function talliesOf(head: WorkItem, event: ItemEvent): string[] {
  const app = head.about.application;
  if (!app) return [];
  const month = event.at.slice(0, 7);
  if (event.type === 'WorkItemClosed') return [`${app}#closed_${event.body.outcome}#${month}`];
  if (event.type === 'WorkItemClaimRefused') {
    return [`${app}#refused_${event.body.check}_${event.body.remediation_class ?? 'none'}#${month}`];
  }
  return [];
}
