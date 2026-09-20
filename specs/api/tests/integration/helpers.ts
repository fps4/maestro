/**
 * Integration harness.
 *
 * These tests drive the real service against DynamoDB Local, because the meaningful behaviour of
 * this system is integration-shaped: a transaction that half-applies, a pin that resolves against
 * stored state, a key prefix that stops a query crossing a boundary. None of that is observable
 * from a unit test.
 */

import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { FastifyInstance } from 'fastify';
import { buildApp, type App } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { dynamoClientFor } from '../../src/db/client.js';
import { createTable, deleteTable } from '../../src/db/table.js';
import { parseWorkspaceDefinition } from '../../src/domain/workspace-definition.js';
import { WorkspaceRegistry } from '../../src/services/workspaces.js';

const here = dirname(fileURLToPath(import.meta.url));
/** The shipped definitions — the catalogue is applied from here. */
export const CONFIG_DIR = resolve(here, '../../../config/workspaces');
/**
 * The tenant the tests run against is a fixture, not the demo tenant the service ships: the tests
 * need a chain that exercises every mechanism, and the demo needs to read as a product. Keeping
 * them apart means a product change never silently rewrites what the suite proves.
 */
export const FIXTURE_DIR = resolve(here, '../fixtures');

/** DynamoDB Local: `make dynamodb`, or the sibling container the DoD gate starts. */
export const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000';

/**
 * A distinct table per test file — and per run, so a rerun after a crash starts from nothing —
 * so files cannot see each other's workspaces. Created from `db/table.ts`, the one schema.
 */
export function testConfig(suffix: string): Config {
  return loadConfig({
    SPECS_ENV: 'ci',
    NODE_ENV: 'test',
    TABLE_NAME: `specs-test-${suffix}-${randomBytes(4).toString('hex')}`,
    DYNAMODB_ENDPOINT,
    AWS_REGION: 'local',
    AUTH_MODE: 'dev',
    CATALOGUE_WORKSPACE: `cat-${suffix}`,
    RECORD_SINK: 'local',
    RECORD_ARCHIVE_DIR: mkdtempSync(join(tmpdir(), `specs-archive-${suffix}-`)),
    RECORD_PAYLOAD_DIR: mkdtempSync(join(tmpdir(), `specs-payloads-${suffix}-`)),
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

/**
 * The table this file runs against. DynamoDB Local may still be starting when the suite does, so
 * a refused connection is retried for a while before it is a failure with a sentence.
 */
export async function createTestTable(config: Config): Promise<void> {
  const client = dynamoClientFor(config);
  const deadline = Date.now() + 30_000;
  try {
    for (;;) {
      try {
        await createTable(client, config.TABLE_NAME);
        return;
      } catch (error) {
        const code = (error as { code?: string; name?: string }).code ?? (error as Error).name;
        if (code !== 'ECONNREFUSED' || Date.now() > deadline) {
          throw new Error(
            `DynamoDB Local is not reachable at ${DYNAMODB_ENDPOINT} (${(error as Error).message}). ` +
              'Start it with `make dynamodb`, or point DYNAMODB_ENDPOINT at one.',
          );
        }
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  } finally {
    client.destroy();
  }
}

export async function dropTestTable(config: Config): Promise<void> {
  const client = dynamoClientFor(config);
  try {
    await deleteTable(client, config.TABLE_NAME);
  } finally {
    client.destroy();
  }
}

export async function startHarness(suffix: string): Promise<Harness> {
  const config = testConfig(suffix);
  const tenant = `ten-${suffix}`;
  const catalogue = `cat-${suffix}`;

  await createTestTable(config);
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
      // Drop the table this file created; a rerun makes its own.
      await app.stop();
      await dropTestTable(config);
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

/**
 * Membership is granted in the workspace, not by the token — so tests must grant it too. An agent
 * (`agt-…`) needs the human answerable for it named on the membership, or it cannot act
 * (ADR-0019 §2): pass that human's id as `accountable`.
 */
export async function grantMembership(
  harness: Harness,
  workspace: string,
  principalDisplayName: string,
  roles: string[],
  accountable?: string,
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
  await handle.memberships.put({
    principal: principal.id,
    roles,
    ...(accountable ? { accountable } : {}),
  });
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
