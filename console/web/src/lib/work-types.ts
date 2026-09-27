/**
 * The shapes work-service returns, written down for the same reason as `types.ts`: a change to its
 * API that would break a screen shows up here as a type error rather than as an empty table.
 */

export type ItemClass = 'change' | 'objective' | 'remediation' | 'obligation' | 'support' | 'review';
export type ItemState = 'open' | 'assigned' | 'in_progress' | 'blocked' | 'resolved' | 'escalated' | 'closed';
export type Outcome = 'done' | 'superseded' | 'escalated_out' | 'refused' | 'expired';
export type Severity = 'sev1' | 'sev2' | 'sev3' | 'sev4';
export type EvidenceKind =
  'merged_change' | 'deploy_event' | 'signal_ok' | 'rescan_clear' | 'decision_accepted';
export type ChaseStep = 'reminder' | 'chase' | 'escalate_accountable' | 'escalate_steward';
export type Clock = 'respond_by' | 'resolve_by';

export interface About {
  application?: string;
  environment?: string;
  subject_type?: string;
  subject_id?: string;
}

export interface EvidenceEntry {
  kind: EvidenceKind;
  fingerprint?: string;
  satisfied_at?: string;
  satisfied_by?: string;
}

export interface WorkItem {
  item_id: string;
  class: ItemClass;
  title: string;
  about: About;
  parent?: string;
  milestone?: string;
  blocked_by?: string[];
  raised_by: 'human' | 'signal' | 'gate' | 'recurrence' | 'run';
  raised_cause?: string;
  raised_by_principal: string;
  fingerprint?: string;
  fold?: string;
  signals?: number;
  links?: { pull_request?: string; artifact?: string };
  consequence_class: string;
  definition_version: number;
  accountable: string;
  assigned_to?: string;
  seat: string;
  oversight_level: string;
  tier?: string;
  onboarding_level?: string;
  remediation_class?: string;
  reversible?: boolean;
  evidence_plan: EvidenceEntry[];
  severity: Severity;
  opened_at: string;
  respond_by?: string;
  resolve_by?: string;
  review_by: string;
  lease_expires_at?: string;
  claimed_at?: string;
  responded_at?: string;
  chase?: { ladder: string; steps: ChaseStep[]; next: number; to?: string };
  breached?: Clock[];
  state: ItemState;
  outcome?: Outcome;
  closed_at?: string;
  reason?: string;
  revision: number;
}

/** Why a row stands where it stands (ADR-0023): the ladder step last fired, and the clocks breached. */
export interface Marks {
  chased?: { step: ChaseStep; n: number; of: number; to?: string };
  breached?: Clock[];
}

export interface FrontierRow {
  item_id: string;
  class: ItemClass;
  title: string;
  about: About;
  accountable: string;
  acting?: string;
  state: ItemState;
  severity: Severity;
  due: string;
  next_human_touchpoint: string;
  marks?: Marks;
}

export type BoardColumn = 'open' | 'assigned' | 'in_progress' | 'blocked' | 'resolved' | 'escalated';

export interface Board {
  columns: Record<BoardColumn, FrontierRow[]>;
  closed_today: Array<FrontierRow & { outcome: Outcome; closed_at: string }>;
}

export interface Today {
  principal: string;
  owes: FrontierRow[];
  oversees: FrontierRow[];
  escalated: FrontierRow[];
}

export interface Edge {
  from: string;
  rel: 'child' | 'member' | 'blocks';
  to: string;
}

export interface EdgeRow {
  item_id: string;
  class: ItemClass;
  title: string;
  state: ItemState;
  accountable: string;
  due: string;
}

export interface Blocking {
  item_id: string;
  blocked_by: EdgeRow[];
  blocks: EdgeRow[];
}

export interface ItemView {
  item: WorkItem;
  edges: Edge[];
  next_human_touchpoint: string;
  marks?: Marks;
}

export interface Rates {
  application: string;
  closed: Record<string, number>;
  refusals: Record<string, number>;
  escalated_out_rate: number | null;
}

/** One event on an item's record, as work-service's `history` returns it. */
export interface HistoryEntry {
  seq: number;
  subject_seq: number;
  type: string;
  at: string;
  recorded_at: string;
  acting: string;
  accountable: string;
  seat: string;
  oversight_level: string;
  body: Record<string, unknown>;
  has_payload: boolean;
}
