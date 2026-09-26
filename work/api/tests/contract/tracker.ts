/**
 * The tracker contract as a skill sees it, and the skill's acceptance suite (maestro
 * docs/components/work-service.md, "Interfaces"; M2 build gate 6).
 *
 * `Tracker` is the six operations and nothing else — publish, fetch, claim, resolve, frontier,
 * blocking — in the contract's own words. The suite is written against it alone: it names no route,
 * no table and no transport, so it runs unchanged against any server a binding can reach. The MCP
 * server is the one it is bound to here (`mcp.ts`); binding it to another tracker is the test of that
 * tracker.
 *
 * A refusal is a thrown `TrackerRefusal` carrying the server's sentence — except a refused claim,
 * which the contract makes an answer.
 */

import { describe, expect, it } from 'vitest';

export type Row = Record<string, unknown> & { item_id: string };
export type Item = Record<string, unknown> & { item_id: string; state: string };

export interface Tracker {
  publish(input: Record<string, unknown>): Promise<{ item: Item; replayed: boolean }>;
  fetch(item: string): Promise<{ item: Item; edges: unknown[]; next_human_touchpoint: string }>;
  claim(
    item: string,
  ): Promise<
    | { result: 'claimed'; item: Item; lease_expires_at: string }
    | { result: 'refused'; check: string; sentence: string; item: Item }
  >;
  resolve(item: string, outcome: string, reason?: string): Promise<{ item: Item }>;
  frontier(q?: { for?: string; application?: string; milestone?: string; limit?: number }): Promise<{
    rows: Row[];
  }>;
  blocking(item: string): Promise<{ blocked_by: Row[]; blocks: Row[] }>;
}

export class TrackerRefusal extends Error {}

export interface ContractWorld {
  /** A tracker acting as a principal. */
  as(principal: string): Tracker;
  /** Two people who may act in the default seat, and an agent answerable to the first. */
  person: string;
  other: string;
  agent: string;
  /** The accountable human of `governed`'s items. */
  owner: string;
  /** An application onboarded where a patch is within reach, with one of its environments. */
  governed: { application: string; environment: string };
  /** An application onboarded at N1: availability and response, never correctness. */
  operated: { application: string };
}

