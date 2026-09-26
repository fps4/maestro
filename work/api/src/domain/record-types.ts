/**
 * The event types this service emits and their body schemas, keyed `Type@version` for the spine's
 * append check (maestro ADR-0019 §8). The spine's floor applies to every body — tokens only, never
 * prose — and a type's schema here narrows it. A title or a reason is a payload, never a body.
 */

import { typeKey, type TypeSchemas } from '@fps4/maestro-spine';
import { z } from 'zod';
import type { ItemEventType } from './events.js';
import {
  CHASE_STEPS,
  CLAIM_CHECKS,
  CLOCKS,
  EVIDENCE_KINDS,
  ITEM_CLASSES,
  ONBOARDING_LEVELS,
  OUTCOMES,
  RAISED_BY,
  REMEDIATION_CLASSES,
  SEVERITIES,
  STATES,
} from './item.js';

const id = z.string().min(1);
const prn = z.string().regex(/^prn-[haw]-/);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

const bodies: Record<ItemEventType, z.ZodTypeAny> = {
  WorkItemRaised: z
    .object({
      class: z.enum(ITEM_CLASSES),
      raised_by: z.enum(RAISED_BY),
      raised_cause: id.optional(),
      application: id.optional(),
      environment: id.optional(),
      subject_type: id.optional(),
      subject_ref: id.optional(),
      parent: id.optional(),
      milestone: id.optional(),
      severity: z.enum(SEVERITIES),
      tier: id.optional(),
      onboarding_level: z.enum(ONBOARDING_LEVELS).optional(),
      remediation_class: z.enum(REMEDIATION_CLASSES).optional(),
      reversible: z.boolean().optional(),
      evidence_plan: z.array(z.enum(EVIDENCE_KINDS)),
      respond_by: instant.optional(),
      resolve_by: instant.optional(),
      review_by: instant,
      definition_version: z.number().int().positive(),
      consequence_class: z.string().regex(/^c[0-9]$/),
      chase_ladder: id.optional(),
      fingerprint: id.optional(),
      fingerprint_until: instant.optional(),
      fold: id.optional(),
      chase_steps: z.array(z.enum(CHASE_STEPS).exclude(['breach'])).optional(),
    })
    .strict(),
  WorkItemAssigned: z.object({ assigned_to: prn, lease_expires_at: instant }).strict(),
  WorkItemClaimRefused: z
    .object({
      principal: prn,
      check: z.enum(CLAIM_CHECKS),
      remediation_class: z.enum(REMEDIATION_CLASSES).optional(),
      onboarding_level: z.enum(ONBOARDING_LEVELS).optional(),
    })
    .strict(),
  WorkItemReleased: z.object({ released: prn, reason: z.enum(['released', 'lease_expired']) }).strict(),
  WorkItemStateChanged: z.object({ from: z.enum(STATES), to: z.enum(STATES) }).strict(),
  WorkItemEscalated: z.object({ to: prn }).strict(),
  WorkItemChased: z
    .object({
      step: z.enum(CHASE_STEPS).exclude(['breach']),
      index: z.number().int().nonnegative(),
      to: prn.optional(),
      delivery: z.enum(['delivered', 'failed', 'no_recipient']),
    })
    .strict(),
  WorkItemBreached: z.object({ clock: z.enum(CLOCKS), due: instant }).strict(),
  WorkItemLinked: z.object({ link: z.enum(['pull_request', 'artifact']), ref: id }).strict(),
  WorkItemEvidenceSatisfied: z
    .object({
      index: z.number().int().nonnegative(),
      kind: z.enum(EVIDENCE_KINDS),
      key: id,
      fact: id,
      occurred_at: instant,
    })
    .strict(),
  WorkItemSignalAttached: z
    .object({
      fingerprint: id,
      signal_kind: id,
      fingerprint_until: instant.optional(),
      adds_rescan_clear: z.boolean().optional(),
    })
    .strict(),
  WorkItemClosed: z.object({ outcome: z.enum(OUTCOMES) }).strict(),
};

export const RECORD_TYPES: TypeSchemas = new Map(
  Object.entries(bodies).map(([type, schema]) => [typeKey(type, 1), schema]),
);

export const RECORD_TYPE_NAMES = Object.keys(bodies) as ItemEventType[];
