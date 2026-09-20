/**
 * The Fastify app factory — wiring only.
 *
 * Logging is Fastify's built-in pino: JSON lines to stdout, so a container platform can collect it
 * and nobody has to configure a second logger.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Config } from './config.js';
import { Store } from './db/client.js';
import { createRelay, payloadStoreFor, sinkFor, type Relay } from './relay/relay.js';
import type { PayloadStore } from './record/payload-store.js';
import { createVerifier } from './auth/verify.js';
import { registerRoutes } from './http/routes.js';
import { registerMcp } from './mcp/route.js';
import { PrincipalDirectory } from './services/principals.js';
import { WorkspaceRegistry } from './services/workspaces.js';
import { signedUrlFactory } from './services/attachments.js';

export interface App {
  server: FastifyInstance;
  store: Store;
  /** The relay the sink configured, or null under `RECORD_SINK=off`. */
  relay: Relay | null;
  /** Where every free-text write goes before its event (ADR-0020). */
  payloads: PayloadStore;
  stop(): Promise<void>;
}

export async function buildApp(config: Config): Promise<App> {
  const server = Fastify({
    logger: { level: config.LOG_LEVEL },
    // Always behind a proxy (API Gateway, or a reverse proxy locally), so the client address comes
    // from the forwarded header rather than from the proxy's own socket.
    trustProxy: true,
    bodyLimit: config.BODY_CEILING_BYTES + 512 * 1024,
  });

  await server.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });

  const store = await Store.connect(config);
  const registry = new WorkspaceRegistry(store);
  const directory = new PrincipalDirectory(store);
  const verifier = createVerifier(config);
  const signUrls = signedUrlFactory(config);
  const payloads = payloadStoreFor(config);

  const deps = {
    store,
    registry,
    directory,
    payloads,
    verifier,
    config,
    ...(signUrls ? { signUrls } : {}),
  };

  await registerRoutes(server, deps);
  await registerMcp(server, deps);

  const sink = sinkFor(config);
  const relay = sink ? createRelay(store, directory, sink) : null;
  const timer = relay ? startRelay(server, relay, config) : null;

  return {
    server,
    store,
    relay,
    payloads,
    async stop() {
      if (timer) clearInterval(timer);
      await server.close();
      await store.close();
    },
  };
}

/**
 * Drain the outbox on an interval — the laptop's relay. On AWS the same relay runs as a scheduled
 * Lambda (`relay/lambda.ts`) and this process runs with `RECORD_SINK=off`.
 *
 * Failures are logged and the events stay pending — the relay never skips one to make progress,
 * which is what makes "stop the sink, keep writing, and every record arrives in order on recovery"
 * true rather than nearly true. A refused event stops its workspace and is named in the report.
 */
function startRelay(server: FastifyInstance, relay: Relay, config: Config): NodeJS.Timeout {
  return setInterval(() => {
    void (async () => {
      try {
        const report = await relay.once();
        if (report.archived > 0) server.log.debug({ msg: 'record sink', ...report });
        if (report.refused.length > 0)
          server.log.error({
            msg: 'record sink refused an event; its workspace is stopped',
            refused: report.refused,
          });
      } catch (error) {
        server.log.error({
          msg: 'record sink relay failed; events stay pending',
          err: (error as Error).message,
        });
      }
    })();
  }, config.RECORD_SINK_INTERVAL_MS).unref();
}
