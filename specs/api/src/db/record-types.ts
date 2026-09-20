/**
 * The types this service emits, each with the schema that narrows its body below the spine's
 * floor (tokens only — ids, digests, enums, ordinals; never a sentence). The spine's relay checks
 * the floor again; these are what make "this service's events" a declared set rather than
 * whatever the code happened to write (ADR-0019 §4).
 */

import { z } from 'zod';
import { typeKey, type TypeSchemas } from '@fps4/maestro-spine';

const id = z.string().min(1);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const ordinal = z.number().int().positive();

const bodies: Record<string, z.ZodTypeAny> = {
  VersionProposed: z
    .object({
      type: id,
      digest,
      definition_version: z.number().int().positive(),
      contributors: z.array(id),
    })
    .strict(),
  VersionWithdrawn: z.object({ reason_digest: digest.optional() }).strict(),
  VersionSuperseded: z.object({ by_ordinal: ordinal }).strict(),
  DecisionRecorded: z
    .object({
      decision: id,
      gate: id,
      outcome: id,
      state: id,
      subject_digest: digest,
      attribution: z.record(id),
      materiality: z.enum(['material', 'immaterial']).optional(),
      phase: id.optional(),
      reopened_draft: id.optional(),
    })
    .strict(),
  DecisionRefused: z
    .object({
      gate: id,
      outcome: id,
      refused_for: z.array(z.enum(['may_not_decide', 'gate_closed', 'attribution'])).min(1),
      unmet: z.array(id),
      attribution_fields: z.array(id),
    })
    .strict(),
  LinkPinned: z
    .object({ links: z.array(z.object({ type: id, target: id, pinned_to: ordinal }).strict()) })
    .strict(),
  QuestionRaised: z
    .object({ question: id, text_digest: digest, asked_kind: z.enum(['human', 'agent', 'service']) })
    .strict(),
  QuestionAnswered: z
    .object({ question: id, answer: id, text_digest: digest, kind: z.enum(['human', 'agent', 'service']) })
    .strict(),
  QuestionResolved: z.object({ question: id, answers: z.number().int().nonnegative() }).strict(),
};

export const RECORD_TYPES: TypeSchemas = new Map(
  Object.entries(bodies).map(([type, schema]) => [typeKey(type, 1), schema]),
);

export const RECORD_TYPE_NAMES = Object.keys(bodies);
