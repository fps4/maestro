/**
 * The key layout (ADR-0021): every key of a workspace begins with its prefix, ordinals and
 * sequences sort as numbers, and the item access refuses a key outside the prefix it was built
 * for — before any request is made, so the guard needs no table to prove itself.
 */

import { describe, expect, it } from 'vitest';
import { Items, IsolationViolation } from '../../src/db/items.js';
import { controlKeys, padOrdinal, padSeq, workspaceKeys } from '../../src/db/keys.js';
import { tableDefinition, schemaDiscrepancies } from '../../src/db/table.js';

describe('the key layout', () => {
  const k = workspaceKeys('aannemer-x');

  it('puts every item of a workspace under its prefix, and every index key too', () => {
    const keys = [
      k.artifact('art-1'),
      k.draft('dft-1'),
      k.version('art-1', 3),
      k.decision('art-1', 'dec-1'),
      k.evaluation('art-1', 3, 'sufficiency'),
      k.membership('prn-h-1'),
      k.question('qst-1'),
      k.acceptance('STD-1', 'tenant'),
      k.outboxItem(12),
      k.counter('outbox'),
      k.meta(),
    ];
    for (const key of keys) expect(key.pk.startsWith('ws#aannemer-x#')).toBe(true);
    expect(k.versionByState('accepted', 'art-1', 3).gsi1pk.startsWith('ws#aannemer-x#')).toBe(true);
    expect(k.versionByStandard('STD-1', 3).gsi2pk.startsWith('ws#aannemer-x#')).toBe(true);
    expect(
      k.questionOf('art-1', 3, '2026-09-20T00:00:00Z', 'qst-1').gsi1pk.startsWith('ws#aannemer-x#'),
    ).toBe(true);
    expect(k.draftByArtifact('art-1', 'dft-1').gsi1pk.startsWith('ws#aannemer-x#')).toBe(true);
    expect(k.pending(12).pending_pk).toBe('ws#aannemer-x#outbox');
  });

  it('does not let one workspace’s prefix be a prefix of another’s', () => {
    // `ws#a#` is not a prefix of `ws#a-b#…`: the prefix ends with the separator.
    expect(workspaceKeys('a-b').artifact('x').pk.startsWith(workspaceKeys('a').prefix)).toBe(false);
  });

  it('pads ordinals and sequences so a string sort is a numeric sort', () => {
    expect(padOrdinal(9) < padOrdinal(10)).toBe(true);
    expect(padSeq(999) < padSeq(1000)).toBe(true);
    expect(k.version('art-1', 2).sk < k.version('art-1', 10).sk).toBe(true);
    expect(k.outboxItem(2).sk < k.outboxItem(10).sk).toBe(true);
  });

  it('keeps control items under their own prefix, with the subject mapping unambiguous', () => {
    expect(controlKeys.workspace('x').pk).toBe('ctl#workspaces');
    expect(controlKeys.definition('x', 2).sk).toBe(`x#${padOrdinal(2)}`);
    const a = controlKeys.principalBySubject('https://a', 'b#c');
    const b = controlKeys.principalBySubject('https://a#b', 'c');
    expect(a.sk).not.toBe(b.sk);
  });
});

describe('the item guard', () => {
  const items = new Items(null as never, 'table', workspaceKeys('a').prefix);

  it('refuses a key under another prefix before any request is made', async () => {
    const other = workspaceKeys('b').artifact('art-1');
    await expect(items.get(other)).rejects.toThrow(IsolationViolation);
    await expect(items.query(other.pk)).rejects.toThrow(IsolationViolation);
    await expect(items.put({ ...other, kind: 'artifact' })).rejects.toThrow(IsolationViolation);
    await expect(items.update(other, { set: { x: 1 } })).rejects.toThrow(IsolationViolation);
    await expect(items.delete(other)).rejects.toThrow(IsolationViolation);
    await expect(items.batchGet([other])).rejects.toThrow(IsolationViolation);
    await expect(items.batchWrite([], [other])).rejects.toThrow(IsolationViolation);
    expect(() => items.transaction().check(other, (e) => `attribute_exists(${e.n('pk')})`, 'x')).toThrow(
      IsolationViolation,
    );
  });

  it('refuses an item filed under another workspace’s index partition', async () => {
    const mine = workspaceKeys('a').version('art-1', 1);
    await expect(
      items.put({ ...mine, kind: 'version', gsi1pk: 'ws#b#version', gsi1sk: 'x' }),
    ).rejects.toThrow(IsolationViolation);
    await expect(
      items.put({ ...mine, kind: 'version', pending_pk: 'ws#b#outbox', pending_sk: 'x' }),
    ).rejects.toThrow(IsolationViolation);
  });

  it('refuses a transaction that touches one item twice', () => {
    const tx = items.transaction();
    const key = workspaceKeys('a').counter('outbox');
    tx.update(key, { set: { value: 1 } });
    expect(() => tx.update(key, { set: { value: 2 } })).toThrow(/twice/);
  });
});

describe('the table schema', () => {
  it('declares the key, the two indexes and the pending index, on demand', () => {
    const def = tableDefinition('t');
    expect(def.BillingMode).toBe('PAY_PER_REQUEST');
    expect(def.KeySchema).toEqual([
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ]);
    expect((def.GlobalSecondaryIndexes ?? []).map((i) => i.IndexName)).toEqual(['gsi1', 'gsi2', 'pending']);
  });

  it('finds what a deployed table lacks', () => {
    expect(
      schemaDiscrepancies({ KeySchema: tableDefinition('t').KeySchema, GlobalSecondaryIndexes: [] }),
    ).toEqual(['it has no index `gsi1`', 'it has no index `gsi2`', 'it has no index `pending`']);
    expect(
      schemaDiscrepancies({
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        GlobalSecondaryIndexes: tableDefinition('t').GlobalSecondaryIndexes,
      }),
    ).toEqual(['its key is (id:HASH), not (pk, sk)']);
  });
});
