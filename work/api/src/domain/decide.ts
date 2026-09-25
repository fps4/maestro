/**
 * `decide`: a pure function of the head, the command, the definition and the clock, returning the
 * events the command records (maestro ADR-0019 §4). It never reads a table; a caller that lost a
 * race re-reads the head and decides again, and the loser of two claims is refused against the
 * winner's head with a sentence — which is what "first claim wins" means.
 *
 * Two kinds of no. A **refusal at claim** is a result: it is recorded, counted, and answered as
 * `refused` (maestro governance-model, authority at claim). A command the rules do not allow at all
 * — resolving a closed item, raising a change on an N1 application — is a `Refusal` thrown back to
 * the caller, and nothing is recorded.
 */

import {
  addDuration,
  agentCeilingPermits,
  applicationOf,
  clocksFor,
  onboardingPermits,
  resolveSeverity,
  seatFor,
  type WorkspaceDefinition,
} from './definition.js';
import { evolve, type Attribution, type Chased, type ItemEvent } from './events.js';
import type { PrincipalKind } from './ids.js';
import {
  BELOW_CORRECTNESS,
  breached,
  chaseAt,
  CORRECTNESS_CLASSES,
  evidenceSatisfied,
  isHeld,
  type ClaimCheck,
  type EvidenceKind,
  type ItemClass,
  type Outcome,
  type RaisedBy,
  type RemediationClass,
  type State,
  type WorkItem,
} from './item.js';

export class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refusal';
  }
}

export interface Actor {
  principal: string;
  kind: PrincipalKind;
  roles: string[];
  /** For an agent: the human its membership names as answerable. */
  accountable?: string;
}

export interface Env {
  definition: WorkspaceDefinition;
  actor: Actor;
  /** ISO 8601 UTC. */
  now: string;
}

export interface RaiseInput {
  class: ItemClass;
  title: string;
  application?: string;
  environment?: string;
  subject_type?: string;
  subject_id?: string;
  parent?: string;
  milestone?: string;
  remediation_class?: RemediationClass;
  reversible?: boolean;
  severity_hint?: string;
  evidence_plan?: EvidenceKind[];
  raised_cause?: string;
}

const RAISED_BY_KIND: Record<PrincipalKind, RaisedBy> = { human: 'human', agent: 'run', workload: 'signal' };

/** Every act about an item is answered for by the item's accountable human, who never moves. */
function attribution(
  env: Env,
  item: Pick<WorkItem, 'accountable' | 'seat' | 'oversight_level'>,
): Attribution {
  return {
    accountable: item.accountable,
    acting: env.actor.principal,
    seat: item.seat,
    oversight_level: item.oversight_level,
  };
}

/** An agent acts here only with a human its membership names as answerable. */
function assertMayAct(actor: Actor): void {
  if (actor.kind !== 'human' && !actor.accountable) {
    throw new Refusal(
      `\`${actor.principal}\` is ${actor.kind === 'agent' ? 'an agent' : 'a workload'} with no answerable human named on its membership; it cannot act in this workspace.`,
    );
  }
}

