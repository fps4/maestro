/**
 * An application's tier and onboarding level, as runtime-service sets them (maestro ADR-0027 §4).
 *
 * runtime-service is the one writer: a person sets them there, and it records `InstanceLevelSet` or
 * `InstanceTierSet` on the spine's events topic. This service projects each onto the application and
 * records the projection as its own event, `ApplicationAuthorityProjected`, so a rebuild from its own
 * archive restores it. From an application's first projected value on, that value is read in place
 * of the definition's; an application nobody has set keeps the definition's.
 *
 * Nothing here reads a clock or a table.
 */

import type { SpineEvent } from '@fps4/maestro-spine';
import { Refusal } from './decide.js';
import type { Attribution } from './events.js';
import type { Application, WorkspaceDefinition } from './definition.js';
import { ONBOARDING_LEVELS, type OnboardingLevel } from './item.js';

export const AUTHORITY_FIELDS = ['tier', 'onboarding_level'] as const;
export type AuthorityField = (typeof AUTHORITY_FIELDS)[number];

/** The runtime-service events this service projects, and the field each sets. */
export const PROJECTED: Record<string, AuthorityField> = {
  InstanceLevelSet: 'onboarding_level',
  InstanceTierSet: 'tier',
};

/** The tiers a definition's policy reads clocks for. */
export const TIER = /^tier[1-3]$/;

/** One application's projected authority: each field with the source event that set it. */
export interface Authority {
  application: string;
  tier?: Application['tier'];
  onboarding_level?: OnboardingLevel;
  /** The source stream's `seq` of the event each field was last set by: a replay of an older one is a no-op. */
  tier_seq?: number;
  onboarding_level_seq?: number;
  /** The application's own event count here: the envelope's `subject_seq`. */
  revision: number;
}

export type AuthorityProjected = Attribution & {
  type: 'ApplicationAuthorityProjected';
  application: string;
  at: string;
  body: {
    field: AuthorityField;
    value: string;
    /** Where it was set: runtime-service's workspace stream, the event's `seq` and id there. */
    source_workspace: string;
    source_seq: number;
    source_event: string;
  };
};

/** A refusal like any other: a sentence, and nothing recorded. */
export class AuthorityRefused extends Refusal {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorityRefused';
  }
}

/** The application a runtime-service event is about: its body's, else its subject. */
export function applicationOfSource(source: SpineEvent): string {
  const named = (source.body as { application?: unknown }).application;
  return typeof named === 'string' ? named : source.subject_id;
}

/**
 * The projection an incoming runtime-service event makes, or null when it moves nothing (a replay
 * of the event that set the field, or of an older one). Refused when it is not one this service
 * projects, names an application its definition does not declare, or carries a value its policy
 * cannot read.
 */
export function project(
  definition: WorkspaceDefinition,
  current: Authority | null,
  source: SpineEvent,
  actor: string,
): AuthorityProjected | null {
  const field = PROJECTED[source.type];
  if (!field) throw new AuthorityRefused(`\`${source.type}\` is not an event this service projects.`);
  const body = source.body as { tier?: unknown; onboarding_level?: unknown };
  const application = applicationOfSource(source);
  if (!definition.applications.some((a) => a.id === application)) {
    throw new AuthorityRefused(`\`${application}\` is not an application of \`${definition.workspace}\`.`);
  }
  const value = body[field];
  if (field === 'tier' && (typeof value !== 'string' || !TIER.test(value))) {
    throw new AuthorityRefused(`A tier is tier1–tier3; \`${String(value)}\` is not.`);
  }
  if (field === 'onboarding_level' && !ONBOARDING_LEVELS.includes(value as OnboardingLevel)) {
    throw new AuthorityRefused(`An onboarding level is n0–n4; \`${String(value)}\` is not.`);
  }
  const seen = current?.[`${field}_seq`];
  if (seen !== undefined && source.seq <= seen) return null;
  return {
    type: 'ApplicationAuthorityProjected',
    application,
    at: source.occurred_at,
    accountable: source.accountable,
    acting: actor,
    seat: source.seat,
    oversight_level: source.oversight_level,
    body: {
      field,
      value: value as string,
      source_workspace: source.workspace_id,
      source_seq: source.seq,
      source_event: source.event_id,
    },
  };
}

/** The application's authority once the projection is applied: the same fold live and on a rebuild. */
export function evolveAuthority(before: Authority | null, event: AuthorityProjected): Authority {
  const { field, value, source_seq } = event.body;
  return {
    ...(before ?? { application: event.application, revision: 0 }),
    [field]: value,
    [`${field}_seq`]: source_seq,
    revision: (before?.revision ?? 0) + 1,
  };
}

/** The definition as raise, intake and claim read it: each projected field in place of the declared one. */
export function withAuthority(
  definition: WorkspaceDefinition,
  authorities: Authority[],
): WorkspaceDefinition {
  if (authorities.length === 0) return definition;
  const by = new Map(authorities.map((a) => [a.application, a]));
  return {
    ...definition,
    applications: definition.applications.map((app) => {
      const a = by.get(app.id);
      return a
        ? {
            ...app,
            ...(a.tier ? { tier: a.tier } : {}),
            ...(a.onboarding_level ? { onboarding_level: a.onboarding_level } : {}),
          }
        : app;
    }),
  };
}
