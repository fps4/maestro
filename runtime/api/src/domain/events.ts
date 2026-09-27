/**
 * The events this service records, and the heads they fold into (maestro ADR-0027). Three subjects:
 *
 * - an **artifact** — what was built, `<application>@<digest>`, in the ledger;
 * - an **instance** — what is running, `ins-<application>-<environment>`, in the register;
 * - an **application** — its onboarding level and tier, set by a person.
 *
 * A head is a fold of its subject's events, by the same `evolve` the live path and a rebuild use, so
 * what a rebuild writes reads identically to what was dropped. Nothing here reads a clock or a table.
 */

import { artifactSubject, instanceId } from './ids.js';

export const ONBOARDING_LEVELS = ['n0', 'n1', 'n2', 'n3', 'n4'] as const;
export type OnboardingLevel = (typeof ONBOARDING_LEVELS)[number];
export const TIERS = ['tier1', 'tier2', 'tier3'] as const;
export type Tier = (typeof TIERS)[number];

export const INSTANCE_STATES = ['running', 'mismatched'] as const;
export type InstanceState = (typeof INSTANCE_STATES)[number];

/** Who acted and under whose answerability: the envelope's attribution, on every event. */
export interface Attribution {
  accountable: string;
  acting: string;
  seat: string;
  oversight_level: string;
}

interface Base<T extends string, S extends string, B> extends Attribution {
  type: T;
  subject_type: S;
  subject_id: string;
  /** When it happened: the pipeline's event time, or the person's act. */
  at: string;
  body: B;
}

/**
 * An artifact entered the ledger. `built: true` from a build record; `built: false` when a deploy
 * named a digest nothing announced — recorded so the deploy has something to point at, and never
 * mistaken for a build.
 */
export type ArtifactRecorded = Base<
  'ArtifactRecorded',
  'artifact',
  { application: string; digest: string; commit: string; version?: string; sbom?: string; built: boolean }
>;
/** A digest was deployed to an instance; `previous` is what ran before, the new rollback target. */
export type ArtifactDeployed = Base<
  'ArtifactDeployed',
  'instance',
  { application: string; environment: string; digest: string; commit: string; previous?: string }
>;
/** The deployed digest has no build record: a hard stop for the instance, never corrected in place. */
export type DigestMismatchDetected = Base<
  'DigestMismatchDetected',
  'instance',
  { application: string; environment: string; digest: string }
>;
/** A person set an application's onboarding level. work-service projects it (ADR-0027 §4). */
export type InstanceLevelSet = Base<
  'InstanceLevelSet',
  'application',
  { application: string; onboarding_level: OnboardingLevel }
>;
/** A person set an application's tier. work-service projects it (ADR-0027 §4). */
export type InstanceTierSet = Base<'InstanceTierSet', 'application', { application: string; tier: Tier }>;

export type RuntimeEvent =
  ArtifactRecorded | ArtifactDeployed | DigestMismatchDetected | InstanceLevelSet | InstanceTierSet;
export type RuntimeEventType = RuntimeEvent['type'];

export interface ArtifactHead {
  application: string;
  digest: string;
  commit: string;
  version?: string;
  /** Where its SBOM is, in this service's SBOM store. */
  sbom?: string;
  built: boolean;
  recorded_at: string;
  revision: number;
}

export interface InstanceHead {
  instance_id: string;
  application: string;
  environment: string;
  /** The digest running now: a key into the ledger. */
  digest: string;
  commit: string;
  deployed_at: string;
  /** The deploy's acting principal: the pipeline's workload, or a person. */
  deployed_by: string;
  /** What ran before, copied from the deploy that replaced it; never computed. */
  rollback_target?: string;
  state: InstanceState;
  revision: number;
}

export interface ApplicationHead {
  application: string;
  onboarding_level?: OnboardingLevel;
  tier?: Tier;
  revision: number;
}

export class EvolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvolveError';
  }
}

export const subjectOf = {
  artifact: (application: string, digest: string) => artifactSubject(application, digest),
  instance: (application: string, environment: string) => instanceId(application, environment),
  application: (application: string) => application,
};

export function evolveArtifact(head: ArtifactHead | null, event: ArtifactRecorded): ArtifactHead {
  const b = event.body;
  return {
    application: b.application,
    digest: b.digest,
    commit: b.commit,
    ...(b.version ? { version: b.version } : {}),
    ...(b.sbom ? { sbom: b.sbom } : {}),
    // A build record announced later does not unmake the fact that it was deployed unannounced; the
    // ledger learns the build, and the mismatch stays on the instance's record.
    built: b.built || (head?.built ?? false),
    recorded_at: event.at,
    revision: (head?.revision ?? 0) + 1,
  };
}

export function evolveInstance(
  head: InstanceHead | null,
  event: ArtifactDeployed | DigestMismatchDetected,
): InstanceHead {
  const revision = (head?.revision ?? 0) + 1;
  if (event.type === 'DigestMismatchDetected') {
    if (!head) throw new EvolveError(`${event.subject_id} has a mismatch recorded before any deploy.`);
    return { ...head, state: 'mismatched', revision };
  }
  const b = event.body;
  return {
    instance_id: event.subject_id,
    application: b.application,
    environment: b.environment,
    digest: b.digest,
    commit: b.commit,
    deployed_at: event.at,
    deployed_by: event.acting,
    ...(b.previous ? { rollback_target: b.previous } : {}),
    // A deploy is running until its mismatch, recorded after it, says otherwise.
    state: 'running',
    revision,
  };
}

export function evolveApplication(
  head: ApplicationHead | null,
  event: InstanceLevelSet | InstanceTierSet,
): ApplicationHead {
  const next: ApplicationHead = {
    ...(head ?? { application: event.body.application }),
    revision: (head?.revision ?? 0) + 1,
  };
  return event.type === 'InstanceLevelSet'
    ? { ...next, onboarding_level: event.body.onboarding_level }
    : { ...next, tier: event.body.tier };
}
