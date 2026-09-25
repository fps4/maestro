/**
 * The Fastify app factory — wiring only. Logging is Fastify's pino: JSON lines to stdout.
 */

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { createVerifier } from './auth/verify.js';
import type { Config } from './config.js';
import { Store } from './db/client.js';
import { registerRoutes } from './http/routes.js';
import type { PayloadStore } from './record/payload-store.js';
import { createRelay, payloadStoreFor, sinkFor, type Relay } from './relay/relay.js';

export interface App {
  server: FastifyInstance;
  store: Store;
  /** The relay the sink configured, or null under `RECORD_SINK=off`. */
  relay: Relay | null;
  payloads: PayloadStore;
  stop(): Promise<void>;
}

export interface AppOptions {
  /** The clock, for tests. ISO 8601 UTC. */
  now?: () => string;
}

export async function buildApp(config: Config, options: AppOptions = {}): Promise<App> {
  const server = Fastify({ logger: { level: config.LOG_LEVEL }, trustProxy: true });
  await server.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });

  const store = await Store.connect(config);
  const payloads = payloadStoreFor(config);
  const deps = {
    store,
    payloads,
    config,
    verifier: createVerifier(config),
    ...(options.now ? { now: options.now } : {}),
  };
  await registerRoutes(server, deps);

  const sink = sinkFor(config);
  const relay = sink ? createRelay(store, sink) : null;
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
 * Drain the outbox on an interval — the laptop's relay. On AWS the relay is a scheduled Lambda and
 * this process runs with `RECORD_SINK=off`. A failure leaves events pending; nothing is skipped.
 */
function startRelay(server: FastifyInstance, relay: Relay, config: Config): NodeJS.Timeout {
  return setInterval(() => {
    void (async () => {
      try {
        const report = await relay.once();
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
