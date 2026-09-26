/**
 * Signals intake, decided (maestro docs/signals.md; ADR-0019 §7): the envelope every adapter
 * produces, and what policy says it becomes. Pure — the service reads the fingerprint and fold
 * items and runs the result through the item's usual read–decide–write.
 *
 *   - an all-clear (`state: ok`) is a fact: `signal_ok`, or `rescan_clear` for an advisory;
 *   - a deploy is a fact: `deploy_event`;
 *   - an alarm-like signal raises its class's item, or attaches to the one its fingerprint raised
 *     while the window runs;
 *   - an advisory or finding raises a remediation (critical, high) or folds into the week's
 *     obligation (medium, low);
 *   - a signal about nothing the definition declares raises a low `review` item, never nothing.
 */

import { z } from 'zod';
import { addDuration, applicationOf, type WorkspaceDefinition } from './definition.js';
import type { Origin, RaiseInput } from './decide.js';
import { Refusal } from './decide.js';
import { factKeys, type Fact } from './evidence.js';
import type { EvidenceKind, ItemClass } from './item.js';
import { BELOW_CORRECTNESS, CORRECTNESS_CLASSES, iso } from './item.js';

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@/+=#-]{0,255}$/;
const token = z.string().regex(TOKEN, 'must be a token — no spaces');
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'must be ISO 8601 UTC');

export const SIGNAL_SOURCES = [
  'cloudwatch-alarm',
  'app-monitor',
  'eventbridge',
  'github',
  'maestro-drift',
  'maestro-heartbeat',
] as const;
export const SIGNAL_KINDS = [
  'alarm_state',
  'dlq',
  'error_rate',
  'latency',
  'deploy',
  'advisory',
  'finding',
  'drift',
  'silence',
] as const;

/** The envelope (maestro docs/signals.md), plus the adapter's delivery id — what makes intake idempotent. */
export const signalSchema = z
  .object({
    signal_version: z.literal(1),
    source: z.enum(SIGNAL_SOURCES),
    /** The source's own id for this delivery: an SNS message id, a GitHub delivery, an EventBridge event. */
    delivery_id: token,
    application: z.string().min(1).max(64),
    environment: z.string().min(1).max(64),
    kind: z.enum(SIGNAL_KINDS),
    state: z.enum(['alarm', 'ok']).optional(),
    severity_hint: token.optional(),
    fingerprint: token,
    resource: z.string().max(2048).optional(),
    occurred_at: instant,
    link: z.string().url().max(2048).optional(),
    /** Source-specific. For an advisory or finding: `severity` (critical, high, medium, low) and `id`. */
    detail: z.record(z.unknown()).default({}),
  })
  .strict();

export type Signal = z.infer<typeof signalSchema>;

const ALARM_LIKE = ['alarm_state', 'dlq', 'error_rate', 'latency', 'silence', 'drift'];
const ADVISORY = ['advisory', 'finding'];
const ADVISORY_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

/** Monday 00:00 UTC of the ISO week `at` falls in, and the week's name: `2026-W39`. */
export function isoWeek(at: string): { name: string; starts: string; ends: string } {
  const d = new Date(at.slice(0, 10) + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // Monday 0
  const monday = new Date(d.getTime() - day * 86_400_000);
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1 = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000);
  const week = Math.round((monday.getTime() - week1.getTime()) / (7 * 86_400_000)) + 1;
  return {
    name: `${year}-W${String(week).padStart(2, '0')}`,
    starts: iso(monday.getTime()),
    ends: iso(monday.getTime() + 7 * 86_400_000),
  };
}

export type Route =
  | { action: 'fact'; fact: Fact }
  | { action: 'raise'; fingerprint: string; input: RaiseInput; origin: Origin }
  | { action: 'fold'; fold: string; fingerprint: string; input: RaiseInput; origin: Origin };

const ref = (s: Signal) => `${s.source}:${s.delivery_id}`;

