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
import { buildContext, requireRole, type RequestContext } from '../auth/context.js';
import { Unauthenticated, type TokenVerifier } from '../auth/verify.js';
import type { Config } from '../config.js';
import type { Store } from '../db/client.js';
import type { PayloadStore } from '../record/payload-store.js';
import { signalSchema } from '../domain/intake.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fromGitHub } from '../domain/adapters.js';
import { AdapterService, intakeScope } from '../services/adapters.js';
import { IntakeService } from '../services/intake.js';
import { scopeOf, WorkItemService } from '../services/work-items.js';
import { WorkspaceRegistry } from '../services/workspaces.js';
import { registerMcp } from '../mcp/route.js';
import { errorHandler } from './errors.js';
import {
  boardSchema,
  factOf,
  factSchema,
  frontierSchema,
  linkSchema,
  publishSchema,
  refuseAuthorityFields,
  resolveSchema,
  transitionSchema,
} from './schemas.js';

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

type WsParams = { Params: { ws: string } };
type ItemParams = { Params: { ws: string; id: string } };

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.setErrorHandler(errorHandler);
  const now = deps.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const workspaces = new WorkspaceRegistry(deps.store);
  const items = new WorkItemService({ store: deps.store, payloads: deps.payloads, workspaces, now });
  const intake = new IntakeService(items);
  const adapters = new AdapterService(items);

  app.get('/health', async () => ({ status: 'ok' }));

  // Published only where an MCP resource URL is configured: it is a promise about a surface.
  if (deps.config.MCP_RESOURCE_URL) {
    app.get('/.well-known/oauth-protected-resource', async () => ({
      resource: deps.config.MCP_RESOURCE_URL,
      authorization_servers: [deps.config.AUTH_ISSUER],
      bearer_methods_supported: ['header'],
    }));
  }

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

  /** Link the pull request or artifact the evidence waits on. */
  app.post<ItemParams>('/v1/workspaces/:ws/items/:id/link', async (request) => {
    const ctx = await contextFor(deps, request);
    const body = linkSchema.parse(request.body);
    const [kind, ref] =
      'pull_request' in body
        ? (['pull_request', body.pull_request] as const)
        : (['artifact', body.artifact] as const);
    return { item: await items.link(ctx, request.params.id, kind, ref) };
  });

  /** A signal, in the envelope every adapter produces. The adapters' seat: `intake`. */
  app.post<WsParams>('/v1/workspaces/:ws/signals', async (request, reply) => {
    const ctx = await contextFor(deps, request);
    requireRole(ctx, 'intake');
    const result = await intake.signal(scopeOf(ctx), signalSchema.parse(request.body));
    return reply.code(result.outcome === 'raised' && !result.replayed ? 201 : 200).send(result);
  });

  /** A fact from the world — a merge, a deploy, an accepted decision — applied to what waits on it. */
  app.post<WsParams>('/v1/workspaces/:ws/facts', async (request) => {
    const ctx = await contextFor(deps, request);
    requireRole(ctx, 'intake');
    return intake.fact(scopeOf(ctx), factOf(factSchema.parse(request.body)));
  });

  // The GitHub webhook: served only where a secret is configured. GitHub proves itself with an
  // HMAC over the exact bytes it sent, so this route keeps the raw body; everything it records is the
  // intake workload's act.
  const secret = deps.config.GITHUB_WEBHOOK_SECRET;
  const intakePrincipal = deps.config.INTAKE_PRINCIPAL;
  if (secret && intakePrincipal) {
    await app.register(async (hook) => {
      hook.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
        done(null, body),
      );
      hook.post<WsParams>('/v1/workspaces/:ws/adapters/github', async (request, reply) => {
        const raw = typeof request.body === 'string' ? request.body : '';
        if (!verifyGitHub(secret, raw, request.headers['x-hub-signature-256'])) {
          return reply.code(401).send({
            error: 'Unauthenticated',
            message: 'The signature does not match this webhook’s secret.',
          });
        }
        const event = String(request.headers['x-github-event'] ?? '');
        const delivery = String(request.headers['x-github-delivery'] ?? '');
        if (!/^[A-Za-z0-9-]{1,64}$/.test(delivery)) {
          return reply
            .code(400)
            .send({ error: 'invalid', message: 'X-GitHub-Delivery is missing or malformed.' });
        }
        const scope = await intakeScope(deps.store, request.params.ws, intakePrincipal);
        const definition = await workspaces.current(request.params.ws);
        const result = await adapters.apply(scope, fromGitHub(definition, event, delivery, JSON.parse(raw)));
        return reply.code(202).send(result);
      });
    });
  }

  /** blocking: the open items it waits on, and the open items waiting on it. */
  app.get<ItemParams>('/v1/workspaces/:ws/items/:id/blocking', async (request) => {
    const ctx = await contextFor(deps, request);
    return items.blocking(ctx, request.params.id);
  });

  /** The holder renews its lease. */
  app.post<ItemParams>('/v1/workspaces/:ws/items/:id/heartbeat', async (request) => {
    const ctx = await contextFor(deps, request);
    const item = await items.heartbeat(ctx, request.params.id);
    return { item, lease_expires_at: item.lease_expires_at };
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

  /** board: the frontier by state, and what closed today — filtered by application and milestone. */
  app.get<WsParams>('/v1/workspaces/:ws/board', async (request) => {
    const ctx = await contextFor(deps, request);
    return items.board(ctx, boardSchema.parse(request.query));
  });

  /** Today, for the caller: what they owe and the agents' work they answer for. */
  app.get<WsParams>('/v1/workspaces/:ws/today', async (request) => {
    const ctx = await contextFor(deps, request);
    return items.today(ctx);
  });

  await registerMcp(app, deps, items);

  /** rates: closures by outcome and refusals by check, for one application — one query. */
  app.get<WsParams>('/v1/workspaces/:ws/rates', async (request) => {
    const ctx = await contextFor(deps, request);
    const { application } = z.object({ application: z.string().min(1) }).parse(request.query);
    return items.rates(ctx, application);
  });
}

/** GitHub's `X-Hub-Signature-256`: `sha256=` and the HMAC of the body, compared in constant time. */
export function verifyGitHub(secret: string, raw: string, header: unknown): boolean {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
