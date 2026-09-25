/**
 * The HTTP API. Every route under a workspace resolves the caller from the bearer token and builds
 * one request context — one handle — before anything else happens.
 *
 * What is not here is deliberate: there is no operation that accepts anything, and none that sets
 * an authority field (maestro docs/components/work-service.md, "Interfaces"). A publish that names
 * one is refused with the field's name rather than silently dropped.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { buildContext, type RequestContext } from '../auth/context.js';
import { Unauthenticated, type TokenVerifier } from '../auth/verify.js';
import type { Config } from '../config.js';
import type { Store } from '../db/client.js';
import { Refusal } from '../domain/decide.js';
import { ITEM_ID } from '../domain/ids.js';
import { EVIDENCE_KINDS, ITEM_CLASSES, REMEDIATION_CLASSES, STATES } from '../domain/item.js';
import type { PayloadStore } from '../record/payload-store.js';
import { WorkItemService } from '../services/work-items.js';
import { WorkspaceRegistry } from '../services/workspaces.js';
import { errorHandler } from './errors.js';

export interface RouteDeps {
  store: Store;
  verifier: TokenVerifier;
  config: Config;
  payloads: PayloadStore;
  now?: () => string;
}

export async function contextFor(
  deps: RouteDeps,
  request: FastifyRequest<{ Params: { ws: string } }>,
): Promise<RequestContext> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new Unauthenticated('This endpoint needs a bearer token.');
  const token = await deps.verifier.verify(header.slice('Bearer '.length));
  return buildContext(deps, token, request.params.ws);
}

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
    remediation_class: z.enum(REMEDIATION_CLASSES).optional(),
    reversible: z.boolean().optional(),
    severity_hint: token.optional(),
    evidence_plan: z.array(z.enum(EVIDENCE_KINDS)).optional(),
    raised_cause: token.optional(),
    /** The caller's key: a retry with the same key returns the same item. */
    key: z.string().min(1).max(128).optional(),
  })
  .strict();

const resolveSchema = z
  .object({
    outcome: z.enum(['done', 'refused', 'escalated_out', 'superseded']),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

const transitionSchema = z.object({ state: z.enum(STATES) }).strict();

const frontierSchema = z
  .object({
    for: z.string().optional(),
    application: z.string().optional(),
    milestone: z.string().optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
  })
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

type WsParams = { Params: { ws: string } };
type ItemParams = { Params: { ws: string; id: string } };

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.setErrorHandler(errorHandler);
  const now = deps.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const workspaces = new WorkspaceRegistry(deps.store);
  const items = new WorkItemService({ store: deps.store, payloads: deps.payloads, workspaces, now });

  app.get('/health', async () => ({ status: 'ok' }));

  /** Who the service takes the caller to be here: the principal, its kind, its roles. */
  app.get<WsParams>('/v1/workspaces/:ws/me', async (request) => {
    const ctx = await contextFor(deps, request);
    return { workspace: ctx.workspace, ...ctx.caller };
  });

  /** publish: raise an item. The authority fields come back resolved. */
  app.post<WsParams>('/v1/workspaces/:ws/items', async (request, reply) => {
    const ctx = await contextFor(deps, request);
    refuseAuthorityFields(request.body);
    const { key, ...input } = publishSchema.parse(request.body);
    const raised = await items.raise(ctx, input, key);
    return reply.code(raised.replayed ? 200 : 201).send(raised);
  });

  /** fetch */
  app.get<ItemParams>('/v1/workspaces/:ws/items/:id', async (request) => {
    const ctx = await contextFor(deps, request);
    return items.get(ctx, request.params.id);
  });

  /** claim: `claimed`, or `refused` with the check and the sentence — a refusal is an answer. */
  app.post<ItemParams>('/v1/workspaces/:ws/items/:id/claim', async (request) => {
    const ctx = await contextFor(deps, request);
    const { item, result } = await items.claim(ctx, request.params.id);
    return result.claimed
      ? { result: 'claimed', item, lease_expires_at: item.lease_expires_at }
      : { result: 'refused', check: result.check, sentence: result.sentence, item };
  });

  app.post<ItemParams>('/v1/workspaces/:ws/items/:id/release', async (request) => {
    const ctx = await contextFor(deps, request);
    return { item: await items.release(ctx, request.params.id) };
  });

  app.post<ItemParams>('/v1/workspaces/:ws/items/:id/transition', async (request) => {
    const ctx = await contextFor(deps, request);
    const { state } = transitionSchema.parse(request.body);
    return { item: await items.transition(ctx, request.params.id, state) };
  });

  /** resolve: `done` from the holder, or a closure with a reason. */
  app.post<ItemParams>('/v1/workspaces/:ws/items/:id/resolve', async (request) => {
    const ctx = await contextFor(deps, request);
    const { outcome, reason } = resolveSchema.parse(request.body);
    return { item: await items.resolve(ctx, request.params.id, outcome, reason) };
  });

  /** frontier: what is owed now, soonest first. */
  app.get<WsParams>('/v1/workspaces/:ws/frontier', async (request) => {
    const ctx = await contextFor(deps, request);
    return { rows: await items.frontier(ctx, frontierSchema.parse(request.query)) };
  });

  /** rates: closures by outcome and refusals by check, for one application — one query. */
  app.get<WsParams>('/v1/workspaces/:ws/rates', async (request) => {
    const ctx = await contextFor(deps, request);
    const { application } = z.object({ application: z.string().min(1) }).parse(request.query);
    return items.rates(ctx, application);
  });
}