export function route(definition: WorkspaceDefinition, s: Signal, now: string): Route {
  const policy = definition.policy;
  const app = applicationOf(definition, s.application);
  const known = app && app.environments.includes(s.environment);
  const window = addDuration(now, policy.dedup_window);

  // All-clears and deploys are facts, not items.
  if (s.state === 'ok' && (ALARM_LIKE.includes(s.kind) || ADVISORY.includes(s.kind))) {
    const kind: EvidenceKind = ADVISORY.includes(s.kind) ? 'rescan_clear' : 'signal_ok';
    return {
      action: 'fact',
      fact: { kind, key: factKeys[kind](s.fingerprint), ref: ref(s), occurred_at: s.occurred_at },
    };
  }
  if (s.kind === 'deploy') {
    return {
      action: 'fact',
      fact: {
        kind: 'deploy_event',
        key: factKeys.deploy_event(s.application, s.environment),
        ref: ref(s),
        occurred_at: s.occurred_at,
      },
    };
  }

  const about = known ? { application: s.application, environment: s.environment } : {};
  const title = (what: string) => `${what} on ${s.application}/${s.environment}: ${s.fingerprint}`;

  if (!known) {
    // Never nothing: a low review item, answered for by the steward, names what arrived.
    if (!definition.steward) {
      throw new Refusal(
        `\`${s.application}/${s.environment}\` is not declared in this workspace, and it names no steward to answer for an unmatched signal.`,
      );
    }
    return {
      action: 'raise',
      fingerprint: s.fingerprint,
      input: { class: 'review', title: title(`Unmatched ${s.kind} signal`), raised_cause: ref(s) },
      origin: { fingerprint: s.fingerprint, fingerprint_until: window, accountable: definition.steward },
    };
  }

  if (ADVISORY.includes(s.kind)) {
    const severity = s.detail.severity;
    if (typeof severity !== 'string' || !(ADVISORY_SEVERITIES as readonly string[]).includes(severity)) {
      throw new Refusal(`An ${s.kind} carries detail.severity: critical, high, medium or low.`);
    }
    const id = typeof s.detail.id === 'string' ? s.detail.id : s.fingerprint;
    const row = policy.advisories[severity as (typeof ADVISORY_SEVERITIES)[number]];
    if (row && 'fold_into' in row) {
      const week = isoWeek(now);
      return {
        action: 'fold',
        fold: `${row.fold_into}#${week.name}`,
        fingerprint: s.fingerprint,
        input: {
          class: 'obligation',
          title: `${row.fold_into.replace(/_/g, ' ')}, ${week.name}, ${s.application}/${s.environment}`,
          ...about,
          evidence_plan: ['rescan_clear'],
          raised_cause: ref(s),
        },
        origin: { fingerprint: s.fingerprint, fold: `${row.fold_into}#${week.name}`, resolve_by: week.ends },
      };
    }
    const cls: ItemClass = row?.class ?? 'remediation';
    return {
      action: 'raise',
      fingerprint: s.fingerprint,
      input: {
        class: cls,
        title: title(`Advisory ${id} (${severity})`),
        ...about,
        ...(cls === 'remediation' ? { remediation_class: 'patch' as const } : {}),
        severity_hint: severity === 'critical' ? 'P1' : severity === 'high' ? 'P2' : 'P3',
        evidence_plan: ['merged_change', 'deploy_event', 'rescan_clear'],
        raised_cause: ref(s),
      },
      origin: {
        fingerprint: s.fingerprint,
        fingerprint_until: window,
        ...(row ? { resolve_by: addDuration(now, row.resolve_within) } : {}),
      },
    };
  }

  const mapped = policy.signal_classes[s.kind] ?? 'review';
  // Below N2 maestro raises nothing correctness-shaped; what arrived is still an item, for review.
  const cls =
    CORRECTNESS_CLASSES.includes(mapped) && BELOW_CORRECTNESS.includes(app.onboarding_level)
      ? 'review'
      : mapped;
  return {
    action: 'raise',
    fingerprint: s.fingerprint,
    input: {
      class: cls,
      title: title(s.kind.replace(/_/g, ' ')),
      ...about,
      ...(s.severity_hint ? { severity_hint: s.severity_hint } : {}),
      ...(cls === 'remediation' ? { evidence_plan: ['signal_ok'] as EvidenceKind[] } : {}),
      raised_cause: ref(s),
    },
    origin: { fingerprint: s.fingerprint, fingerprint_until: window },
  };
}
