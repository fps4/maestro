/**
 * The event types this service emits and their body schemas, keyed `Type@version` for the spine's
 * append check. The spine's floor applies to every body — tokens only, never prose — and a type's
 * schema here narrows it. `InstanceLevelSet` and `InstanceTierSet` are a contract: work-service
 * projects them (maestro ADR-0027 §4), so their names and bodies change only with a new version.
 */

import { typeKey, type TypeSchemas } from '@fps4/maestro-spine';
import { z } from 'zod';
import { ONBOARDING_LEVELS, TIERS, type RuntimeEventType } from './events.js';
import { DIGEST } from './ids.js';

const id = z.string().min(1);
const digest = z.string().regex(DIGEST);

const bodies: Record<RuntimeEventType, z.ZodTypeAny> = {
  ArtifactRecorded: z
    .object({
      application: id,
      digest,
      commit: id,
      version: id.optional(),
      sbom: id.optional(),
      built: z.boolean(),
    })
    .strict(),
  ArtifactDeployed: z
    .object({ application: id, environment: id, digest, commit: id, previous: digest.optional() })
    .strict(),
  DigestMismatchDetected: z.object({ application: id, environment: id, digest }).strict(),
  InstanceLevelSet: z.object({ application: id, onboarding_level: z.enum(ONBOARDING_LEVELS) }).strict(),
  InstanceTierSet: z.object({ application: id, tier: z.enum(TIERS) }).strict(),
};

export const RECORD_TYPES: TypeSchemas = new Map(
  Object.entries(bodies).map(([type, schema]) => [typeKey(type, 1), schema]),
);

export const RECORD_TYPE_NAMES = Object.keys(bodies) as RuntimeEventType[];
