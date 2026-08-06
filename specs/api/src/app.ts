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
import { loggingSink, httpSink, relayOnce, type SinkTarget } from './db/outbox.js';
import { createVerifier } from './auth/verify.js';
import { registerRoutes } from './http/routes.js';
import { registerMcp } from './mcp/route.js';
import { PrincipalDirectory } from './services/principals.js';
import { WorkspaceRegistry } from './services/workspaces.js';
import { signedUrlFactory } from './services/attachments.js';

export interface App {
  server: FastifyInstance;
  store: Store;
  stop(): Promise<void>;
}

export async function buildApp(config: Config): Promise<App> {
  const server = Fastify({
    logger: { level: config.LOG_LEVEL },
    // Behind the shared reverse proxy on ds1, so the client address comes from the forwarded header
    // rather than from the proxy's own socket.
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

  const deps = { store, registry, directory, verifier, config, ...(signUrls ? { signUrls } : {}) };

  await registerRoutes(server, deps);
  await registerMcp(server, deps);

  const relay = startRelay(server, store, config);

  return {
    server,
    store,
    async stop() {
      clearInterval(relay);
      await server.close();
      await store.close();
    },
  };
}

/**
 * Drain the outbox on an interval.
 *
 * Failures are logged and the events stay pending — the relay never skips one to make progress,
 * which is what makes "stop the sink, keep writing, and every record arrives in order on recovery"
 * true rather than nearly true.
 */
function startRelay(server: FastifyInstance, store: Store, config: Config): NodeJS.Timeout {
  const target: SinkTarget =
    config.RECORD_SINK === 'http'
      ? httpSink(config.RECORD_SINK_URL!)
      : loggingSink((line) => server.log.info(line));

  return setInterval(() => {
    void (async () => {
      try {
        for (const workspace of await store
          .control()
          .collection<{ id: string }>('workspaces')
          .find()
          .toArray()) {
          const handle = await store.handle(workspace.id);
          const delivered = await relayOnce(handle.db, target);
          if (delivered > 0) server.log.debug({ msg: 'record sink', workspace: workspace.id, delivered });
        }
      } catch (error) {
        server.log.error({
          msg: 'record sink relay failed; events stay pending',
          err: (error as Error).message,
        });
      }
    })();
  }, config.RECORD_SINK_INTERVAL_MS).unref();
}
