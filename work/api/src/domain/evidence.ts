/**
 * Evidence (maestro ADR-0019 §5): an item's plan is an ordered list of facts, and an entry is
 * **armed** — written as an expectation under the key the fact will compute — when every earlier
 * entry it waits for is satisfied and its own key is known. Plan order is the order of the world: the
 * deploy counts only after the merge. An entry waits for every earlier entry of another kind, with one
 * exception (maestro ADR-0024): a repository's re-scan and the deploy both follow the merge and not
 * each other, so neither waits for the other. Entries of one kind are armed together, so a weekly
 * fold's findings clear in any order.
 *
 * A fact that arrives for an entry not yet armed matches nothing and is dropped: an alarm that flaps
 * back to OK before the fix is deployed does not close the item; the next OK after the deploy does.
 */

import type { EvidenceEntry, EvidenceKind, WorkItem } from './item.js';

/** A fact from the world, as the adapters and the API report it. */
export interface Fact {
  kind: EvidenceKind;
  /** The key it satisfies: see `keyOf`. */
  key: string;
  /** The fact by reference — a pull request, a deploy, a delivery — as a token. */
  ref: string;
  occurred_at: string;
}

export const factKeys = {
  merged_change: (repository: string, pull: number) => `merged_change#${repository}#${pull}`,
  deploy_event: (application: string, environment: string) => `deploy_event#${application}#${environment}`,
  signal_ok: (fingerprint: string) => `signal_ok#${fingerprint}`,
  rescan_clear: (fingerprint: string) => `rescan_clear#${fingerprint}`,
  decision_accepted: (artifact: string) => `decision_accepted#${artifact}`,
};

/** The key an entry waits on, once the item knows it — undefined until then. */
export function keyOf(item: WorkItem, entry: EvidenceEntry): string | undefined {
  switch (entry.kind) {
    case 'merged_change': {
      const m = item.links?.pull_request?.match(/^(.+)#(\d+)$/);
      return m ? factKeys.merged_change(m[1]!, Number(m[2])) : undefined;
    }
    case 'deploy_event':
      return item.about.application && item.about.environment
        ? factKeys.deploy_event(item.about.application, item.about.environment)
        : undefined;
    case 'signal_ok':
    case 'rescan_clear': {
      const fp = entry.fingerprint ?? item.fingerprint;
      return fp ? factKeys[entry.kind](fp) : undefined;
    }
    case 'decision_accepted':
      return item.links?.artifact ? factKeys.decision_accepted(item.links.artifact) : undefined;
  }
}

export interface Armed {
  index: number;
  key: string;
  /** A fact must not predate this: the latest time an earlier entry was satisfied. */
  after?: string;
}

/**
 * Kinds that follow the same predecessors but not each other. `rescan_clear` is the repository's
 * re-scan (Dependabot, code scanning), which reports the fix once it is on the default branch — before,
 * after or while the fix deploys (ADR-0024).
 */
const UNORDERED: ReadonlyArray<readonly [EvidenceKind, EvidenceKind]> = [['deploy_event', 'rescan_clear']];

const waitsFor = (entry: EvidenceKind, earlier: EvidenceKind): boolean =>
  earlier !== entry &&
  !UNORDERED.some(([a, b]) => (a === entry && b === earlier) || (b === entry && a === earlier));

/** The entries an open item waits on now. */
export function armed(item: WorkItem): Armed[] {
  if (item.state === 'closed') return [];
  const out: Armed[] = [];
  item.evidence_plan.forEach((entry, index) => {
    if (entry.satisfied_at) return;
    const earlier = item.evidence_plan.slice(0, index).filter((e) => waitsFor(entry.kind, e.kind));
    if (earlier.some((e) => !e.satisfied_at)) return;
    const key = keyOf(item, entry);
    if (!key) return;
    const after = earlier
      .map((e) => e.satisfied_at!)
      .sort()
      .at(-1);
    out.push({ index, key, ...(after ? { after } : {}) });
  });
  return out;
}

/** The armed entries a fact satisfies: its key, and not before what had to come first. */
export function satisfiedBy(item: WorkItem, fact: Fact): Armed[] {
  return armed(item).filter((a) => a.key === fact.key && (!a.after || fact.occurred_at >= a.after));
}
