/**
 * The integration harness: a table of its own on DynamoDB Local per test file, made from
 * `table.ts` and dropped afterwards; the app in-process with `dev` auth, a filesystem archive and
 * payload store under a temporary directory; and a workspace registered with its members.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, type App } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { dynamoClientFor } from '../../src/db/client.js';
import type { Membership } from '../../src/db/handle.js';
import { createTable, deleteTable } from '../../src/db/table.js';
import { kindOf } from '../../src/domain/ids.js';

export const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8040';

export interface Harness {
  app: App;
  config: Config;
  dir: string;
  /** Move the clock the app reads. ISO 8601 UTC. */
  setNow(iso: string): void;
  close(): Promise<void>;
}

export async function harness(name: string, now = '2026-09-25T08:00:00Z'): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), `work-${name}-`));
  const table = `work-test-${name}-${Math.random().toString(36).slice(2, 8)}`;
  const config = loadConfig({
    TABLE_NAME: table,
    DYNAMODB_ENDPOINT,
    AWS_REGION: 'local',
    AUTH_MODE: 'dev',
    LOG_LEVEL: 'silent',
    RECORD_SINK: 'local',
    RECORD_ARCHIVE_DIR: join(dir, 'archive'),
    RECORD_PAYLOAD_DIR: join(dir, 'payloads'),
    RECORD_SINK_INTERVAL_MS: '3600000',
  });
  const client = dynamoClientFor(config);
  await createTable(client, table);
  let clock = now;
  const app = await buildApp(config, { now: () => clock });
  return {
    app,
    config,
    dir,
    setNow(iso: string) {
      clock = iso;
    },
    async close() {
      await app.stop();
      await deleteTable(client, table);
      client.destroy();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Register a workspace and admit its members, as the operator's commands would. */
export async function registerWorkspace(
  app: App,
  workspace: string,
  members: Array<Pick<Membership, 'principal' | 'roles' | 'accountable'>>,
): Promise<void> {
  const now = '2026-09-25T07:00:00Z';
  await app.store.control.workspaces.upsert({ id: workspace, definition_version: 0 }, now);
  const handle = await app.store.handle(workspace);
  for (const m of members) {
    await handle.memberships.put({ ...m, granted_at: now, granted_by: 'prn-h-operator' });
    await app.store.control.principals.seen(m.principal, kindOf(m.principal), now);
  }
}

export const bearer = (principal: string, roles: string[] = []) => ({
  authorization: `Bearer dev:${principal}${roles.length ? `:${roles.join(',')}` : ''}`,
});
