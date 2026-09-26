/**
 * The shapes a caller may send, shared by the HTTP routes and the MCP tools so a rule that holds on
 * one surface holds on the other.
 */

import { z } from 'zod';
import { Refusal } from '../domain/decide.js';
import { factKeys, type Fact } from '../domain/evidence.js';
import { ITEM_ID } from '../domain/ids.js';
import { EVIDENCE_KINDS, ITEM_CLASSES, REMEDIATION_CLASSES, STATES } from '../domain/item.js';

/** Resolved by the service, never accepted from a caller. */
export const AUTHORITY_FIELDS = [
  'severity',
  'respond_by',
  'resolve_by',
  'review_by',
  'onboarding_level',
  'tier',
  'accountable',
  'oversight_level',
  'seat',
  'assigned_to',
  'outcome',
  'state',
] as const;

const token = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+=#-]{0,255}$/, 'must be a token, not prose');

export const publishSchema = z
  .object({
    class: z.enum(ITEM_CLASSES),
    title: z.string().trim().min(1).max(500),
    application: z.string().optional(),
    environment: z.string().optional(),
    subject_type: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .optional(),
    subject_id: token.optional(),
    parent: z.string().regex(ITEM_ID).optional(),
    milestone: z.string().regex(ITEM_ID).optional(),
    /** The open items this one waits on. */
    blocked_by: z.array(z.string().regex(ITEM_ID)).min(1).max(20).optional(),
    remediation_class: z.enum(REMEDIATION_CLASSES).optional(),
    reversible: z.boolean().optional(),
    severity_hint: token.optional(),
    evidence_plan: z.array(z.enum(EVIDENCE_KINDS)).optional(),
    raised_cause: token.optional(),
    /** The caller's key: a retry with the same key returns the same item. */
    key: z.string().min(1).max(128).optional(),
  })
  .strict();

export const resolveSchema = z
  .object({
    outcome: z.enum(['done', 'refused', 'escalated_out', 'superseded']),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export const transitionSchema = z.object({ state: z.enum(STATES) }).strict();

const tokenOf = (label: string) =>
  z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+=#-]{0,255}$/, `${label} must be a token, not prose`);
const at = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'must be ISO 8601 UTC');
const pullRequest = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*$/, 'a pull request is <owner>/<repo>#<number>');

export const linkSchema = z.union([
  z.object({ pull_request: pullRequest }).strict(),
  z.object({ artifact: tokenOf('an artifact') }).strict(),
]);

/** The facts an adapter reports, each the evidence entry it can satisfy (ADR-0019 §5). */
export const factSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('merged_change'),
      repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      pull_number: z.number().int().positive(),
      merged_at: at,
    })
    .strict(),
  z
    .object({
      kind: z.literal('deploy_event'),
      application: tokenOf('application'),
      environment: tokenOf('environment'),
      occurred_at: at,
      digest: tokenOf('digest').optional(),
    })
    .strict(),
  z.object({ kind: z.literal('decision_accepted'), artifact: tokenOf('artifact'), occurred_at: at }).strict(),
]);

export function factOf(input: z.infer<typeof factSchema>): Fact {
  switch (input.kind) {
    case 'merged_change':
      return {
        kind: 'merged_change',
        key: factKeys.merged_change(input.repository, input.pull_number),
        ref: `${input.repository}#${input.pull_number}`,
        occurred_at: input.merged_at,
      };
    case 'deploy_event':
      return {
        kind: 'deploy_event',
        key: factKeys.deploy_event(input.application, input.environment),
        ref: input.digest ?? `deploy:${input.application}:${input.environment}:${input.occurred_at}`,
        occurred_at: input.occurred_at,
      };
    case 'decision_accepted':
      return {
        kind: 'decision_accepted',
        key: factKeys.decision_accepted(input.artifact),
        ref: input.artifact,
        occurred_at: input.occurred_at,
      };
  }
}

export const frontierSchema = z
  .object({
    for: z.string().optional(),
    application: z.string().optional(),
    milestone: z.string().optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
  })
  .strict();

export const boardSchema = z
  .object({ application: z.string().optional(), milestone: z.string().optional() })
  .strict();

export function refuseAuthorityFields(body: unknown): void {
  if (!body || typeof body !== 'object') return;
  const named = AUTHORITY_FIELDS.filter((f) => f in body);
  if (named.length > 0) {
    throw new Refusal(
      `${named.map((f) => `\`${f}\``).join(', ')} ${named.length === 1 ? 'is' : 'are'} resolved by the service from policy and the application, never accepted from a caller.`,
    );
  }
}
