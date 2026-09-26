/**
 * Effective dating and lapse (ADR-0010).
 *
 * A tenant artifact is accepted or it is not. A standard is accepted **and in force between two
 * dates**, and can stop being in force with nothing following it — a collective agreement between
 * periods, an instrument in a legislative gap. Acceptance and force are different questions and the
 * design had no answer for the second, so `lapse_behaviour` states what an artifact resting on a
 * lapsed standard is: non-conformant, unregulated, or frozen at the last known reading.
 *
 * The second mechanism here is **acceptance lapse**. An advisor accepts a standard at a version. If
 * a later version of that standard is published and its publication decision classified the change
 * as material, the acceptance no longer stands — because what was accepted is not what is now in
 * force. That is a state, not a notification: it survives being ignored.
 */

import type { EffectiveWindow, LapseBehaviour, Materiality } from './types.js';

export type ForceStatus = 'in_force' | 'pending' | 'lapsed' | 'undated';

/** Whether a version is in force at an instant, independently of whether it was accepted. */
export function forceStatusAt(window: EffectiveWindow | undefined, at: Date): ForceStatus {
  if (!window || (!window.effective_from && !window.effective_to)) return 'undated';
  const t = at.getTime();
  if (window.effective_from && t < Date.parse(window.effective_from)) return 'pending';
  if (window.effective_to && t >= Date.parse(window.effective_to)) return 'lapsed';
  return 'in_force';
}

/**
 * What a dependent claim becomes when the standard it rests on has lapsed with no successor.
 *
 * The pack states this per standard because the honest answer differs: a safety instrument between
 * versions is not the same situation as a cost-coding convention between versions.
 */
export function lapseOutcome(behaviour: LapseBehaviour | undefined): {
  claim: 'fails' | 'unregulated' | 'frozen';
  detail: string;
} {
  switch (behaviour ?? 'fail') {
    case 'unregulated':
      return {
        claim: 'unregulated',
        detail: 'No instrument is in force. The obligation does not apply during the gap.',
      };
    case 'freeze_at_last':
      return {
        claim: 'frozen',
        detail: 'The last version in force continues to be read, and the reading is marked as frozen.',
      };
    case 'fail':
    default:
      return {
        claim: 'fails',
        detail: 'No version is in force, and a claim resting on it cannot be supported.',
      };
  }
}

export interface AcceptanceRecord {
  standard: string;
  /** The standard version the advisor actually read and accepted. */
  standard_ordinal: number;
  pack_version: string;
  accepted_by: string;
  at: string;
  scope: 'tenant' | 'project';
  project?: string;
}

export interface PublishedVersion {
  ordinal: number;
  materiality?: Materiality;
}

/**
 * Whether an acceptance still stands.
 *
 * Only a **material** later version lapses it. An immaterial one — a typo, a clarified example —
 * does not, which is the whole reason materiality is classified on the publication decision rather
 * than inferred from the fact that something changed.
 */
export function acceptanceStatus(
  acceptance: AcceptanceRecord,
  publishedVersions: PublishedVersion[],
): { status: 'active' | 'lapsed'; lapsed_at_ordinal?: number } {
  const materialSince = publishedVersions
    .filter((v) => v.ordinal > acceptance.standard_ordinal && v.materiality === 'material')
    .sort((a, b) => a.ordinal - b.ordinal)[0];

  if (!materialSince) return { status: 'active' };
  return { status: 'lapsed', lapsed_at_ordinal: materialSince.ordinal };
}

/**
 * Validate an effective window before it is written to a version.
 *
 * `effective_to` before `effective_from` is a window nothing can ever be in force during, and it is
 * always a mistake rather than an unusual intent.
 */
export function checkEffectiveWindow(window: EffectiveWindow): string[] {
  const issues: string[] = [];
  const from = window.effective_from ? Date.parse(window.effective_from) : null;
  const to = window.effective_to ? Date.parse(window.effective_to) : null;

  if (window.effective_from && Number.isNaN(from)) issues.push('effective_from is not a date');
  if (window.effective_to && Number.isNaN(to)) issues.push('effective_to is not a date');
  if (from !== null && to !== null && !Number.isNaN(from) && !Number.isNaN(to) && to <= from) {
    issues.push('effective_to is not after effective_from, so nothing could ever be in force');
  }
  return issues;
}