export function trackerAcceptance(name: string, world: () => ContractWorld): void {
  describe(`tracker contract — ${name}`, () => {
    let seq = 0;
    const title = (what: string) => `${what} ${++seq}`;

    describe('publish', () => {
      it('returns the item as raised, with its authority fields resolved', async () => {
        const w = world();
        const { item, replayed } = await w.as(w.person).publish({
          class: 'remediation',
          title: title('An advisory'),
          ...w.governed,
          remediation_class: 'patch',
          severity_hint: 'P2',
          evidence_plan: ['merged_change', 'deploy_event'],
        });
        expect(replayed).toBe(false);
        expect(item.item_id).toMatch(/^wrk-\d+$/);
        expect(item).toMatchObject({ state: 'open', accountable: w.owner });
        for (const field of ['severity', 'respond_by', 'resolve_by', 'review_by', 'onboarding_level']) {
          expect(item[field], field).toBeTypeOf('string');
        }
        expect(item.evidence_plan).toEqual([{ kind: 'merged_change' }, { kind: 'deploy_event' }]);
      });

      it('refuses an authority field in the input, by name', async () => {
        const w = world();
        for (const field of [
          'severity',
          'accountable',
          'onboarding_level',
          'oversight_level',
          'resolve_by',
        ]) {
          await expect(
            w.as(w.person).publish({ class: 'support', title: title('Mine'), [field]: 'x' }),
          ).rejects.toThrow(`\`${field}\``);
        }
      });

      it('answers a retry with the same key with the same item', async () => {
        const w = world();
        const input = { class: 'support', title: title('Retried'), key: `k-${seq}` };
        const first = await w.as(w.person).publish(input);
        const again = await w.as(w.person).publish(input);
        expect(again).toMatchObject({ replayed: true, item: { item_id: first.item.item_id } });
      });

      it('refuses a correctness-shaped commitment on an N1 application', async () => {
        const w = world();
        await expect(
          w.as(w.person).publish({ class: 'change', title: title('A change'), ...w.operated }),
        ).rejects.toThrow(TrackerRefusal);
      });
    });

    describe('fetch', () => {
      it('returns the item, its evidence, its clocks, its edges and the next human touchpoint', async () => {
        const w = world();
        const t = w.as(w.person);
        const parent = await t.publish({ class: 'objective', title: title('Parent'), ...w.governed });
        const { item } = await t.publish({
          class: 'remediation',
          title: title('Child'),
          ...w.governed,
          parent: parent.item.item_id,
          evidence_plan: ['merged_change'],
        });
        const fetched = await t.fetch(item.item_id);
        expect(fetched.item).toMatchObject({
          item_id: item.item_id,
          parent: parent.item.item_id,
          evidence_plan: [{ kind: 'merged_change' }],
        });
        expect(fetched.item.resolve_by).toBeTypeOf('string');
        expect(fetched.next_human_touchpoint).toBe(w.owner);
        expect((await t.fetch(parent.item.item_id)).edges).toContainEqual(
          expect.objectContaining({ rel: 'child', to: item.item_id }),
        );
      });

      it('refuses an item that does not exist', async () => {
        const w = world();
        await expect(w.as(w.person).fetch('wrk-999999')).rejects.toThrow(TrackerRefusal);
      });
    });

    describe('claim', () => {
      it('answers claimed with a lease, and refuses a second claimant with a sentence', async () => {
        const w = world();
        const { item } = await w.as(w.person).publish({ class: 'support', title: title('Claim me') });
        const won = await w.as(w.person).claim(item.item_id);
        expect(won.result).toBe('claimed');
        if (won.result === 'claimed') expect(won.lease_expires_at).toBeTypeOf('string');
        expect(won.item).toMatchObject({ assigned_to: w.person });

        const lost = await w.as(w.other).claim(item.item_id);
        expect(lost).toMatchObject({ result: 'refused', item: { assigned_to: w.person } });
        if (lost.result === 'refused') expect(lost.sentence.length).toBeGreaterThan(0);
      });

      it('refuses an agent a patch on an N1 application, as an answer, and escalates it out', async () => {
        const w = world();
        const { item } = await w.as(w.person).publish({
          class: 'remediation',
          title: title('Patch on N1'),
          ...w.operated,
          remediation_class: 'patch',
        });
        const answer = await w.as(w.agent).claim(item.item_id);
        expect(answer).toMatchObject({
          result: 'refused',
          check: 'onboarding',
          item: { state: 'closed', outcome: 'escalated_out' },
        });
      });
    });

    describe('resolve', () => {
      it('refuses done from anyone but the holder', async () => {
        const w = world();
        const { item } = await w.as(w.person).publish({ class: 'support', title: title('Held') });
        await w.as(w.person).claim(item.item_id);
        await expect(w.as(w.other).resolve(item.item_id, 'done')).rejects.toThrow(TrackerRefusal);
      });

      it('closes done at once when the evidence plan is already satisfied', async () => {
        const w = world();
        const { item } = await w.as(w.person).publish({ class: 'support', title: title('Answer it') });
        await w.as(w.person).claim(item.item_id);
        expect((await w.as(w.person).resolve(item.item_id, 'done')).item).toMatchObject({
          state: 'closed',
          outcome: 'done',
        });
      });

      it('leaves an item resolved, not closed, while its evidence is owed', async () => {
        const w = world();
        const { item } = await w.as(w.person).publish({
          class: 'remediation',
          title: title('Needs a merge'),
          ...w.governed,
          evidence_plan: ['merged_change'],
        });
        await w.as(w.person).claim(item.item_id);
        const resolved = (await w.as(w.person).resolve(item.item_id, 'done')).item;
        expect(resolved.state).toBe('resolved');
        expect(resolved.outcome).toBeUndefined();
      });

      it('closes with a reason, and refuses any outcome on a closed item', async () => {
        const w = world();
        const { item } = await w.as(w.person).publish({ class: 'support', title: title('Not ours') });
        await w.as(w.person).claim(item.item_id);
        await expect(w.as(w.person).resolve(item.item_id, 'refused')).rejects.toThrow(TrackerRefusal);
        expect((await w.as(w.person).resolve(item.item_id, 'refused', 'Not a defect.')).item).toMatchObject({
          state: 'closed',
          outcome: 'refused',
        });
        await expect(w.as(w.person).resolve(item.item_id, 'superseded', 'Again.')).rejects.toThrow(
          TrackerRefusal,
        );
      });
    });

    describe('frontier', () => {
      it('lists what is owed, soonest due first, with who acts and who to reach', async () => {
        const w = world();
        const { item } = await w.as(w.person).publish({ class: 'support', title: title('On the frontier') });
        await w.as(w.person).claim(item.item_id);
        const { rows } = await w.as(w.person).frontier();
        const dues = rows.map((r) => r.due as string);
        expect(dues).toEqual([...dues].sort());
        expect(rows.find((r) => r.item_id === item.item_id)).toMatchObject({
          acting: w.person,
          state: 'assigned',
          next_human_touchpoint: w.person,
        });
      });

      it('filters for me, by application, and to a limit', async () => {
        const w = world();
        const mine = await w.as(w.other).publish({ class: 'support', title: title('Mine') });
        await w.as(w.other).claim(mine.item.item_id);
        const forMe = (await w.as(w.other).frontier({ for: 'me' })).rows;
        expect(forMe.map((r) => r.item_id)).toContain(mine.item.item_id);
        expect(forMe.every((r) => r.acting === w.other || r.accountable === w.other)).toBe(true);

        const governed = (await w.as(w.person).frontier({ application: w.governed.application })).rows;
        expect(governed.length).toBeGreaterThan(0);
        expect(
          governed.every((r) => (r.about as { application?: string }).application === w.governed.application),
        ).toBe(true);
        expect((await w.as(w.person).frontier({ limit: 1 })).rows).toHaveLength(1);
      });
    });

    describe('blocking', () => {
      it('names what an item waits on and what waits on it, open items only', async () => {
        const w = world();
        const t = w.as(w.person);
        const first = await t.publish({ class: 'support', title: title('First') });
        const then = await t.publish({
          class: 'support',
          title: title('Then'),
          blocked_by: [first.item.item_id],
        });
        expect((await t.blocking(then.item.item_id)).blocked_by.map((r) => r.item_id)).toEqual([
          first.item.item_id,
        ]);
        expect((await t.blocking(first.item.item_id)).blocks.map((r) => r.item_id)).toEqual([
          then.item.item_id,
        ]);

        await t.claim(first.item.item_id);
        await t.resolve(first.item.item_id, 'done');
        expect((await t.blocking(then.item.item_id)).blocked_by).toEqual([]);
      });
    });
  });
}
