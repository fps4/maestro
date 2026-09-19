/**
 * Integration harness.
 *
 * These tests drive the real service against a real MongoDB replica set, because the meaningful
 * behaviour of this system is integration-shaped: a transaction that half-applies, a pin that
 * resolves against stored state, an index that stops a query crossing a boundary. None of that is
 * observable from a unit test.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { FastifyInstance } from 'fastify';
import { buildApp, type App } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { parseWorkspaceDefinition } from '../../src/domain/workspace-definition.js';
import { WorkspaceRegistry } from '../../src/services/workspaces.js';
import { MEMBERSHIPS } from '../../src/db/collections.js';

const here = dirname(fileURLToPath(import.meta.url));
/** The shipped definitions — the catalogue is applied from here. */
export const CONFIG_DIR = resolve(here, '../../../config/workspaces');
/**
 * The tenant the tests run against is a fixture, not the demo tenant the service ships: the tests
 * need a chain that exercises every mechanism, and the demo needs to read as a product. Keeping
 * them apart means a product change never silently rewrites what the suite proves.
 */
export const FIXTURE_DIR = resolve(here, '../fixtures');

export const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27019/?directConnection=true';

/**
 * A distinct control database per test file, so files cannot see each other's workspaces.
 *
 * Mongo credentials are read from the environment rather than hard-coded, because CI runs against
 * an authenticated instance and a developer usually does not. Omitting them here would mean the
 * suite passes locally and fails in CI with "requires authentication" — a difference between the
 * two environments that has nothing to do with the code under test.
 */
export function testConfig(suffix: string): Config {
  return loadConfig({
    SPECS_ENV: 'ci',
    NODE_ENV: 'test',
    MONGO_URI,
    ...(process.env.MONGO_USER ? { MONGO_USER: process.env.MONGO_USER } : {}),
    ...(process.env.MONGO_PASSWORD ? { MONGO_PASSWORD: process.env.MONGO_PASSWORD } : {}),
    ...(process.env.MONGO_AUTH_SOURCE ? { MONGO_AUTH_SOURCE: process.env.MONGO_AUTH_SOURCE } : {}),
    MONGO_CONTROL_DB: `test_control_${suffix}`,
    MONGO_DB_PREFIX: `test_${suffix}`,
    AUTH_MODE: 'dev',
    CATALOGUE_WORKSPACE: `cat-${suffix}`,
    RECORD_SINK: 'local',
    LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);
}

/** `dev:<name>:<kind>:<roles>` — the development verifier's token shape. */
export function token(name: string, kind = 'human', roles = 'author,reviewer'): string {
  return `dev:${name}:${kind}:${roles}`;
}

export interface Harness {
  app: App;
  server: FastifyInstance;
  config: Config;
  tenant: string;
  catalogue: string;
  stop(): Promise<void>;
}

export async function startHarness(suffix: string): Promise<Harness> {
  const config = testConfig(suffix);
  const tenant = `ten-${suffix}`;
  const catalogue = `cat-${suffix}`;

  const app = await buildApp(config);
  const registry = new WorkspaceRegistry(app.store);

  await applyDefinition(registry, resolve(CONFIG_DIR, 'catalogue.yaml'), { workspace: catalogue });
  await applyDefinition(registry, resolve(FIXTURE_DIR, 'tenant.yaml'), { workspace: tenant });

  return {
    app,
    server: app.server,
    config,
    tenant,
    catalogue,
    async stop() {
      // Drop what this file created, so a rerun starts from nothing rather than from whatever the
      // last failing run left behind.
      for (const name of [
        config.MONGO_CONTROL_DB,
        `${config.MONGO_DB_PREFIX}_${tenant}`,
        `${config.MONGO_DB_PREFIX}_${catalogue}`,
      ]) {
        await app.store.client.db(name).dropDatabase();
      }
      await app.stop();
    },
  };
}

export async function applyDefinition(
  registry: WorkspaceRegistry,
  path: string,
  overrides: { workspace: string },
): Promise<void> {
  const raw = parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  const definition = parseWorkspaceDefinition({ ...raw, workspace: overrides.workspace });

  // Facet schemas resolve relative to the definition that names them, as the apply CLI does.
  const facetSchemas: Record<string, object> = {};
  for (const type of definition.types) {
    facetSchemas[type.id] = JSON.parse(
      await readFile(resolve(dirname(path), type.facet_schema), 'utf8'),
    ) as object;
  }
  await registry.apply({ definition, facet_schemas: facetSchemas, applied_by: 'test' });
}

/** Membership is granted in the workspace, not by the token — so tests must grant it too. */
export async function grantMembership(
  harness: Harness,
  workspace: string,
  principalDisplayName: string,
  roles: string[],
): Promise<string> {
  // Resolving through the directory is what mints the local principal id, exactly as a first
  // request would.
  const { PrincipalDirectory } = await import('../../src/services/principals.js');
  const directory = new PrincipalDirectory(harness.app.store);
  const principal = await directory.resolve({
    issuer: 'dev',
    subject: principalDisplayName,
    kind: principalDisplayName.startsWith('agt-') ? 'agent' : 'human',
    display_name: principalDisplayName,
  });

  const handle = await harness.app.store.handle(workspace);
  await handle
    .collection<{ principal: string; roles: string[] }>(MEMBERSHIPS)
    .updateOne({ principal: principal.id }, { $set: { roles } }, { upsert: true });
  return principal.id;
}

export interface Response<T = Record<string, unknown>> {
  status: number;
  body: T;
}

export async function call<T = Record<string, unknown>>(
  harness: Harness,
  method: string,
  url: string,
  options: { as?: string; body?: unknown } = {},
): Promise<Response<T>> {
  const response = await harness.server.inject({
    method: method as 'GET',
    url,
    ...(options.as ? { headers: { authorization: `Bearer ${options.as}` } } : {}),
    ...(options.body !== undefined ? { payload: options.body as object } : {}),
  });
  return {
    status: response.statusCode,
    body: response.body ? (JSON.parse(response.body) as T) : ({} as T),
  };
}
