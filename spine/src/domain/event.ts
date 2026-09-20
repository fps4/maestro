/**
 * The event: the one thing the spine records.
 *
 * An attributed fact a component emitted — who acted, under whose accountability, at what oversight
 * level, about what. The body is structural; anything that could carry a name or a sentence is a
 * payload reference with a digest, so the archive can be immutable and erasure still honoured
 * (docs/components/spine.md, "The event").
 *
 * The six rules below are enforced at append, not documented. A component that writes its outbox
 * through `validateEvent` never produces an event the relay will refuse; a relay that re-checks them
 * never archives one a component forgot to.
 */

import { z } from 'zod';
import { DIGEST } from './digest.js';
import { PRINCIPAL_ID, UUID_V7, WORKSPACE_ID, type PrincipalKind } from './ids.js';

export const OVERSIGHT_LEVELS = ['O0', 'O1', 'O2', 'O3', 'O4'] as const;
export type OversightLevel = (typeof OVERSIGHT_LEVELS)[number];

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/; // subject_type, seat: snake_case tokens
const TYPE_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/; // WorkItemClosed, GateDecisionRecorded, …
const SUBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+=-]{0,255}$/;
const CONSEQUENCE_CLASS = /^c[0-9]$/;
// Where a payload lives: an S3 object on AWS, a file under a payload root on the laptop — the same
// split as the archive's own S3 and filesystem stores. A locator, never the content.
const PAYLOAD_REF = /^(s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/.+|file:\/\/\/.+)$/;

/**
 * The floor every body obeys, whatever its type: a leaf is a number, a boolean, null, or a token —
 * an identifier, an enum value, a digest, a timestamp, a reference. Nothing with a space in it, so
 * nothing that reads as prose. A type's own schema narrows this; it never widens it.
 */
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@/+=#-]{0,255}$/;
const BODY_MAX_DEPTH = 4;

const attributionShape = {
  accountable: z.string().regex(PRINCIPAL_ID, 'must be a maestro principal id (prn-h-…)'),
  acting: z.string().regex(PRINCIPAL_ID, 'must be a maestro principal id (prn-h-…, prn-a-…, prn-w-…)'),
  seat: z.string().regex(IDENTIFIER),
  oversight_level: z.enum(OVERSIGHT_LEVELS),
};

export const eventSchema = z
  .object({
    event_id: z.string().regex(UUID_V7, 'must be a UUID version 7'),
    workspace_id: z.string().regex(WORKSPACE_ID),
    seq: z.number().int().positive(),
    subject_type: z.string().regex(IDENTIFIER),
    subject_id: z.string().regex(SUBJECT_ID),
    subject_seq: z.number().int().nonnegative(),

    type: z.string().regex(TYPE_NAME),
    type_version: z.number().int().positive(),
    occurred_at: z.string().regex(ISO_INSTANT, 'must be an ISO 8601 instant in UTC'),
    recorded_at: z.string().regex(ISO_INSTANT, 'must be an ISO 8601 instant in UTC'),

    ...attributionShape,

    consequence_class: z.string().regex(CONSEQUENCE_CLASS),
    causation_id: z.string().regex(UUID_V7).nullable(),
    correlation_id: z.string().regex(UUID_V7),

    body: z.record(z.unknown()),
    payload_ref: z.string().regex(PAYLOAD_REF).optional(),
    payload_digest: z.string().regex(DIGEST).optional(),
  })
  .strict()
  .refine((e) => (e.payload_ref === undefined) === (e.payload_digest === undefined), {
    message: 'payload_ref and payload_digest come together or not at all',
    path: ['payload_digest'],
  });

export type SpineEvent = z.infer<typeof eventSchema>;

/** What a component supplies; `event_id` and `recorded_at` are minted at emit if absent. */
export type EmittableEvent = Omit<SpineEvent, 'event_id' | 'recorded_at'> &
  Partial<Pick<SpineEvent, 'event_id' | 'recorded_at'>>;

export interface AppendIssue {
  field: string;
  message: string;
}

