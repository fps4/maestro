import { describe, expect, it } from 'vitest';
import { controlKeys, padSeq, workspaceKeys } from '../../src/db/keys.js';

describe('the key layout', () => {
  const k = workspaceKeys('aannemer-x');

  it('puts every workspace key, and every index key, under the workspace prefix', () => {
    const pks = [
      k.item('wrk-1').pk,
      k.edge('wrk-1', 'blocks', 'wrk-2').pk,
      k.open,
      k.openKey('2026-09-25T08:00:00Z', 'wrk-1').gsi1pk,
      k.closedKey('2026-09-25T08:00:00Z', 'wrk-1').gsi1pk,
      k.applicationKey('app1', '2026-09-25T08:00:00Z', 'wrk-1').gsi2pk,
      k.expectation('deploy_event#app1#production', 'wrk-1', 1).pk,
      k.fingerprint('app1/prod/api/ErrorRate').pk,
      k.fold('weekly_dependency_hygiene', '2026-W39').pk,
      k.tally('app1#closed#done#2026-09').pk,
      k.delivery('github', 'd1').pk,
      k.request('prn-h-a', 'k').pk,
      k.membership('prn-h-a').pk,
      k.outboxItem(1).pk,
      k.pending(1).pending_pk,
      k.counter('item').pk,
      k.meta().pk,
    ];
    for (const pk of pks) expect(pk.startsWith('ws#aannemer-x#')).toBe(true);
    expect(controlKeys.principal('prn-h-a').pk.startsWith('ctl#')).toBe(true);
  });

  it('keeps an item and its edges in one partition', () => {
    expect(k.edge('wrk-7', 'child', 'wrk-9').pk).toBe(k.item('wrk-7').pk);
    expect(k.item('wrk-7').sk).toBe('head');
  });

  it('sorts the open set by time and files a closure under its month', () => {
    expect(
      k.openKey('2026-09-25T08:00:00Z', 'wrk-1').gsi1sk < k.openKey('2026-09-25T09:00:00Z', 'wrk-0').gsi1sk,
    ).toBe(true);
    expect(k.closedKey('2026-09-25T08:00:00Z', 'wrk-1').gsi1pk).toBe('ws#aannemer-x#closed#2026-09');
  });

  it('pads sequence numbers so a string sort is a numeric sort', () => {
    expect(padSeq(9) < padSeq(10)).toBe(true);
  });
});
