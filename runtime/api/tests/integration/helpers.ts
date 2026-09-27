/**
 * The integration harness: a table of its own on DynamoDB Local per test file, made from
 * `table.ts` and dropped afterwards; the app in-process with `dev` auth, a filesystem archive and
 * SBOM store under a temporary directory, a signal sink that keeps what it was sent; and a workspace
 * registered with its members.
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildApp, type App } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { dynamoClientFor } from '../../src/db/client.js';
import type { Membership } from '../../src/db/handle.js';
import { createTable, deleteTable } from '../../src/db/table.js';
import { parseWorkspaceDefinition, type WorkspaceDefinition } from '../../src/domain/definition.js';
import { kindOf } from '../../src/domain/ids.js';
import { sbomKey } from '../../src/record/sbom-store.js';
import { WorkspaceRegistry } from '../../src/services/workspaces.js';
import { LogSignalSink } from '../../src/signals/sink.js';

export const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8050';

export interface Harness {
  app: App;
  config: Config;
  dir: string;
  signals: LogSignalSink;
  close(): Promise<void>;
}

export async function harness(
  name: string,
  now = '2026-09-27T08:00:00Z',
  env: Record<string, string> = {},
): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), `runtime-${name}-`));
  const table = `runtime-test-${name}-${Math.random().toString(36).slice(2, 8)}`;
  const config = loadConfig({
    TABLE_NAME: table,
    DYNAMODB_ENDPOINT,
    AWS_REGION: 'local',
    AUTH_MODE: 'dev',
    LOG_LEVEL: 'silent',
    RECORD_SINK: 'local',
    RECORD_ARCHIVE_DIR: join(dir, 'archive'),
    SBOM_DIR: join(dir, 'sboms'),
    RECORD_SINK_INTERVAL_MS: '3600000',
    // The tests' events carry their own times, not the clock's: no grace unless a test asks for one.
    BUILD_GRACE_SECONDS: '0',
    ...env,
  });
  const client = dynamoClientFor(config);
  await createTable(client, table);
  const signals = new LogSignalSink();
  const app = await buildApp(config, { now: () => now, signals });
  return {
    app,
    config,
    dir,
    signals,
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
  const now = '2026-09-27T07:00:00Z';
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

/** The demo tenant's definition, from the repository's own `config/`, under another workspace id if asked. */
export async function demoDefinition(workspace?: string): Promise<WorkspaceDefinition> {
  const { readFile } = await import('node:fs/promises');
  const { parse } = await import('yaml');
  const path = join(__dirname, '../../../config/workspaces/aannemer-x.yaml');
  const raw = parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  return parseWorkspaceDefinition(workspace ? { ...raw, workspace } : raw);
}

/** Register the demo workspace, apply its definition, and admit its members. */
export async function demoWorkspace(
  app: App,
  members: Array<Pick<Membership, 'principal' | 'roles' | 'accountable'>>,
  workspace?: string,
): Promise<WorkspaceDefinition> {
  const definition = await demoDefinition(workspace);
  await registerWorkspace(app, definition.workspace, members);
  await new WorkspaceRegistry(app.store).apply(definition, 'prn-h-operator', '2026-09-27T07:00:00Z');
  return definition;
}

/** A digest the way a pipeline makes one: `sha256:` and 64 hex characters. */
export const digestOf = (seed: string): string => `sha256:${createHash('sha256').update(seed).digest('hex')}`;

/** Upload a CycloneDX document to the harness's SBOM store, where a pipeline would; return its key. */
export async function uploadSbom(
  h: Harness,
  application: string,
  digest: string,
  components: Array<{ purl: string; version?: string }>,
): Promise<string> {
  const key = sbomKey(application, digest);
  const path = join(h.config.SBOM_DIR, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: components.map((c) => ({
        type: 'library',
        name: c.purl.split('/').pop()!.split('@')[0],
        ...(c.version ? { version: c.version } : {}),
        purl: c.purl,
      })),
    }),
  );
  return key;
}

let eventCounter = 0;

/** An EventBridge event as a rule delivers it. */
export function busEvent(source: 'maestro.build' | 'maestro.deploy', detail: object, id?: string) {
  eventCounter += 1;
  return {
    version: '0',
    id: id ?? `00000000-0000-4000-8000-${String(eventCounter).padStart(12, '0')}`,
    'detail-type': source === 'maestro.build' ? 'build' : 'deploy',
    source,
    time: `2026-09-27T08:${String(eventCounter % 60).padStart(2, '0')}:00Z`,
    region: 'eu-central-1',
    resources: [],
    detail,
  };
}