export class AppendRefused extends Error {
  constructor(
    readonly issues: AppendIssue[],
    readonly seq?: number,
  ) {
    super(
      `This event cannot be recorded${seq === undefined ? '' : ` (seq ${seq})`}:\n${issues
        .map((i) => `  ${i.field}: ${i.message}`)
        .join('\n')}`,
    );
    this.name = 'AppendRefused';
  }
}

/**
 * Who is who, from the registry every component embeds (docs/components/identity-service.md).
 * Returns nothing for an id the registry does not know.
 */
export type PrincipalResolver = (id: string) => { kind: PrincipalKind } | undefined;

/**
 * A per-type body schema, declared by the component that owns the type. Keyed `Type@version`.
 * The floor applies whether or not a type has one.
 */
export type TypeSchemas = ReadonlyMap<string, z.ZodTypeAny>;

export function typeKey(type: string, version: number): string {
  return `${type}@${version}`;
}

/**
 * The append rules. Returns every issue rather than the first, because a component author fixing
 * an emit wants the whole list once.
 */
export function checkEvent(
  candidate: unknown,
  resolve: PrincipalResolver,
  types: TypeSchemas = new Map(),
): AppendIssue[] {
  const parsed = eventSchema.safeParse(candidate);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({ field: i.path.join('.') || '(event)', message: i.message }));
  }
  const event = parsed.data;
  const issues: AppendIssue[] = [];

  // Rule 1: `accountable` resolves to a human principal in the registry. Rule 5 (a principal
  // reference is a maestro id, never an identity provider's subject) is the regex above.
  const accountable = resolve(event.accountable);
  if (!accountable) {
    issues.push({
      field: 'accountable',
      message: `must resolve to a known principal; \`${event.accountable}\` does not`,
    });
  } else if (accountable.kind !== 'human') {
    issues.push({
      field: 'accountable',
      message: `must be a human. \`${event.accountable}\` is ${article(accountable.kind)} ${accountable.kind}, and an agent can never be answerable`,
    });
  }
  const acting = resolve(event.acting);
  if (!acting) {
    issues.push({
      field: 'acting',
      message: `must resolve to a known principal; \`${event.acting}\` does not`,
    });
  }

  // Rule 4: the body is structural. The floor first, then the type's own schema if it declared one.
  issues.push(...checkBodyFloor(event.body, 'body', 0));
  const schema = types.get(typeKey(event.type, event.type_version));
  if (schema) {
    const result = schema.safeParse(event.body);
    if (!result.success) {
      issues.push(
        ...result.error.issues.map((i) => ({ field: ['body', ...i.path].join('.'), message: i.message })),
      );
    }
  }

  return issues;
}

export function assertEvent(candidate: unknown, resolve: PrincipalResolver, types?: TypeSchemas): SpineEvent {
  const issues = checkEvent(candidate, resolve, types);
  const seq = (candidate as { seq?: unknown } | null)?.seq;
  if (issues.length > 0) throw new AppendRefused(issues, typeof seq === 'number' ? seq : undefined);
  return candidate as SpineEvent;
}

function checkBodyFloor(value: unknown, path: string, depth: number): AppendIssue[] {
  if (depth > BODY_MAX_DEPTH) return [{ field: path, message: `nests deeper than ${BODY_MAX_DEPTH} levels` }];
  if (value === null || typeof value === 'boolean') return [];
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [] : [{ field: path, message: 'must be a finite number' }];
  }
  if (typeof value === 'string') {
    return TOKEN.test(value)
      ? []
      : [
          {
            field: path,
            message: 'must be a token — an identifier, a digest, a timestamp, a reference; never free text',
          },
        ];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => checkBodyFloor(v, `${path}[${i}]`, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      IDENTIFIER.test(k)
        ? checkBodyFloor(v, `${path}.${k}`, depth + 1)
        : [{ field: `${path}.${k}`, message: 'keys are snake_case identifiers' }],
    );
  }
  return [{ field: path, message: `${typeof value} is not a body value` }];
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}
