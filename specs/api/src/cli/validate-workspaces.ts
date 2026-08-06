/**
 * `npm run workspace:validate` — the linter CI runs over every committed definition.
 *
 * The definitions ARE the domain model (ADR-0001), so this is the equivalent of typechecking them.
 * It needs no database: everything checked here is a property of the definition and its schemas,
 * which is what makes it cheap enough to run on every pull request.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { FacetValidator } from '../domain/facets.js';
import { DefinitionError, parseWorkspaceDefinition } from '../domain/workspace-definition.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(here, '../../../config/workspaces');

async function main(): Promise<void> {
  const dir = resolve(process.cwd(), process.argv[2] ?? DEFAULT_DIR);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();

  if (files.length === 0) {
    console.error(`No workspace definitions found in ${dir}.`);
    process.exit(1);
  }

  let failed = 0;

  for (const file of files) {
    const path = resolve(dir, file);
    try {
      const definition = parseWorkspaceDefinition(parse(await readFile(path, 'utf8')));

      // A definition that references a schema it cannot load would validate nothing for that type,
      // and nobody would notice until a bad write was already a record.
      //
      // Compiled through the *same* validator the service uses at runtime, not a locally configured
      // Ajv. Two instances with different options would mean CI checks the schemas under rules
      // production does not apply, and the difference would only ever surface as a write that CI
      // said was fine.
      const validator = new FacetValidator();
      for (const type of definition.types) {
        const schemaPath = resolve(dir, type.facet_schema);
        validator.register(type.id, JSON.parse(await readFile(schemaPath, 'utf8')) as object);
      }

      console.log(
        `✓ ${file} — ${definition.workspace} v${definition.definition_version} (${definition.kind}, ` +
          `${definition.types.length} types, ${definition.gates.length} gates, ${definition.lifecycle.phases.length} phases)`,
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof DefinitionError ? error.message : (error as Error).message;
      console.error(`✗ ${file}\n${message.replace(/^/gm, '  ')}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} of ${files.length} definitions are invalid.`);
    process.exit(1);
  }
  console.log(`\n${files.length} definitions are valid.`);
}

await main();
