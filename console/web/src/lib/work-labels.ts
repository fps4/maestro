/**
 * Words for work-service's identifiers (ux.md rule 6), and the derived values shown with their
 * derivation (rule 4). Pure, so the pages and the tests read the same sentences.
 */

import type {
  ChaseStep,
  Clock,
  EvidenceKind,
  ItemClass,
  ItemState,
  Marks,
  Outcome,
  WorkItem,
} from './work-types';

export const CLASS_LABELS: Record<ItemClass, string> = {
  change: 'Change',
  objective: 'Objective',
  remediation: 'Remediation',
  obligation: 'Obligation',
  support: 'Support',
  review: 'Review',
};

export const ITEM_STATE_LABELS: Record<ItemState, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In progress',
  blocked: 'Blocked',
  resolved: 'Resolved · evidence owed',
  escalated: 'Escalated',
  closed: 'Closed',
};

/** `escalated_out` is an outcome and a rate, never a failure (rule 9): its word is neutral. */
export const OUTCOME_LABELS: Record<Outcome, string> = {
  done: 'Done',
  superseded: 'Superseded',
  escalated_out: 'Escalated out',
  refused: 'Refused',
  expired: 'Expired',
};

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  merged_change: 'The change is merged',
  deploy_event: 'It is deployed',
  signal_ok: 'The signal clears',
  rescan_clear: 'A re-scan finds it clear',
  decision_accepted: 'The decision is accepted',
};

const STEP_LABELS: Record<ChaseStep, string> = {
  reminder: 'reminded',
  chase: 'chased',
  escalate_accountable: 'escalated to the answerable person',
  escalate_steward: 'escalated to the steward',
};

const CLOCK_LABELS: Record<Clock, string> = {
  respond_by: 'respond by',
  resolve_by: 'resolve by',
};

export const clockLabel = (clock: Clock): string => CLOCK_LABELS[clock];

/**
 * Why a row is where it is, as the sentences ADR-0023 names: "escalated to you, step 3 of 5",
 * "breached resolve by". A step that reached the reader says so; one that reached someone else
 * names the role.
 */
export function markSentences(marks: Marks | undefined, me?: string): string[] {
  if (!marks) return [];
  const out: string[] = [];
  const c = marks.chased;
  if (c) {
    const reachedMe = !!me && c.to === me;
    const what =
      reachedMe && c.step.startsWith('escalate')
        ? 'escalated to you'
        : reachedMe
          ? `${STEP_LABELS[c.step]} you`
          : STEP_LABELS[c.step];
    out.push(`${what}, step ${c.n} of ${c.of}`);
  }
  for (const clock of marks.breached ?? []) out.push(`breached ${CLOCK_LABELS[clock]}`);
  return out;
}

/** A principal as a reader should see it: "you", an agent marked as one, else its id. */
export function principalLabel(id: string | undefined, me?: string): { text: string; agent: boolean } {
  if (!id) return { text: 'nobody', agent: false };
  if (id === me) return { text: 'you', agent: false };
  return { text: id, agent: id.startsWith('prn-a-') };
}

/**
 * The derivation of an item's clocks (rule 4): severity × tier × onboarding level · policy version.
 * Nothing a person typed: every term is on the item, resolved at raise.
 */
export function derivation(
  item: Pick<WorkItem, 'severity' | 'tier' | 'onboarding_level' | 'definition_version'>,
): string {
  const terms = [item.severity.toUpperCase(), item.tier, item.onboarding_level?.toUpperCase()].filter(
    Boolean,
  );
  return `${terms.join(' × ')} · policy v${item.definition_version}`;
}

// Not `toLocaleString`: ICU's short month differs by version ("Sep", "Sept"), and a clock must read the same everywhere.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** An instant in UTC, as a person reads it: "27 Sep 09:00 UTC". Clocks are policy's, in UTC. */
export function utc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** How far away a due time is: "in 3 h", "2 d overdue". */
export function dueIn(iso: string, now: number = Date.now()): { text: string; overdue: boolean } {
  const ms = Date.parse(iso) - now;
  if (Number.isNaN(ms)) return { text: iso, overdue: false };
  const abs = Math.abs(ms);
  const span =
    abs < 3_600_000
      ? `${Math.max(1, Math.round(abs / 60_000))} min`
      : abs < 86_400_000
        ? `${Math.round(abs / 3_600_000)} h`
        : `${Math.round(abs / 86_400_000)} d`;
  return ms < 0 ? { text: `${span} overdue`, overdue: true } : { text: `in ${span}`, overdue: false };
}

/** What a row is about: the application and environment, or its subject. */
export function aboutLabel(about: WorkItem['about']): string {
  if (about.application) return [about.application, about.environment].filter(Boolean).join(' · ');
  if (about.subject_type) return [about.subject_type, about.subject_id].filter(Boolean).join(' ');
  return '—';
}

/** A pull request reference, `<owner>/<repo>#<n>`, as the URL it names on GitHub. */
export function pullRequestUrl(ref: string): string | null {
  const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([1-9][0-9]*)$/.exec(ref);
  return m ? `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` : null;
}
