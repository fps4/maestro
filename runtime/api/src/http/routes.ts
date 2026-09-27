/**
 * The HTTP API. Every route under a workspace resolves the caller from the bearer token and builds
 * one request context — one handle — before anything else happens.
 *
 * What is not here is deliberate: no operation deploys, rolls back or restarts anything, and none
 * accepts a level or a tier from a pipeline (maestro docs/components/runtime-service.md,
 * "Interfaces"). This service records; it never acts on what it records.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { buildContext, requireRole, type RequestContext } from '../auth/context.js';
import { Unauthenticated, type TokenVerifier } from '../auth/verify.js';
import type { Config } from '../config.js';
import type { Store } from '../db/client.js';
import { ONBOARDING_LEVELS, TIERS } from '../domain/events.js';
import { fromEventBridge } from '../domain/intake.js';
import type { SbomStore } from '../record/sbom-store.js';
import { RuntimeService, scopeOf } from '../services/runtime.js';
import { WorkspaceRegistry } from '../services/workspaces.js';
import type { SignalSink } from '../signals/sink.js';
import { errorHandler } from './errors.js';

export interface RouteDeps {
  store: Store;
  verifier: TokenVerifier;
  config: Config;
  sboms: SbomStore;
  signals: SignalSink;
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
type AppParams = { Params: { ws: string; application: string } };

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<RuntimeService> {
  app.setErrorHandler(errorHandler);
  const now = deps.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const runtime = new RuntimeService({
    store: deps.store,
    sboms: deps.sboms,
    signals: deps.signals,
    workspaces: new WorkspaceRegistry(deps.store),
    now,
  });

  app.get('/health', async () => ({ status: 'ok' }));

  /** Who the service takes the caller to be here: the principal, its kind, its roles. */
  app.get<WsParams>('/v1/workspaces/:ws/me', async (request) => {
    const ctx = await contextFor(deps, request);
    return { workspace: ctx.workspace, ...ctx.caller };
  });

  /**
   * A build or a deploy, as the bus carries it: the EventBridge event, whole. The queue's function
   * takes in the same events; this is the route for a pipeline that calls, and for the tests.
   */
  app.post<WsParams>('/v1/workspaces/:ws/intake', async (request, reply) => {
    const ctx = await contextFor(deps, request);
    requireRole(ctx, 'intake');
    const result = await runtime.intake(scopeOf(ctx), fromEventBridge(request.body));
    return reply.code(result.outcome === 'recorded' && !result.replayed ? 201 : 202).send(result);
  });

  /** The estate: every instance, with its application's level and tier. */
  app.get<WsParams>('/v1/workspaces/:ws/instances', async (request) => {
    const ctx = await contextFor(deps, request);
    return { instances: await runtime.estate(ctx) };
  });

  /** One instance: its head, the artifact running, and its deploys newest first. */
  app.get<{ Params: { ws: string; application: string; environment: string } }>(
    '/v1/workspaces/:ws/instances/:application/:environment',
    async (request) => {
      const ctx = await contextFor(deps, request);
      return runtime.instance(ctx, request.params.application, request.params.environment);
    },
  );

  app.get<{ Params: { ws: string; application: string; digest: string } }>(
    '/v1/workspaces/:ws/artifacts/:application/:digest',
    async (request) => {
      const ctx = await contextFor(deps, request);
      return { artifact: await runtime.artifact(ctx, request.params.application, request.params.digest) };
    },
  );

  /** carries(dependency): every deployed instance whose SBOM names the package — a purl without its version. */
  app.get<WsParams>('/v1/workspaces/:ws/carries', async (request) => {
    const ctx = await contextFor(deps, request);
    const { dependency } = z
      .object({ dependency: z.string().regex(/^pkg:[a-z]+\/[^@?#]+$/, 'is a purl without its version') })
      .parse(request.query);
    return { dependency, instances: await runtime.carries(ctx, dependency) };
  });

  /** set_level: a person's act, recorded and projected by work-service. */
  app.post<AppParams>('/v1/workspaces/:ws/applications/:application/level', async (request) => {
    const ctx = await contextFor(deps, request);
    const { onboarding_level } = z
      .object({ onboarding_level: z.enum(ONBOARDING_LEVELS) })
      .strict()
      .parse(request.body);
    return { application: await runtime.setLevel(ctx, request.params.application, onboarding_level) };
  });

  /** set_tier: a person's act, recorded and projected by work-service. */
  app.post<AppParams>('/v1/workspaces/:ws/applications/:application/tier', async (request) => {
    const ctx = await contextFor(deps, request);
    const { tier } = z
      .object({ tier: z.enum(TIERS) })
      .strict()
      .parse(request.body);
    return { application: await runtime.setTier(ctx, request.params.application, tier) };
  });

  return runtime;
}
