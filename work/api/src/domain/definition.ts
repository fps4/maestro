/**
 * The workspace definition: seats, applications and policy — work-service's configuration, as data
 * (maestro docs/components/work-service.md, "Policy"). A tenant supplies it from its configuration
 * repository; `npm run workspace:apply` validates and stores it under a version, and every item
 * raised records the version it was raised under.
 *
 * Until runtime-service holds the instance register (M4), an application's tier and onboarding
 * level are read from here: the authority resolver's local default. They are resolved onto an item
 * at raise, never accepted from the caller.
 */

import { OVERSIGHT_LEVELS } from '@fps4/maestro-spine';
import { z } from 'zod';
import { PRINCIPAL_ID } from './ids.js';
import {
  CHASE_STEPS,
  ITEM_CLASSES,
  ONBOARDING_LEVELS,
  REMEDIATION_CLASSES,
  SEVERITIES,
  type ItemClass,
  type OnboardingLevel,
  type RemediationClass,
  type Severity,
} from './item.js';

export class DefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitionError';
  }
}

/** ISO 8601 durations as policy writes them: `PT15M`, `P2D`, `P1W`, `P1DT12H`. No months or years. */
const DURATION = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

export function parseDuration(value: string): number {
  const m = DURATION.exec(value);
  if (!m || value === 'P' || value.endsWith('T')) {
    throw new DefinitionError(`\`${value}\` is not a duration (ISO 8601, e.g. PT15M, P2D, P1W).`);
  }
  const [, w, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return ((((w! * 7 + d!) * 24 + h!) * 60 + min!) * 60 + s!) * 1000;
}

/** An instant plus a duration, as ISO 8601 UTC without milliseconds. */
export function addDuration(at: string, duration: string): string {
  return new Date(Date.parse(at) + parseDuration(duration)).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const duration = z.string().refine((v) => {
  try {
    parseDuration(v);
    return true;
  } catch {
    return false;
  }
}, 'must be an ISO 8601 duration such as PT15M or P2D');

const slug = z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/, 'must be a lower-case slug');
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be lower snake_case');
const human = z
  .string()
  .regex(PRINCIPAL_ID)
  .refine((v) => v.startsWith('prn-h-'), 'must be a human (prn-h-…)');
const tier = z.enum(['tier1', 'tier2', 'tier3']);
const level = z.enum(ONBOARDING_LEVELS);
const remediation = z.enum(REMEDIATION_CLASSES);
const severity = z.enum(SEVERITIES);

const application = z
  .object({
    id: slug,
    tier,
    onboarding_level: level,
    /** The human answerable for items about this application. Never moves once on an item. */
    accountable: human,
    environments: z.array(slug).min(1).default(['prod']),
    /**
     * The repositories the application is built from, each with the environment a fix must reach
     * before its advisory is done — what the GitHub adapter reads to turn an alert into an item
     * about this application, and whose deploy the item waits for.
     */
    repositories: z
      .array(
        z
          .object({
            repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'is <owner>/<repo>'),
            environment: slug,
            /**
             * The directory the application is built from, when a repository builds more than one
             * (`work/`): an alert or a pull request whose manifest lies under it is this application's.
             * The longest match wins; an entry without one takes what no path claims.
             */
            path: z
              .string()
              .regex(/^([A-Za-z0-9_.-]+\/)+$/, 'is a directory relative to the repository root, ending in /')
              .optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

const policy = z
  .object({
    /** The application's own priority → maestro's one scale (maestro ADR-0009). */
    severity_map: z.record(z.string(), severity).default({}),
    /** A raise with no hint, and no signal to resolve one from. */
    default_severity: severity.default('sev4'),
    /** severity × tier → [respond_by, resolve_by], as durations from `opened_at`. */
    clocks: z.record(severity, z.record(tier, z.tuple([duration, duration]))).default({}),
    /** When an item nobody closed closes `expired`. */
    review_within: duration.default('P30D'),
    /** How long a claim holds before the item returns to `open`. */
    lease: duration.default('PT30M'),
    /** The seat each class is offered to. */
    offered_to: z.record(z.enum(ITEM_CLASSES), identifier).default({}),
    default_seat: identifier.default('operations'),
    /**
     * The ceiling for remediation, by onboarding level (maestro CONTEXT.md: onboarding level). A
     * claim on an item whose remediation class is not listed for its application's level is refused
     * for anyone, and the item closes `escalated_out` (governance-model: authority at claim, check 1).
     */
    onboarding: z.record(level, z.array(remediation)).default({}),
    /**
     * An agent's ceiling, per seat, by onboarding level (check 3). A class not listed is refused to
     * an agent in that seat, and the item stays `open` for a principal who may.
     */
    ceilings: z.record(identifier, z.record(level, z.array(remediation))).default({}),
    // Read by later slices (intake, the notifier). Declared now so a tenant's policy file validates
    // whole; a registry can take the fields over later.
    /**
     * Advisories and findings by their severity: an item each, with its deadline — or folded into a
     * weekly obligation, or the board is nothing but bumps (maestro use-cases, UC1b).
     */
    advisories: z
      .record(
        z.enum(['critical', 'high', 'medium', 'low']),
        z.union([
          z.object({ class: z.enum(ITEM_CLASSES), resolve_within: duration }).strict(),
          z.object({ fold_into: identifier }).strict(),
        ]),
      )
      .default({}),
    /** A repeat of a fingerprint inside this window attaches to its item rather than raising another. */
    dedup_window: duration.default('PT10M'),
    /** What each signal kind raises (maestro docs/signals.md, "What a signal becomes"). */
    signal_classes: z.record(z.string(), z.enum(ITEM_CLASSES)).default({
      alarm_state: 'remediation',
      dlq: 'remediation',
      error_rate: 'remediation',
      latency: 'remediation',
      silence: 'remediation',
      drift: 'objective',
    }),
    /**
     * Named ladders of steps (reminder, chase, escalate_accountable, escalate_steward, breach). The
     * steps before `breach` fire evenly across an item's window from `opened_at` to `resolve_by`; the
     * breach is `resolve_by` itself, and is recorded whether a ladder names it or not.
     */
    chase_ladders: z.record(identifier, z.array(z.enum(CHASE_STEPS)).min(1)).default({}),
    /** The ladder every item with a `resolve_by` is chased on. None, and nothing is chased. */
    chase_ladder: identifier.optional(),
    alerts: z.record(z.string(), z.unknown()).default({}),
    // Read by M3's runner, declared so a tenant's policy file validates whole.
    heartbeat_grace: duration.optional(),
  })
  .strict();

const seat = z.object({ oversight_level: z.enum(OVERSIGHT_LEVELS) }).strict();

const definitionSchema = z
  .object({
    workspace: slug,
    definition_version: z.number().int().positive(),
    title: z.string().optional(),
    /** How much a thing matters if wrong; carried on every event. */
    consequence_class: z.string().regex(/^c[0-9]$/),
    seats: z.record(identifier, seat),
    /** The human `escalate_steward` reaches: who answers for the workspace's commitments as a whole. */
    steward: human.optional(),
    applications: z.array(application).default([]),
    policy: policy.default({}),
  })
  .strict();

export type WorkspaceDefinition = z.infer<typeof definitionSchema>;
export type Application = z.infer<typeof application>;
export type Policy = z.infer<typeof policy>;
export type Tier = z.infer<typeof tier>;

export function parseWorkspaceDefinition(raw: unknown): WorkspaceDefinition {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new DefinitionError(`The workspace definition is invalid:\n${lines.join('\n')}`);
  }
  const d = parsed.data;
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const app of d.applications) {
    if (ids.has(app.id)) problems.push(`application \`${app.id}\` is declared twice`);
    ids.add(app.id);
  }
  const repos = new Set<string>();
  for (const app of d.applications) {
    for (const r of app.repositories) {
      if (!app.environments.includes(r.environment)) {
        problems.push(
          `application \`${app.id}\`: repository ${r.repository} names environment \`${r.environment}\`, which it does not have`,
        );
      }
      const where = `${r.repository.toLowerCase()}/${r.path ?? ''}`;
      if (repos.has(where))
        problems.push(
          `repository ${r.repository}${r.path ? ` at ${r.path}` : ''} belongs to two applications; give each its own path`,
        );
      repos.add(where);
    }
  }
  const seats = new Set(Object.keys(d.seats));
  for (const [cls, s] of Object.entries(d.policy.offered_to)) {
    if (!seats.has(s)) problems.push(`policy.offered_to.${cls} names seat \`${s}\`, which is not declared`);
  }
  if (!seats.has(d.policy.default_seat)) {
    problems.push(`policy.default_seat names seat \`${d.policy.default_seat}\`, which is not declared`);
  }
  for (const s of Object.keys(d.policy.ceilings)) {
    if (!seats.has(s)) problems.push(`policy.ceilings names seat \`${s}\`, which is not declared`);
  }
  if (problems.length > 0) {
    throw new DefinitionError(
      `The workspace definition is invalid:\n${problems.map((p) => `  ${p}`).join('\n')}`,
    );
  }
  return d;
}

export function applicationOf(definition: WorkspaceDefinition, id: string): Application | undefined {
  return definition.applications.find((a) => a.id === id);
}

export function seatFor(definition: WorkspaceDefinition, cls: ItemClass): string {
  return definition.policy.offered_to[cls] ?? definition.policy.default_seat;
}

/** Severity from the caller's hint through the map, or the policy's default. Never typed in. */
export function resolveSeverity(policy: Policy, hint: string | undefined): Severity {
  if (hint !== undefined) {
    const mapped = policy.severity_map[hint];
    if (mapped) return mapped;
  }
  return policy.default_severity;
}

export function clocksFor(policy: Policy, sev: Severity, t: Tier | undefined): [string, string] | undefined {
  return t ? policy.clocks[sev]?.[t] : undefined;
}

export function onboardingPermits(policy: Policy, lvl: OnboardingLevel, cls: RemediationClass): boolean {
  return (policy.onboarding[lvl] ?? []).includes(cls);
}

export function agentCeilingPermits(
  policy: Policy,
  seatId: string,
  lvl: OnboardingLevel,
  cls: RemediationClass,
): boolean {
  return (policy.ceilings[seatId]?.[lvl] ?? []).includes(cls);
}

/**
 * The application a repository belongs to, and the environment its fixes must reach. `file` is the
 * manifest or directory the fact is about, relative to the repository root: the entry whose `path` is
 * its longest prefix wins, and an entry with no path takes what none claims.
 */
export function applicationOfRepository(
  definition: WorkspaceDefinition,
  repository: string,
  file = '',
): { application: Application; environment: string } | undefined {
  let best: { application: Application; environment: string; length: number } | undefined;
  for (const application of definition.applications) {
    for (const r of application.repositories) {
      if (r.repository.toLowerCase() !== repository.toLowerCase()) continue;
      const path = r.path ?? '';
      if (!file.startsWith(path)) continue;
      if (!best || path.length > best.length)
        best = { application, environment: r.environment, length: path.length };
    }
  }
  return best && { application: best.application, environment: best.environment };
}