export function raise(env: Env, id: string, input: RaiseInput): ItemEvent[] {
  const { definition, actor, now } = env;
  assertMayAct(actor);
  const policy = definition.policy;

  const app = input.application ? applicationOf(definition, input.application) : undefined;
  if (input.application && !app) {
    throw new Refusal(`No application \`${input.application}\` is declared in this workspace.`);
  }
  if (input.environment && !app) {
    throw new Refusal('An environment is named only together with its application.');
  }
  if (app && input.environment && !app.environments.includes(input.environment)) {
    throw new Refusal(
      `\`${app.id}\` has no environment \`${input.environment}\` (it has ${app.environments.map((e) => `\`${e}\``).join(', ')}).`,
    );
  }
  if (input.remediation_class && input.class !== 'remediation') {
    throw new Refusal(`A remediation class belongs on a remediation item, not a \`${input.class}\`.`);
  }
  // Check 2 of three, taken at raise: maestro does not commit to correctness below N2.
  if (app && CORRECTNESS_CLASSES.includes(input.class) && BELOW_CORRECTNESS.includes(app.onboarding_level)) {
    throw new Refusal(
      `\`${app.id}\` is onboarded at ${app.onboarding_level.toUpperCase()}: maestro commits availability and response there, never correctness, so it raises no \`${input.class}\` about it.`,
    );
  }

  const accountable = app?.accountable ?? (actor.kind === 'human' ? actor.principal : actor.accountable!);
  const seat = seatFor(definition, input.class);
  const seatDecl = definition.seats[seat]!;
  const severity = resolveSeverity(policy, input.severity_hint);
  const clocks = clocksFor(policy, severity, app?.tier);
  const plan = [...new Set(input.evidence_plan ?? [])];

  return [
    {
      type: 'WorkItemRaised',
      item: id,
      at: now,
      accountable,
      acting: actor.principal,
      seat,
      oversight_level: seatDecl.oversight_level,
      body: {
        class: input.class,
        raised_by: RAISED_BY_KIND[actor.kind],
        ...(input.raised_cause ? { raised_cause: input.raised_cause } : {}),
        ...(app ? { application: app.id, tier: app.tier, onboarding_level: app.onboarding_level } : {}),
        ...(input.environment ? { environment: input.environment } : {}),
        ...(input.subject_type ? { subject_type: input.subject_type } : {}),
        ...(input.subject_id ? { subject_ref: input.subject_id } : {}),
        ...(input.parent ? { parent: input.parent } : {}),
        ...(input.milestone ? { milestone: input.milestone } : {}),
        severity,
        ...(input.remediation_class ? { remediation_class: input.remediation_class } : {}),
        ...(input.reversible !== undefined ? { reversible: input.reversible } : {}),
        evidence_plan: plan,
        ...(clocks
          ? { respond_by: addDuration(now, clocks[0]), resolve_by: addDuration(now, clocks[1]) }
          : {}),
        review_by: addDuration(now, policy.review_within),
        definition_version: definition.definition_version,
        consequence_class: definition.consequence_class,
        ...(clocks && policy.chase_ladder
          ? {
              chase_ladder: policy.chase_ladder,
              chase_steps: policy.chase_ladders[policy.chase_ladder]!.filter(
                (step): step is Exclude<typeof step, 'breach'> => step !== 'breach',
              ),
            }
          : {}),
      },
      payload: { title: input.title },
    },
  ];
}

export type ClaimResult =
  { claimed: true } | { claimed: false; check: ClaimCheck | 'held'; sentence: string };

function refusalSentence(check: ClaimCheck, item: WorkItem, actor: Actor): string {
  const app = item.about.application ?? 'this application';
  const level = item.onboarding_level?.toUpperCase();
  switch (check) {
    case 'onboarding':
      return `A ${item.remediation_class} on \`${app}\` is above what ${level} permits. The item is escalated to its accountable human, \`${item.accountable}\`, and closed \`escalated_out\`: the owner takes the act in their own process.`;
    case 'seat':
      return `\`${item.item_id}\` is offered to the \`${item.seat}\` seat, which \`${actor.principal}\` does not hold here. It stays open for a principal who does.`;
    case 'oversight':
      return `\`${item.seat}\` acts at ${item.oversight_level}, a human's level; \`${actor.principal}\` is ${actor.kind === 'agent' ? 'an agent' : 'a workload'}. It stays open for a principal who may.`;
    case 'ceiling':
      return `A ${item.remediation_class} on a ${level} application is above an agent's ceiling in \`${item.seat}\`. It stays open for a principal who may.`;
  }
}

