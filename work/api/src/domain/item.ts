/**
 * The work item: its classes, states and outcomes, and the head — the item as it is now, which is a
 * fold of its events (maestro ADR-0019 §4). Nothing here reads a clock or a table.
 */

export const ITEM_CLASSES = [
  'change',
  'objective',
  'remediation',
  'obligation',
  'support',
  'review',
] as const;
export type ItemClass = (typeof ITEM_CLASSES)[number];

export const STATES = [
  'open',
  'assigned',
  'in_progress',
  'blocked',
  'resolved',
  'escalated',
  'closed',
] as const;
export type State = (typeof STATES)[number];

/** Write-once at closure, and mandatory. */
export const OUTCOMES = ['done', 'superseded', 'escalated_out', 'refused', 'expired'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const REMEDIATION_CLASSES = [
  'restore',
  'configure',
  'data_correction',
  'patch',
  'code_change',
] as const;
export type RemediationClass = (typeof REMEDIATION_CLASSES)[number];

export const ONBOARDING_LEVELS = ['n0', 'n1', 'n2', 'n3', 'n4'] as const;
export type OnboardingLevel = (typeof ONBOARDING_LEVELS)[number];

export const SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const RAISED_BY = ['human', 'signal', 'gate', 'recurrence', 'run'] as const;
export type RaisedBy = (typeof RAISED_BY)[number];

/** The fixed vocabulary of facts an item can close on (component page, "Evidence"). */
export const EVIDENCE_KINDS = [
  'merged_change',
  'deploy_event',
  'signal_ok',
  'rescan_clear',
  'decision_accepted',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * Classes that commit maestro to the correctness of a change. At N0 and N1 maestro does not hold
 * change control, so it does not raise these (maestro operations-model: commitments are bounded by
 * authority; governance-model: authority at claim, check 2 — at raise).
 */
export const CORRECTNESS_CLASSES: readonly ItemClass[] = ['change', 'objective'];
export const BELOW_CORRECTNESS: readonly OnboardingLevel[] = ['n0', 'n1'];

/** The governance checks a claim can fail, and what each is counted as. */
export const CLAIM_CHECKS = ['onboarding', 'seat', 'oversight', 'ceiling'] as const;
export type ClaimCheck = (typeof CLAIM_CHECKS)[number];

/** The steps a chase ladder may name (component page, "Time"). `breach` marks where the ladder ends. */
export const CHASE_STEPS = [
  'reminder',
  'chase',
  'escalate_accountable',
  'escalate_steward',
  'breach',
] as const;
export type ChaseStep = (typeof CHASE_STEPS)[number];

/** The clocks that breach. A breach is recorded, never a closure. */
export const CLOCKS = ['respond_by', 'resolve_by'] as const;
export type Clock = (typeof CLOCKS)[number];

/** Where an item stands on its chase ladder: the steps before the breach, and the next to fire. */
export interface Chase {
  ladder: string;
  steps: Exclude<ChaseStep, 'breach'>[];
  next: number;
}

export interface EvidenceEntry {
  kind: EvidenceKind;
  /** For `signal_ok` and `rescan_clear`: the fingerprint whose all-clear satisfies it. */
  fingerprint?: string;
  /** When the fact happened — its own time, not when it was recorded. */
  satisfied_at?: string;
  /** The fact, by reference: a pull request, a deploy, a signal's delivery. */
  satisfied_by?: string;
}

/** What an item is linked to: the pull request that arms `merged_change`, the artifact that arms `decision_accepted`. */
export interface Links {
  pull_request?: string;
  artifact?: string;
}

/** What an item is about: an application and environment, or another subject. */
export interface About {
  application?: string;
  environment?: string;
  subject_type?: string;
  subject_id?: string;
}

export interface WorkItem {
  item_id: string;
  class: ItemClass;
  title: string;
  about: About;
  parent?: string;
  milestone?: string;
  /** The items it was raised waiting on. Whether each still blocks is read from its head. */
  blocked_by?: string[];

  raised_by: RaisedBy;
  raised_cause?: string;
  raised_by_principal: string;
  /** The signal fingerprint that raised it — dedup and correlation key (ADR-0019 §7). */
  fingerprint?: string;
  /** The weekly obligation this item is, `<fold>#<period>`, when it is one. */
  fold?: string;
  /** How many further signals attached to it. */
  signals?: number;
  links?: Links;
  consequence_class: string;
  definition_version: number;

  accountable: string;
  assigned_to?: string;
  seat: string;
  oversight_level: string;

  tier?: string;
  onboarding_level?: OnboardingLevel;
  remediation_class?: RemediationClass;
  reversible?: boolean;
  evidence_plan: EvidenceEntry[];

  severity: Severity;
  opened_at: string;
  respond_by?: string;
  resolve_by?: string;
  review_by: string;
  lease_expires_at?: string;
  claimed_at?: string;
  /** The first claim: `respond_by` is met, and never breaches after. */
  responded_at?: string;
  chase?: Chase;
  breached?: Clock[];

  state: State;
  outcome?: Outcome;
  closed_at?: string;
  /** The words a closure gave, from its payload. */
  reason?: string;

  /** The item's own event count — the envelope's `subject_seq` (ADR-0019 §4). */
  revision: number;
}

export const isClosed = (item: WorkItem): boolean => item.state === 'closed';
export const isHeld = (item: WorkItem): boolean =>
  ['assigned', 'in_progress', 'blocked'].includes(item.state);

/**
 * When the ladder's next step fires. The steps before the breach are spread evenly across the window
 * from `opened_at` to `resolve_by` — step i of k at (i + 1) / (k + 1) of it — and the breach is at
 * `resolve_by` itself. None once the item is resolved: the act is done and evidence is owed.
 */
export function chaseAt(item: WorkItem): string | undefined {
  const c = item.chase;
  if (!c || !item.resolve_by || c.next >= c.steps.length || item.state === 'resolved') return undefined;
  const opened = Date.parse(item.opened_at);
  const window = Date.parse(item.resolve_by) - opened;
  return iso(opened + Math.floor((window * (c.next + 1)) / (c.steps.length + 1)));
}

export const breached = (item: WorkItem, clock: Clock): boolean => item.breached?.includes(clock) ?? false;

/**
 * When the item next needs attention: the earliest of its lease's expiry, `respond_by` until someone
 * has responded, the ladder's next step, `resolve_by` until it breaches, and `review_by`. The open
 * set is sorted by it, and the sweep reads what is due (ADR-0019 §6).
 */
export function nextAt(item: WorkItem): string {
  const candidates = [
    isHeld(item) ? item.lease_expires_at : undefined,
    breached(item, 'respond_by') || (item.responded_at && item.responded_at <= (item.respond_by ?? ''))
      ? undefined
      : item.respond_by,
    chaseAt(item),
    item.state === 'resolved' || breached(item, 'resolve_by') ? undefined : item.resolve_by,
    item.review_by,
  ].filter((t): t is string => typeof t === 'string');
  return candidates.sort()[0]!;
}

export const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export const evidenceSatisfied = (item: WorkItem): boolean =>
  item.evidence_plan.every((e) => e.satisfied_at !== undefined);
