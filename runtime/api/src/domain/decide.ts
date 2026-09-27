/**
 * The decisions: from what was read and what arrived, the events to record. Pure — the service reads
 * the heads, calls these, folds the events and writes them in one transaction.
 *
 * Rules enforced here, at write (maestro docs/components/runtime-service.md):
 * 1. An instance's artifact is a digest into the ledger. A deploy of a digest the ledger does not
 *    hold as built records it unbuilt, and then `DigestMismatchDetected`: a hard stop for that
 *    instance, never repaired in place. The next deploy of a built digest clears it.
 * 2. Onboarding level and tier are set by a person, never by a pipeline.
 * 3. `rollback_target` is copied from what ran before, never computed.
 */

import { applicationOf, type WorkspaceDefinition } from './definition.js';
import {
  subjectOf,
  type ApplicationHead,
  type ArtifactDeployed,
  type ArtifactHead,
  type ArtifactRecorded,
  type Attribution,
  type DigestMismatchDetected,
  type InstanceHead,
  type InstanceLevelSet,
  type InstanceTierSet,
  type OnboardingLevel,
  type Tier,
} from './events.js';
import type { PrincipalKind } from './ids.js';
import type { BuildDetail, DeployDetail } from './intake.js';

/** A rule, not a race: the request is well-formed and the service will not do it. */
export class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refusal';
  }
}

export interface Actor {
  principal: string;
  kind: PrincipalKind;
  roles: string[];
}

export interface Env {
  definition: WorkspaceDefinition;
  actor: Actor;
  now: string;
}

/** What an arrival became: events to record, or a reason it was not this service's to record. */
export type Decision<E> = { events: E[] } | { ignored: string };

function attribution(env: Env, application: string, seat: 'intake' | 'owner'): Attribution {
  return {
    accountable: applicationOf(env.definition, application)!.accountable,
    acting: env.actor.principal,
    seat,
    oversight_level: env.definition.seats[seat]!.oversight_level,
  };
}

function unknownApplication(env: Env, application: string): string | undefined {
  return applicationOf(env.definition, application)
    ? undefined
    : `application \`${application}\` is not declared in \`${env.definition.workspace}\``;
}

/** A build record: the artifact enters the ledger as built. Announcing a known build again is nothing. */
export function build(
  env: Env,
  at: string,
  detail: BuildDetail,
  head: ArtifactHead | null,
): Decision<ArtifactRecorded> {
  const unknown = unknownApplication(env, detail.application);
  if (unknown) return { ignored: unknown };
  if (head?.built) return { events: [] };
  return {
    events: [
      {
        type: 'ArtifactRecorded',
        subject_type: 'artifact',
        subject_id: subjectOf.artifact(detail.application, detail.digest),
        at,
        ...attribution(env, detail.application, 'intake'),
        body: {
          application: detail.application,
          digest: detail.digest,
          commit: detail.commit,
          ...(detail.version ? { version: detail.version } : {}),
          ...(detail.sbom ? { sbom: detail.sbom } : {}),
          built: true,
        },
      },
    ],
  };
}

export interface DeployDecision {
  artifact: ArtifactRecorded[];
  instance: Array<ArtifactDeployed | DigestMismatchDetected>;
  mismatch: boolean;
}

/** A deploy: the instance moves to the digest; an unbuilt digest is recorded and marks it. */
export function deploy(
  env: Env,
  at: string,
  detail: DeployDetail,
  artifact: ArtifactHead | null,
  instance: InstanceHead | null,
): DeployDecision | { ignored: string } {
  const unknown = unknownApplication(env, detail.application);
  if (unknown) return { ignored: unknown };
  const app = applicationOf(env.definition, detail.application)!;
  if (!app.environments.includes(detail.environment)) {
    return {
      ignored: `application \`${app.id}\` has no environment \`${detail.environment}\` (${app.environments.join(', ')})`,
    };
  }
  const by = attribution(env, detail.application, 'intake');
  const recorded: ArtifactRecorded[] = artifact
    ? []
    : [
        {
          type: 'ArtifactRecorded',
          subject_type: 'artifact',
          subject_id: subjectOf.artifact(detail.application, detail.digest),
          at,
          ...by,
          body: {
            application: detail.application,
            digest: detail.digest,
            commit: detail.commit,
            built: false,
          },
        },
      ];
  // What ran before is the new rollback target; a redeploy of the same digest keeps the one it had.
  const previous =
    instance && instance.digest !== detail.digest ? instance.digest : instance?.rollback_target;
  const subject = subjectOf.instance(detail.application, detail.environment);
  const events: DeployDecision['instance'] = [
    {
      type: 'ArtifactDeployed',
      subject_type: 'instance',
      subject_id: subject,
      at,
      ...by,
      body: {
        application: detail.application,
        environment: detail.environment,
        digest: detail.digest,
        commit: detail.commit,
        ...(previous ? { previous } : {}),
      },
    },
  ];
  const mismatch = !artifact?.built;
  if (mismatch) {
    events.push({
      type: 'DigestMismatchDetected',
      subject_type: 'instance',
      subject_id: subject,
      at,
      ...by,
      body: { application: detail.application, environment: detail.environment, digest: detail.digest },
    });
  }
  return { artifact: recorded, instance: events, mismatch };
}

/** Only a person holding `owner` sets what maestro may do to an application, or what it matters. */
function assertOwner(env: Env, what: string): void {
  if (env.actor.kind !== 'human') {
    throw new Refusal(
      `\`${env.actor.principal}\` is ${env.actor.kind === 'agent' ? 'an agent' : 'a workload'}. An application's ${what} is set by a person, never by a pipeline or a run.`,
    );
  }
  if (!env.actor.roles.includes('owner')) {
    throw new Refusal(`Setting an application's ${what} needs \`owner\` in \`${env.definition.workspace}\`.`);
  }
}

export function setLevel(
  env: Env,
  application: string,
  level: OnboardingLevel,
  head: ApplicationHead | null,
): InstanceLevelSet[] {
  assertOwner(env, 'onboarding level');
  const unknown = unknownApplication(env, application);
  if (unknown) throw new Refusal(unknown);
  if (head?.onboarding_level === level) return [];
  return [
    {
      type: 'InstanceLevelSet',
      subject_type: 'application',
      subject_id: subjectOf.application(application),
      at: env.now,
      ...attribution(env, application, 'owner'),
      body: { application, onboarding_level: level },
    },
  ];
}

export function setTier(
  env: Env,
  application: string,
  tier: Tier,
  head: ApplicationHead | null,
): InstanceTierSet[] {
  assertOwner(env, 'tier');
  const unknown = unknownApplication(env, application);
  if (unknown) throw new Refusal(unknown);
  if (head?.tier === tier) return [];
  return [
    {
      type: 'InstanceTierSet',
      subject_type: 'application',
      subject_id: subjectOf.application(application),
      at: env.now,
      ...attribution(env, application, 'owner'),
      body: { application, tier },
    },
  ];
}
