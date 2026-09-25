/**
 * The API boots with a deployment's configuration. On AWS it runs with `SWEEP_MODE=off` and no
 * `SWEEP_PRINCIPAL` — only the sweep function is given one — and it must start regardless: the
 * first deployment of the clocks failed at exactly this (every API cold start refused, 500 on
 * /health). A process that does sweep, on the other hand, must refuse to start without a principal.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { dynamoClientFor } from '../../src/db/client.js';
import { createTable, deleteTable } from '../../src/db/table.js';
import { DYNAMODB_ENDPOINT } from './helpers.js';

const table = `work-test-prod-${Math.random().toString(36).slice(2, 8)}`;
const production = {
  TABLE_NAME: table,
  DYNAMODB_ENDPOINT,
  AWS_REGION: 'local',
  NODE_ENV: 'production',
  AUTH_MODE: 'jwks',
  AUTH_JWKS_URL: 'https://issuer.example/.well-known/jwks.json',
  AUTH_ISSUER: 'https://issuer.example',
  AUTH_AUDIENCE: 'maestro',
  RECORD_SINK: 'off',
  PAYLOAD_STORE: 'local',
  RECORD_PAYLOAD_DIR: '/tmp/work-prod-boot',
  LOG_LEVEL: 'silent',
};

describe('booting as a deployment', () => {
  const client = dynamoClientFor({ TABLE_NAME: table, DYNAMODB_ENDPOINT, AWS_REGION: 'local' });
  afterAll(async () => {
    await deleteTable(client, table);
    client.destroy();
  });

  it('starts the API with the sweep off and no sweep principal, and refuses only a sweep', async () => {
    await createTable(client, table);
    const app = await buildApp(loadConfig({ ...production, SWEEP_MODE: 'off' }));
    try {
      const res = await app.server.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      await expect(app.sweep.once()).rejects.toThrow(/SWEEP_PRINCIPAL names the workload/);
    } finally {
      await app.stop();
    }
  });

  it('refuses to start a process that sweeps without knowing whom it sweeps as', async () => {
    await expect(buildApp(loadConfig({ ...production, SWEEP_MODE: 'in_process' }))).rejects.toThrow(
      /SWEEP_PRINCIPAL/,
    );
  });
});
