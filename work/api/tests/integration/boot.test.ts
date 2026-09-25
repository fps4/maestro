/**
 * The table and the code are one schema: the service refuses to start on a table whose key or
 * indexes differ from `table.ts`, in a sentence naming what moved.
 */

import { CreateTableCommand } from '@aws-sdk/client-dynamodb';
import { afterAll, describe, expect, it } from 'vitest';
import { dynamoClientFor, Store } from '../../src/db/client.js';
import { deleteTable } from '../../src/db/table.js';
import { DYNAMODB_ENDPOINT } from './helpers.js';

describe('boot', () => {
  const config = { TABLE_NAME: `work-test-boot-${Date.now()}`, DYNAMODB_ENDPOINT, AWS_REGION: 'local' };
  const client = dynamoClientFor(config);
  afterAll(async () => {
    await deleteTable(client, config.TABLE_NAME);
    client.destroy();
  });

  it('refuses a table without the indexes table.ts declares', async () => {
    await client.send(
      new CreateTableCommand({
        TableName: config.TABLE_NAME,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
      }),
    );
    await expect(Store.connect(config)).rejects.toThrow(/has no index `gsi1`/);
  });
});
