/**
 * The domain is pure, so these are its specification: what a raise resolves, what a claim checks
 * and in what order, what a closure writes — without a table.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  claim,
  raise,
  Refusal,
  release,
  resolve,
  transition,
  type Actor,
  type Env,
} from '../../src/domain/decide.js';
import { addDuration, parseDuration, parseWorkspaceDefinition } from '../../src/domain/definition.js';
import { evolve, evolveAll, EvolveError, talliesOf, type ItemEvent } from '../../src/domain/events.js';
import { nextAt, type WorkItem } from '../../src/domain/item.js';

const definition = parseWorkspaceDefinition(
  parse(readFileSync(resolvePath(__dirname, '../../../config/workspaces/aannemer-x.yaml'), 'utf8')),
);
const NOW = '2026-09-25T08:00:00Z';
const ALICE: Actor = { principal: 'prn-h-alice', kind: 'human', roles: ['operations'] };
const BOB: Actor = { principal: 'prn-h-bob', kind: 'human', roles: ['operations'] };
const AGENT: Actor = {
  principal: 'prn-a-remed',
  kind: 'agent',
  roles: ['operations'],
  accountable: 'prn-h-alice',
};
const env = (actor: Actor, now = NOW): Env => ({ definition, actor, now });

function raised(input: Parameters<typeof raise>[2], actor = ALICE): WorkItem {
  return evolveAll(null, raise(env(actor), 'wrk-1', input))!;
}

function apply(head: WorkItem, events: ItemEvent[]): WorkItem {
  return evolveAll(head, events)!;
}

describe('durations', () => {
  it('reads ISO 8601 and adds to an instant', () => {
    expect(parseDuration('PT15M')).toBe(900_000);
    expect(parseDuration('P1W')).toBe(7 * 86_400_000);
    expect(addDuration(NOW, 'P1DT2H')).toBe('2026-09-26T10:00:00Z');
    expect(() => parseDuration('15m')).toThrow();
    expect(() => parseDuration('P')).toThrow();
  });
});

describe('the demo definition', () => {
  it('validates', () => {
    expect(definition.applications.map((a) => a.id)).toEqual(['app1', 'app2']);
  });

  it('refuses a seat nobody declared', () => {
    const raw = parse(
      readFileSync(resolvePath(__dirname, '../../../config/workspaces/aannemer-x.yaml'), 'utf8'),
    );
    raw.policy.offered_to.support = 'nobody';
    expect(() => parseWorkspaceDefinition(raw)).toThrow(/seat `nobody`/);
  });
});

describe('raise', () => {
  it('resolves every authority field from the definition and the policy', () => {
    const item = raised({
      class: 'remediation',
      title: 'Bump the parser',
      application: 'app1',
      environment: 'prod',
      remediation_class: 'patch',
      severity_hint: 'P2',
      evidence_plan: ['merged_change', 'deploy_event', 'merged_change'],
    });
    expect(item).toMatchObject({
      item_id: 'wrk-1',
      state: 'open',
      accountable: 'prn-h-demo-owner',
      seat: 'operations',
      oversight_level: 'O2',
      tier: 'tier2',
      onboarding_level: 'n2',
      severity: 'sev2',
      opened_at: NOW,
      respond_by: '2026-09-25T10:00:00Z',
      resolve_by: '2026-09-27T08:00:00Z',
      review_by: '2026-10-25T08:00:00Z',
      raised_by: 'human',
      raised_by_principal: 'prn-h-alice',
      revision: 1,
    });
    expect(item.evidence_plan).toEqual([{ kind: 'merged_change' }, { kind: 'deploy_event' }]);
    expect(nextAt(item)).toBe('2026-09-25T10:00:00Z');
  });

  it('makes the raiser accountable when the item is about no application', () => {
    expect(raised({ class: 'support', title: 'A question' }).accountable).toBe('prn-h-alice');
    expect(raised({ class: 'support', title: 'A question' }, AGENT).accountable).toBe('prn-h-alice');
  });

  it('refuses a correctness-shaped commitment on an N1 application', () => {
    expect(() => raise(env(ALICE), 'wrk-1', { class: 'change', title: 'x', application: 'app2' })).toThrow(
      /N1: maestro commits availability and response there, never correctness/,
    );
  });

  it('refuses an application or environment the definition does not declare', () => {
    expect(() => raise(env(ALICE), 'wrk-1', { class: 'support', title: 'x', application: 'app9' })).toThrow(
      Refusal,
    );
    expect(() =>
      raise(env(ALICE), 'wrk-1', {
        class: 'support',
        title: 'x',
        application: 'app2',
        environment: 'staging',
      }),
    ).toThrow(/no environment `staging`/);
  });

  it('refuses an agent with no answerable human', () => {
    const orphan: Actor = { principal: 'prn-a-orphan', kind: 'agent', roles: ['operations'] };
    expect(() => raise(env(orphan), 'wrk-1', { class: 'support', title: 'x' })).toThrow(
      /no answerable human/,
    );
  });
});

describe('claim — authority at claim, refused rather than warned', () => {
  it('assigns under a lease', () => {
    const item = raised({
      class: 'remediation',
      title: 'x',
      application: 'app1',
      remediation_class: 'patch',
    });
    const { events, result } = claim(env(ALICE), item);
    expect(result).toEqual({ claimed: true });
    const after = apply(item, events);
    expect(after).toMatchObject({
      state: 'assigned',
      assigned_to: 'prn-h-alice',
      lease_expires_at: '2026-09-25T08:30:00Z',
    });
  });

  it('refuses a patch on an N1 application for anyone, and closes it escalated_out to the accountable human', () => {
    const item = raised({
      class: 'remediation',
      title: 'x',
      application: 'app2',
      remediation_class: 'patch',
    });
    const { events, result } = claim(env(ALICE), item);
    expect(result).toMatchObject({ claimed: false, check: 'onboarding' });
    expect(events.map((e) => e.type)).toEqual([
      'WorkItemClaimRefused',
      'WorkItemEscalated',
      'WorkItemClosed',
    ]);
    const after = apply(item, events);
    expect(after).toMatchObject({
      state: 'closed',
      outcome: 'escalated_out',
      accountable: 'prn-h-demo-owner',
    });
    expect(after.reason).toContain('above what N1 permits');
    expect(events.flatMap((e) => talliesOf(after, e))).toEqual([
      'app2#refused_onboarding_patch#2026-09',
      'app2#closed_escalated_out#2026-09',
    ]);
  });

  it('refuses a principal without the seat, and leaves the item open', () => {
    const item = raised({ class: 'remediation', title: 'x', application: 'app1' });
    const { events, result } = claim(env({ ...BOB, roles: [] }), item);
    expect(result).toMatchObject({ claimed: false, check: 'seat' });
    expect(apply(item, events)).toMatchObject({ state: 'open', revision: 2 });
  });

  it('refuses an agent in a human’s seat', () => {
    const item = raised({ class: 'change', title: 'x', application: 'app1' });
    expect(item.seat).toBe('owner');
    const { result } = claim(env({ ...AGENT, roles: ['owner'] }), item);
    expect(result).toMatchObject({ claimed: false, check: 'oversight' });
  });

  it('refuses an agent a class above its ceiling that a person may take', () => {
    const item = raised({
      class: 'remediation',
      title: 'x',
      application: 'app1',
      remediation_class: 'code_change',
    });
    expect(claim(env(AGENT), item).result).toMatchObject({ claimed: false, check: 'ceiling' });
    expect(claim(env(ALICE), item).result).toEqual({ claimed: true });
  });

  it('lets an agent take a patch on N2 under its ceiling', () => {
    const item = raised({
      class: 'remediation',
      title: 'x',
      application: 'app1',
      remediation_class: 'patch',
    });
    expect(claim(env(AGENT), item).result).toEqual({ claimed: true });
  });

  it('answers the second claim with the first claimant, and records nothing', () => {
    const item = raised({ class: 'remediation', title: 'x', application: 'app1' });
    const held = apply(item, claim(env(ALICE), item).events);
    const second = claim(env(BOB), held);
    expect(second.events).toEqual([]);
    expect(second.result).toMatchObject({ claimed: false, check: 'held' });
    expect(claim(env(ALICE), held)).toEqual({ events: [], result: { claimed: true } });
  });
});

describe('the holder’s moves and closure', () => {
  const held = () => {
    const item = raised({ class: 'remediation', title: 'x', application: 'app1' });
    return apply(item, claim(env(ALICE), item).events);
  };

  it('releases back to open, forgetting the holder', () => {
    const after = apply(held(), release(env(ALICE), held()));
    expect(after.state).toBe('open');
    expect(after.assigned_to).toBeUndefined();
    expect(() => release(env(BOB), held())).toThrow(/Only the principal holding/);
  });

  it('moves between working states and refuses the rest', () => {
    const working = apply(held(), transition(env(ALICE), held(), 'in_progress'));
    expect(working.state).toBe('in_progress');
    expect(() => transition(env(ALICE), working, 'closed')).toThrow(/does not move/);
  });

  it('closes done at once when the evidence plan is empty', () => {
    const after = apply(held(), resolve(env(ALICE), held(), 'done'));
    expect(after).toMatchObject({ state: 'closed', outcome: 'done', closed_at: NOW });
  });

  it('waits in resolved while evidence is owed', () => {
    const item = raised({
      class: 'remediation',
      title: 'x',
      application: 'app1',
      evidence_plan: ['deploy_event'],
    });
    const h = apply(item, claim(env(ALICE), item).events);
    expect(apply(h, resolve(env(ALICE), h, 'done'))).toMatchObject({ state: 'resolved' });
  });

  it('closes with a reason by the accountable human, and writes the outcome once', () => {
    const item = raised({ class: 'support', title: 'x' });
    expect(() => resolve(env(ALICE), item, 'refused')).toThrow(/needs a reason/);
    expect(() => resolve(env(BOB), item, 'refused', 'not ours')).toThrow(/Only the holder/);
    const closed = apply(item, resolve(env(ALICE), item, 'refused', 'not ours'));
    expect(closed).toMatchObject({ outcome: 'refused', reason: 'not ours' });
    expect(() => resolve(env(ALICE), closed, 'superseded', 'again')).toThrow(/written once/);
    const again = resolve(env(ALICE), item, 'superseded', 'x');
    expect(() => evolve(closed, again[0]!)).toThrow(EvolveError);
  });
});