export function claim(env: Env, item: WorkItem): { events: ItemEvent[]; result: ClaimResult } {
  const { actor, now, definition } = env;
  if (item.state === 'closed') throw new Refusal(`\`${item.item_id}\` is closed (${item.outcome}).`);
  if (item.assigned_to === actor.principal && isHeld(item)) return { events: [], result: { claimed: true } };
  if (item.state !== 'open') {
    return {
      events: [],
      result: {
        claimed: false,
        check: 'held',
        sentence: item.assigned_to
          ? `\`${item.item_id}\` is held by \`${item.assigned_to}\`; the first claim won.`
          : `\`${item.item_id}\` is ${item.state}, not open.`,
      },
    };
  }
  assertMayAct(actor);
  const by = attribution(env, item);
  const policy = definition.policy;
  const refuse = (check: ClaimCheck): ItemEvent => ({
    type: 'WorkItemClaimRefused',
    item: item.item_id,
    at: now,
    ...by,
    body: {
      principal: actor.principal,
      check,
      ...(item.remediation_class ? { remediation_class: item.remediation_class } : {}),
      ...(item.onboarding_level ? { onboarding_level: item.onboarding_level } : {}),
    },
  });

  // 1. The item's own fact, for anyone: the class above what the application's level permits.
  if (
    item.remediation_class &&
    item.onboarding_level &&
    !onboardingPermits(policy, item.onboarding_level, item.remediation_class)
  ) {
    const sentence = refusalSentence('onboarding', item, actor);
    return {
      events: [
        refuse('onboarding'),
        { type: 'WorkItemEscalated', item: item.item_id, at: now, ...by, body: { to: item.accountable } },
        {
          type: 'WorkItemClosed',
          item: item.item_id,
          at: now,
          ...by,
          body: { outcome: 'escalated_out' },
          payload: { reason: sentence },
        },
      ],
      result: { claimed: false, check: 'onboarding', sentence },
    };
  }

  // 3. The principal: the seat, its oversight level, and an agent's ceiling for this class.
  let check: ClaimCheck | undefined;
  if (!actor.roles.includes(item.seat)) check = 'seat';
  else if (actor.kind !== 'human' && item.oversight_level === 'O0') check = 'oversight';
  else if (
    actor.kind !== 'human' &&
    item.remediation_class &&
    item.onboarding_level &&
    !agentCeilingPermits(policy, item.seat, item.onboarding_level, item.remediation_class)
  )
    check = 'ceiling';
  if (check) {
    return {
      events: [refuse(check)],
      result: { claimed: false, check, sentence: refusalSentence(check, item, actor) },
    };
  }

  return {
    events: [
      {
        type: 'WorkItemAssigned',
        item: item.item_id,
        at: now,
        ...by,
        body: { assigned_to: actor.principal, lease_expires_at: addDuration(now, policy.lease) },
      },
    ],
    result: { claimed: true },
  };
}

function assertHolder(env: Env, item: WorkItem, what: string): void {
  if (item.state === 'closed') throw new Refusal(`\`${item.item_id}\` is closed (${item.outcome}).`);
  if (!isHeld(item) || item.assigned_to !== env.actor.principal) {
    throw new Refusal(
      `Only the principal holding \`${item.item_id}\` may ${what} it${item.assigned_to ? `; \`${item.assigned_to}\` does` : '; nobody holds it'}.`,
    );
  }
}

export function release(env: Env, item: WorkItem): ItemEvent[] {
  assertHolder(env, item, 'release');
  return [
    {
      type: 'WorkItemReleased',
      item: item.item_id,
      at: env.now,
      ...attribution(env, item),
      body: { released: env.actor.principal, reason: 'released' },
    },
  ];
}

const MOVES: Record<string, readonly State[]> = {
  assigned: ['in_progress', 'blocked'],
  in_progress: ['blocked'],
  blocked: ['in_progress'],
};

/** The holder's own moves between working states. Closing is `resolve`; releasing is `release`. */
export function transition(env: Env, item: WorkItem, to: State): ItemEvent[] {
  assertHolder(env, item, 'move');
  if (item.state === to) return [];
  if (!MOVES[item.state]?.includes(to)) {
    throw new Refusal(`\`${item.item_id}\` does not move from ${item.state} to ${to}.`);
  }
  return [
    {
      type: 'WorkItemStateChanged',
      item: item.item_id,
      at: env.now,
      ...attribution(env, item),
      body: { from: item.state, to },
    },
  ];
}

export type ResolveOutcome = Exclude<Outcome, 'expired'>;

/**
 * `done` marks the act performed: the item is `resolved`, and closes `done` when its evidence plan is
 * satisfied — at once if it already is. Any other outcome closes it with a reason, by its holder or
 * its accountable human.
 */
export function resolve(env: Env, item: WorkItem, outcome: ResolveOutcome, reason?: string): ItemEvent[] {
  const { actor, now } = env;
  if (item.state === 'closed')
    throw new Refusal(`\`${item.item_id}\` is closed (${item.outcome}); an outcome is written once.`);
  const by = attribution(env, item);

  if (outcome === 'done') {
    assertHolder(env, item, 'resolve');
    const events: ItemEvent[] = [
      {
        type: 'WorkItemStateChanged',
        item: item.item_id,
        at: now,
        ...by,
        body: { from: item.state, to: 'resolved' },
      },
    ];
    if (evidenceSatisfied(item)) {
      events.push({
        type: 'WorkItemClosed',
        item: item.item_id,
        at: now,
        ...by,
        body: { outcome: 'done' },
        ...(reason ? { payload: { reason } } : {}),
      });
    }
    return events;
  }

  if (!reason?.trim()) throw new Refusal(`Closing \`${item.item_id}\` \`${outcome}\` needs a reason.`);
  const holder = isHeld(item) && item.assigned_to === actor.principal;
  if (!holder && actor.principal !== item.accountable) {
    throw new Refusal(
      `Only the holder of \`${item.item_id}\` or its accountable human, \`${item.accountable}\`, may close it \`${outcome}\`.`,
    );
  }
  const events: ItemEvent[] = [];
  if (outcome === 'escalated_out') {
    events.push({
      type: 'WorkItemEscalated',
      item: item.item_id,
      at: now,
      ...by,
      body: { to: item.accountable },
    });
  }
  events.push({
    type: 'WorkItemClosed',
    item: item.item_id,
    at: now,
    ...by,
    body: { outcome },
    payload: { reason },
  });
  return events;
}

