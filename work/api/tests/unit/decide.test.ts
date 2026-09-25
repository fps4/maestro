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
  heartbeat,
  tick,
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

describe('tick — what the passing of time does', () => {
  const SWEEP: Actor = { principal: 'prn-w-sweep', kind: 'workload', roles: [] };
  // sev1 on tier2: respond 08:30, resolve 16:00; steps at 09:36, 11:12, 12:48, 14:24.
  const deadline = () =>
    raised({ class: 'remediation', title: 'x', application: 'app1', severity_hint: 'P1' });

  it('puts the ladder on every item with a resolve_by, and orders the open set by what is next', () => {
    const item = deadline();
    expect(item.chase?.steps).toEqual(['reminder', 'chase', 'escalate_accountable', 'escalate_steward']);
    expect(nextAt(item)).toBe('2026-09-25T08:30:00Z');
    expect(raised({ class: 'support', title: 'no clocks' }).chase).toBeUndefined();
  });

  it('decides nothing before anything is due', () => {
    expect(tick(env(SWEEP, '2026-09-25T08:29:59Z'), deadline())).toEqual([]);
  });

  it('breaches respond_by once, and not after someone responded', () => {
    const late = tick(env(SWEEP, '2026-09-25T08:31:00Z'), deadline());
    expect(late.map((e) => e.body)).toEqual([{ clock: 'respond_by', due: '2026-09-25T08:30:00Z' }]);
    const after = apply(deadline(), late);
    expect(nextAt(after)).toBe('2026-09-25T09:36:00Z');
    expect(tick(env(SWEEP, '2026-09-25T08:40:00Z'), after)).toEqual([]);

    const item = deadline();
    const held = apply(item, claim(env(ALICE, '2026-09-25T08:10:00Z'), item).events);
    expect(held.responded_at).toBe('2026-09-25T08:10:00Z');
    expect(tick(env(SWEEP, '2026-09-25T08:31:00Z'), held).map((e) => e.type)).not.toContain(
      'WorkItemBreached',
    );
  });

  it('fires every step it missed, in order, then the breach — and closes nothing', () => {
    const events = tick(env(SWEEP, '2026-09-25T16:00:00Z'), deadline());
    const labels = events.map((e) => {
      const body = e.body as { step?: string; clock?: string };
      return [e.type, body.step ?? body.clock];
    });
    expect(labels).toEqual([
      ['WorkItemBreached', 'respond_by'],
      ['WorkItemChased', 'reminder'],
      ['WorkItemChased', 'chase'],
      ['WorkItemChased', 'escalate_accountable'],
      ['WorkItemChased', 'escalate_steward'],
      ['WorkItemBreached', 'resolve_by'],
    ]);
    const after = apply(deadline(), events);
    expect(after.state).toBe('open');
    expect(nextAt(after)).toBe(after.review_by);
  });

  it('reaches a human holder, never an agent, with a reminder', () => {
    const item = deadline();
    const byAgent = apply(item, claim(env(AGENT), item).events);
    const [first] = tick(env(SWEEP, '2026-09-25T08:25:00Z'), byAgent);
    expect(first).toBeUndefined();
    const renewed = apply(byAgent, heartbeat(env(AGENT, '2026-09-25T09:30:00Z'), byAgent));
    const chased = tick(env(SWEEP, '2026-09-25T09:36:00Z'), renewed).find((e) => e.type === 'WorkItemChased');
    expect(chased?.body).toMatchObject({ step: 'reminder', to: 'prn-h-demo-owner' });
    const byAlice = apply(item, claim(env(ALICE), item).events);
    const toAlice = apply(byAlice, heartbeat(env(ALICE, '2026-09-25T09:30:00Z'), byAlice));
    expect(
      tick(env(SWEEP, '2026-09-25T09:36:00Z'), toAlice).find((e) => e.type === 'WorkItemChased')?.body,
    ).toMatchObject({ to: 'prn-h-alice' });
  });

  it('stops chasing a resolved item', () => {
    const item = raised({
      class: 'remediation',
      title: 'x',
      application: 'app1',
      severity_hint: 'P1',
      evidence_plan: ['deploy_event'],
    });
    const held = apply(item, claim(env(ALICE), item).events);
    const done = apply(held, resolve(env(ALICE), held, 'done'));
    expect(done.state).toBe('resolved');
    expect(tick(env(SWEEP, '2026-09-25T15:00:00Z'), done)).toEqual([]);
  });

  it('expires a lease, and a heartbeat moves it', () => {
    const item = deadline();
    const held = apply(item, claim(env(AGENT), item).events);
    const renewed = apply(held, heartbeat(env(AGENT, '2026-09-25T08:20:00Z'), held));
    expect(renewed).toMatchObject({
      state: 'assigned',
      lease_expires_at: '2026-09-25T08:50:00Z',
      claimed_at: NOW,
    });
    expect(tick(env(SWEEP, '2026-09-25T08:45:00Z'), renewed)).toEqual([]);
    const [released] = tick(env(SWEEP, '2026-09-25T08:51:00Z'), renewed);
    expect(released).toMatchObject({
      type: 'WorkItemReleased',
      body: { released: 'prn-a-remed', reason: 'lease_expired' },
    });
    expect(() => heartbeat(env(ALICE), held)).toThrow(/Only the principal holding/);
  });

  it('closes an item past its review date expired', () => {
    const [closed] = tick(env(SWEEP, '2026-10-25T08:00:00Z'), deadline());
    expect(closed).toMatchObject({ type: 'WorkItemClosed', body: { outcome: 'expired' } });
  });
});
