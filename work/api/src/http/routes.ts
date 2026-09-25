/**
 * The HTTP API. Every route under a workspace resolves the caller from the bearer token and builds
 * one request context — one handle — before anything else happens.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildContext, type RequestContext } from '../auth/context.js';
import { Unauthenticated, type TokenVerifier } from '../auth/verify.js';
import type { Config } from '../config.js';
import type { Store } from '../db/client.js';
import type { PayloadStore } from '../record/payload-store.js';
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

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.setErrorHandler(errorHandler);

  app.get('/health', async () => ({ status: 'ok' }));

  /** Who the service takes the caller to be here: the principal, its kind, its roles. */
  app.get<{ Params: { ws: string } }>('/v1/workspaces/:ws/me', async (request) => {
    const ctx = await contextFor(deps, request);
    return { workspace: ctx.workspace, ...ctx.caller };
  });
}
