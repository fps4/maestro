/**
 * `npm run workspace:apply -- config/workspaces/aannemer-x.yaml [--by <principal>]`
 *
 * Reads a definition, validates it whole, and stores it under its version; the workspace moves to
 * it. A tenant's definition lives in its private configuration repository and is applied by its
 * pipeline; the one in this repository is the fictional demo tenant.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { loadConfig } from '../config.js';
import { Store } from '../db/client.js';
import { Refusal } from '../domain/decide.js';
import { DefinitionError, parseWorkspaceDefinition } from '../domain/definition.js';
import { WorkspaceRegistry } from '../services/workspaces.js';

async function main(): Promise<void> {
  const [path, ...rest] = process.argv.slice(2);
  if (!path) {
    console.error('Usage: workspace:apply -- <definition.yaml> [--by <principal>]');
    process.exit(2);
  }
  const by = rest.indexOf('--by');
  const appliedBy = by >= 0 ? (rest[by + 1] ?? 'cli') : 'cli';

  let definition;
  try {
    definition = parseWorkspaceDefinition(parse(await readFile(resolve(process.cwd(), path), 'utf8')));
  } catch (error) {
    if (error instanceof DefinitionError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const store = await Store.connect(loadConfig());
  try {
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const result = await new WorkspaceRegistry(store).apply(definition, appliedBy, now);
    console.log(
      `${result.created ? 'Created' : 'Updated'} workspace \`${result.workspace}\` at definition version ${result.definition_version} ` +
        `(${definition.applications.length} applications, ${Object.keys(definition.seats).length} seats).`,
    );
  } catch (error) {
    if (error instanceof Refusal) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  } finally {
    await store.close();
  }
}

await main();
