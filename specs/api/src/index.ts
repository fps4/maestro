/**
 * Process entrypoint.
 *
 * Configuration is validated before anything connects, so a misconfiguration is a message at boot
 * rather than a confusing failure under load.
 */

import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp(config);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      app.server.log.info({ msg: 'shutting down', signal });
      await app.stop();
      process.exit(0);
    })();
  });
}

await app.server.listen({ port: config.PORT, host: config.HOST });
