/**
 * The adversarial isolation test.
 *
 * This belongs in the tier that proves the service works at all. Acquire workspace A's handle,
 * attempt B's data, assert failure — and do the same for the catalogue, which is the one workspace
 * readable from another and therefore the one place the boundary could be crossed on purpose.
 *
 * The point is the *failure mode*. A forgotten filter returns another tenant's rows; a forgotten
 * handle has no database to query. These tests exist to keep it that way as the code changes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { IsolationViolation } from '../../src/db/handle.js';
import { WorkspaceRegistry } from '../../src/services/workspaces.js';
import { VERSIONS } from '../../src/db/collections.js';
import {
  applyDefinition,
  call,
  CONFIG_DIR,
  FIXTURE_DIR,
  grantMembership,
  startHarness,
  token,
  type Harness,
} from './helpers.js';
import type { Version } from '../../src/domain/types.js';

let harness: Harness;
let other: string;

const AUTHOR = token('p-visser', 'human', 'author');

beforeAll(async () => {
  harness = await startHarness('iso');
  await grantMembership(harness, harness.tenant, 'p-visser', ['author']);

  // A second tenant in the same deployment, which is the situation isolation exists for.
  other = `other-iso`;
  await applyDefinition(new WorkspaceRegistry(harness.app.store), resolve(FIXTURE_DIR, 'tenant.yaml'), {
    workspace: other,
  });

  // Put something in the other tenant worth stealing.
  const handle = await harness.app.store.handle(other);
  await handle.collection<Version>(VERSIONS).insertOne({
    workspace: other,
    artifact: 'art-secret',
    type: 'business_case',
    title: 'Commercially sensitive',
    ordinal: 1,
    state: 'accepted',
    digest: 'sha256:secret',
    definition_version: 1,
    facets: {},
    provenance: {},
    body: { format: 'markdown/v1', content: 'Should never be readable from another workspace.' },
    attachments: [],
    links: [],
    proposed_by: 'prn-x',
    contributors: [],
    proposed_at: new Date().toISOString(),
  });
}, 60_000);

afterAll(async () => {
  if (harness) {
    await harness.app.store.client.db(`${harness.config.MONGO_DB_PREFIX}_${other}`).dropDatabase();
    await harness.stop();
  }
});

describe('database per workspace', () => {
  it('gives two workspaces two databases, so a query cannot reach across', async () => {
    const a = await harness.app.store.handle(harness.tenant);
    const b = await harness.app.store.handle(other);
    expect(a.db.databaseName).not.toBe(b.db.databaseName);
  });

  it('finds nothing when tenant A’s handle looks for tenant B’s document by id', async () => {
    // The adversarial read: the attacker knows the exact id and asks for it directly.
    const a = await harness.app.store.handle(harness.tenant);
    const stolen = await a.collection<Version>(VERSIONS).findOne({ artifact: 'art-secret' });
    expect(stolen).toBeNull();
  });

  it('refuses a request for a workspace the caller is not a member of', async () => {
    const refused = await call<{ error: string; message: string }>(
      harness,
      'GET',
      `/v1/workspaces/${other}/register`,
      { as: AUTHOR },
    );
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/not a member/);
  });

  it('refuses a request for a workspace that does not exist, without leaking whether it might', async () => {
    const refused = await call(harness, 'GET', '/v1/workspaces/no-such-workspace/register', { as: AUTHOR });
    expect(refused.status).toBeGreaterThanOrEqual(400);
  });
});

describe('the catalogue handle', () => {
  it('cannot be constructed for a tenant workspace', async () => {
    // This is the check that makes the type mean what it says. A CatalogueHandle over a tenant
    // database would be a read across the confidentiality boundary wearing the one type that is
    // allowed to cross it.
    await expect(harness.app.store.catalogue(harness.tenant)).rejects.toThrow(IsolationViolation);
    await expect(harness.app.store.catalogue(other)).rejects.toThrow(
      /cannot be reached through a CatalogueHandle/,
    );
  });

  it('is constructible for the catalogue, and exposes no write method', async () => {
    const catalogue = await harness.app.store.catalogue(harness.catalogue);
    expect(catalogue.kind).toBe('catalogue');

    const collection = catalogue.collection(VERSIONS) as Record<string, unknown>;
    // Reads are present; writes are absent from the type. Asserting on the value too, because a
    // type-only guarantee disappears the moment someone casts.
    expect(typeof collection.find).toBe('function');
    for (const write of ['insertOne', 'updateOne', 'deleteOne', 'replaceOne', 'bulkWrite']) {
      expect(collection[write]).toBeUndefined();
    }
  });

  it('reads the catalogue from inside a tenant session, which is the one crossing that is allowed', async () => {
    const standards = await call<{ standards: unknown[] }>(
      harness,
      'GET',
      `/v1/workspaces/${harness.tenant}/catalogue/standards`,
      { as: AUTHOR },
    );
    expect(standards.status).toBe(200);
    expect(Array.isArray(standards.body.standards)).toBe(true);
  });
});

describe('search', () => {
  it('cannot return another workspace’s content, because the index is not in this database', async () => {
    const results = await call<{ results: Array<{ title: string }> }>(
      harness,
      'GET',
      `/v1/workspaces/${harness.tenant}/search?q=sensitive`,
      { as: AUTHOR },
    );
    expect(results.status).toBe(200);
    expect(results.body.results.map((r) => r.title)).not.toContain('Commercially sensitive');
  });
});

describe('the code itself', () => {
  it('has no repository that takes a raw client or a workspace id', async () => {
    // ADR-0006 is a compile-time guarantee only while every store access goes through a handle. A
    // lint rule enforces this in `services/`, `http/` and `mcp/`; this asserts the rule is still
    // configured, so deleting it is a failing test rather than a silent loss.
    const config = await readFile(resolve(CONFIG_DIR, '../../api/eslint.config.js'), 'utf8');
    expect(config).toMatch(/importNames: \['MongoClient', 'Db'\]/);
    expect(config).toMatch(/src\/services\/\*\*\/\*\.ts/);
  });

  it('keeps DecisionService unreachable from MCP by lint, not by comment', async () => {
    // ADR-0005's "no decision surface on MCP" is structural only while nothing on the MCP import
    // graph can reach the one module that decides. The rule names the graph's leaves explicitly.
    const config = await readFile(resolve(CONFIG_DIR, '../../api/eslint.config.js'), 'utf8');
    expect(config).toMatch(
      /files: \['src\/mcp\/\*\*\/\*\.ts', 'src\/services\/packet\.ts', 'src\/services\/gate-view\.ts'\]/,
    );
    expect(config).toMatch(/\*\*\/services\/decisions/);
  });
});
