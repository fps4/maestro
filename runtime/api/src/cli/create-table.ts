/**
 * `npm run table:create` — the table on DynamoDB Local, from `db/table.ts`.
 *
 * The dev loop's one manual step after `make dynamodb`: the module makes the table on AWS, and a
 * laptop makes it from the same schema here. Idempotent — an existing table is left alone, so the
 * compose stack runs it on every start.
 */

import { loadConfig } from '../config.js';
import { dynamoClientFor } from '../db/client.js';
import { createTable } from '../db/table.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.DYNAMODB_ENDPOINT) {
    console.error(
      'table:create is for DynamoDB Local (set DYNAMODB_ENDPOINT). On AWS the Terraform module owns the table.',
    );
    process.exit(2);
  }
  const client = dynamoClientFor(config);
  try {
    const { created } = await createTable(client, config.TABLE_NAME);
    console.log(
      `${created ? 'Created' : 'Found'} table \`${config.TABLE_NAME}\` at ${config.DYNAMODB_ENDPOINT}.`,
    );
  } finally {
    client.destroy();
  }
}

await main();