/** The holder renews its lease. Recorded, so a rebuilt head expires when the live one would. */
export function heartbeat(env: Env, item: WorkItem): ItemEvent[] {
  assertHolder(env, item, 'renew the lease on');
  return [
    {
      type: 'WorkItemAssigned',
      item: item.item_id,
      at: env.now,
      ...attribution(env, item),
      body: {
        assigned_to: item.assigned_to!,
        lease_expires_at: addDuration(env.now, env.definition.policy.lease),
      },
    },
  ];
}

/** Who a ladder step reaches: a human holder, else the accountable human; the steward by name. */
function recipient(
  definition: WorkspaceDefinition,
  item: WorkItem,
  step: Chased['body']['step'],
): string | undefined {
  switch (step) {
    case 'reminder':
    case 'chase':
      return isHeld(item) && item.assigned_to?.startsWith('prn-h-') ? item.assigned_to : item.accountable;
    case 'escalate_accountable':
      return item.accountable;
    case 'escalate_steward':
      return definition.steward;
  }
}

/**
 * What the passing of time does to an item (ADR-0019 §6), decided at `env.now` by the sweep: an item
 * past `review_by` closes `expired`; a lease past its expiry returns the item to `open` with the
 * reason; an unmet `respond_by` or `resolve_by` is recorded as a breach — never a closure; each
 * ladder step now due is a `WorkItemChased`. Steps missed while the sweep was down all fire, in order.
 *
 * A chase's `delivery` is `no_recipient` when the step names nobody, and `failed` until the caller
 * delivers it through the notifier and records what happened.
 */
export function tick(env: Env, item: WorkItem): ItemEvent[] {
  const { now, definition } = env;
  if (item.state === 'closed') return [];
  const by = attribution(env, item);

  if (item.review_by <= now) {
    return [
      {
        type: 'WorkItemClosed',
        item: item.item_id,
        at: now,
        ...by,
        body: { outcome: 'expired' },
        payload: {
          reason: `Open past its review date, ${item.review_by}; expiry is recorded, never a disappearance.`,
        },
      },
    ];
  }

  const events: ItemEvent[] = [];
  let head = item;
  const push = (event: ItemEvent) => {
    events.push(event);
    head = evolve(head, event);
  };

  if (isHeld(head) && head.lease_expires_at && head.lease_expires_at <= now) {
    push({
      type: 'WorkItemReleased',
      item: item.item_id,
      at: now,
      ...by,
      body: { released: head.assigned_to!, reason: 'lease_expired' },
    });
  }
  // Met only by a response in time: a first claim after `respond_by` is a late response, and the
  // breach is recorded even if no sweep ran between the deadline and the claim.
  const respondBy = head.respond_by;
  if (
    respondBy &&
    respondBy <= now &&
    !breached(head, 'respond_by') &&
    (!head.responded_at || head.responded_at > respondBy)
  ) {
    push({
      type: 'WorkItemBreached',
      item: item.item_id,
      at: now,
      ...by,
      body: { clock: 'respond_by', due: respondBy },
    });
  }
  for (let due = chaseAt(head); due !== undefined && due <= now; due = chaseAt(head)) {
    const index = head.chase!.next;
    const step = head.chase!.steps[index]!;
    const to = recipient(definition, head, step);
    push({
      type: 'WorkItemChased',
      item: item.item_id,
      at: now,
      ...by,
      body: { step, index, ...(to ? { to } : {}), delivery: to ? 'failed' : 'no_recipient' },
    });
  }
  if (
    head.resolve_by &&
    head.state !== 'resolved' &&
    !breached(head, 'resolve_by') &&
    head.resolve_by <= now
  ) {
    push({
      type: 'WorkItemBreached',
      item: item.item_id,
      at: now,
      ...by,
      body: { clock: 'resolve_by', due: head.resolve_by },
    });
  }
  return events;
}
