/**
 * `npm run workspace:apply -- config/workspaces/aannemer-x.yaml`
 *
 * Reads a definition, resolves its facet schemas from disk, validates the whole thing, and stores
 * it. **Schema files are read here and never at runtime** — a running service that needs a file on
 * the filesystem to validate a write is a service whose behaviour depends on what someone left in
 * a container image.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { loadConfig } from '../config.js';
import { Store } from '../db/client.js';
import { DefinitionError, parseWorkspaceDefinition } from '../domain/workspace-definition.js';
import { WorkspaceRegistry } from '../services/workspaces.js';

async function main(): Promise<void> {
  const [path, ...rest] = process.argv.slice(2);
  if (!path) {
    console.error('Usage: workspace:apply -- <definition.yaml> [--by <principal>]');
    process.exit(2);
  }

  const byIndex = rest.indexOf('--by');
  const appliedBy = byIndex >= 0 ? (rest[byIndex + 1] ?? 'cli') : 'cli';

  const absolute = resolve(process.cwd(), path);
  const raw = parse(await readFile(absolute, 'utf8')) as unknown;

  let definition;
  try {
    definition = parseWorkspaceDefinition(raw);
  } catch (error) {
    if (error instanceof DefinitionError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  // Every type must have a readable schema before anything is stored. A definition applied with a
  // missing schema would validate nothing for that type and nobody would notice until a bad write
  // was already a record.
  const base = dirname(absolute);
  const facetSchemas: Record<string, object> = {};
  for (const type of definition.types) {
    const schemaPath = resolve(base, type.facet_schema);
    try {
      facetSchemas[type.id] = JSON.parse(await readFile(schemaPath, 'utf8')) as object;
    } catch (error) {
      console.error(
        `Type \`${type.id}\` names facet schema \`${type.facet_schema}\`, which could not be read from ${schemaPath}: ${(error as Error).message}`,
      );
      process.exit(1);
    }
  }

  const config = loadConfig();
  const store = await Store.connect(config);
  try {
    const registry = new WorkspaceRegistry(store);
    const result = await registry.apply({ definition, facet_schemas: facetSchemas, applied_by: appliedBy });
    console.log(
      `${result.created ? 'Created' : 'Updated'} workspace \`${result.workspace}\` at definition version ${result.definition_version} ` +
        `(${definition.kind}, ${definition.types.length} types, ${definition.gates.length} gates).`,
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  } finally {
    await store.close();
  }
}

await main();
