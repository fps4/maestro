/**
 * Evidence and routing are pure: what an item waits on, in what order, and what a signal becomes.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseWorkspaceDefinition } from '../../src/domain/definition.js';
import { armed, factKeys, satisfiedBy } from '../../src/domain/evidence.js';
import { isoWeek, route, signalSchema } from '../../src/domain/intake.js';
import type { WorkItem } from '../../src/domain/item.js';

const definition = parseWorkspaceDefinition(
  parse(readFileSync(resolvePath(__dirname, '../../../config/workspaces/aannemer-x.yaml'), 'utf8')),
);
const NOW = '2026-09-28T08:00:00Z';

const item = (over: Partial<WorkItem> = {}): WorkItem =>
  ({
    item_id: 'wrk-1',
    state: 'open',
    about: { application: 'app1', environment: 'prod' },
    fingerprint: 'GHSA-x:app1',
    evidence_plan: [{ kind: 'merged_change' }, { kind: 'deploy_event' }, { kind: 'rescan_clear' }],
    ...over,
  }) as WorkItem;

describe('arming, in the order of the world', () => {
  it('arms nothing that needs a link the item does not have', () => {
    expect(armed(item())).toEqual([]);
  });

  it('arms the merge once linked, then the deploy and the re-scan together (ADR-0024)', () => {
    const linked = item({ links: { pull_request: 'acme/app1#42' } });
    expect(armed(linked)).toEqual([{ index: 0, key: 'merged_change#acme/app1#42' }]);
    const merged = item({
      links: { pull_request: 'acme/app1#42' },
      evidence_plan: [
        { kind: 'merged_change', satisfied_at: '2026-09-28T10:00:00Z' },
        { kind: 'deploy_event' },
        { kind: 'rescan_clear' },
      ],
    });
    expect(armed(merged)).toEqual([
      { index: 1, key: 'deploy_event#app1#prod', after: '2026-09-28T10:00:00Z' },
      { index: 2, key: 'rescan_clear#GHSA-x:app1', after: '2026-09-28T10:00:00Z' },
    ]);
    // Either may come first: the re-scan satisfied leaves the deploy armed, not after the re-scan.
    const rescanned = item({
      links: { pull_request: 'acme/app1#42' },
      evidence_plan: [
        { kind: 'merged_change', satisfied_at: '2026-09-28T10:00:00Z' },
        { kind: 'deploy_event' },
        { kind: 'rescan_clear', satisfied_at: '2026-09-28T10:05:00Z' },
      ],
    });
    expect(armed(rescanned)).toEqual([
      { index: 1, key: 'deploy_event#app1#prod', after: '2026-09-28T10:00:00Z' },
    ]);
    const early = {
      kind: 'deploy_event' as const,
      key: factKeys.deploy_event('app1', 'prod'),
      ref: 'd',
      occurred_at: '2026-09-28T09:00:00Z',
    };
    expect(satisfiedBy(merged, early)).toEqual([]);
    expect(satisfiedBy(merged, { ...early, occurred_at: '2026-09-28T10:30:00Z' })).toHaveLength(1);
  });

  it('arms a fold’s findings together, each on its own fingerprint', () => {
    const fold = item({
      evidence_plan: [
        { kind: 'rescan_clear', fingerprint: 'a' },
        { kind: 'rescan_clear', fingerprint: 'b', satisfied_at: NOW },
        { kind: 'rescan_clear', fingerprint: 'c' },
      ],
    });
    expect(armed(fold).map((a) => a.key)).toEqual(['rescan_clear#a', 'rescan_clear#c']);
    expect(armed({ ...fold, state: 'closed' })).toEqual([]);
  });
});

describe('what a signal becomes', () => {
  const s = (over: Record<string, unknown>) =>
    signalSchema.parse({
      signal_version: 1,
      source: 'github',
      delivery_id: 'd1',
      application: 'app1',
      environment: 'prod',
      fingerprint: 'fp-1',
      occurred_at: NOW,
      kind: 'alarm_state',
      state: 'alarm',
      ...over,
    });

  it('names ISO weeks as the calendar does', () => {
    expect(isoWeek('2026-09-28T08:00:00Z')).toEqual({
      name: '2026-W40',
      starts: '2026-09-28T00:00:00Z',
      ends: '2026-10-05T00:00:00Z',
    });
    expect(isoWeek('2027-01-01T12:00:00Z').name).toBe('2026-W53');
    expect(isoWeek('2026-01-01T00:00:00Z').name).toBe('2026-W01');
  });

  it('turns all-clears and deploys into facts, never items', () => {
    expect(route(definition, s({ state: 'ok' }), NOW)).toMatchObject({
      action: 'fact',
      fact: { kind: 'signal_ok', key: 'signal_ok#fp-1' },
    });
    expect(route(definition, s({ kind: 'advisory', state: 'ok' }), NOW)).toMatchObject({
      fact: { kind: 'rescan_clear' },
    });
    expect(route(definition, s({ kind: 'deploy', state: undefined }), NOW)).toMatchObject({
      fact: { key: 'deploy_event#app1#prod' },
    });
  });

  it('raises critical and high advisories each, and folds medium and low', () => {
    const high = route(
      definition,
      s({ kind: 'advisory', state: undefined, detail: { severity: 'high' } }),
      NOW,
    );
    expect(high).toMatchObject({ action: 'raise', origin: { resolve_by: '2026-10-05T08:00:00Z' } });
    const low = route(definition, s({ kind: 'finding', state: undefined, detail: { severity: 'low' } }), NOW);
    expect(low).toMatchObject({ action: 'fold', fold: 'weekly_dependency_hygiene#app1#prod#2026-W40' });
    expect(() => route(definition, s({ kind: 'advisory', state: undefined }), NOW)).toThrow(
      /detail.severity/,
    );
  });

  it('raises a review rather than an objective below N2', () => {
    expect(route(definition, s({ kind: 'drift', application: 'app2' }), NOW)).toMatchObject({
      input: { class: 'review' },
    });
    expect(route(definition, s({ kind: 'drift' }), NOW)).toMatchObject({ input: { class: 'objective' } });
  });

  it('refuses prose where a token belongs', () => {
    expect(() => s({ fingerprint: 'an error rate' })).toThrow();
  });
});
