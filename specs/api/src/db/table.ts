/**
 * The table, stated once (ADR-0021; maestro ADR-0018).
 *
 * One table per component, keyed `pk`/`sk`, two general indexes and one sparse index for the
 * outbox, TTL on `expires_at`. This file is the schema in the sense that matters: what the key is,
 * what is indexed, and what expires. The tests create a table from it on DynamoDB Local, the dev
 * script creates the local one from it, and the Terraform module declares the same table for AWS —
 * `terraform/README` says the two must match, and `Store.connect` checks the index names at boot
 * so a mismatch is a sentence at start-up rather than a query that fails at 3am.
 */

import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ResourceInUseException,
  ResourceNotFoundException,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
  waitUntilTableNotExists,
  type CreateTableCommandInput,
  type DynamoDBClient,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';

export const PK = 'pk';
export const SK = 'sk';
/** Every item carries the type of item it is. */
export const KIND = 'kind';

export const GSI1 = 'gsi1';
export const GSI2 = 'gsi2';
/** Sparse: an outbox item carries `pending_pk`/`pending_sk` only while undelivered. */
export const PENDING = 'pending';

export const GSI1_PK = 'gsi1pk';
export const GSI1_SK = 'gsi1sk';
export const GSI2_PK = 'gsi2pk';
export const GSI2_SK = 'gsi2sk';
export const PENDING_PK = 'pending_pk';
export const PENDING_SK = 'pending_sk';

/** Epoch seconds. A draft's expiry today; nothing else expires. */
export const TTL_ATTRIBUTE = 'expires_at';

export const INDEX_NAMES = [GSI1, GSI2, PENDING] as const;
export type IndexName = (typeof INDEX_NAMES)[number];

/** The attributes the table and its indexes own; a record's own fields are everything else. */
export const KEY_ATTRIBUTES = [
  PK,
  SK,
  KIND,
  GSI1_PK,
  GSI1_SK,
  GSI2_PK,
  GSI2_SK,
  PENDING_PK,
  PENDING_SK,
] as const;

export function tableDefinition(name: string): CreateTableCommandInput {
  return {
    TableName: name,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: PK, AttributeType: 'S' },
      { AttributeName: SK, AttributeType: 'S' },
      { AttributeName: GSI1_PK, AttributeType: 'S' },
      { AttributeName: GSI1_SK, AttributeType: 'S' },
      { AttributeName: GSI2_PK, AttributeType: 'S' },
      { AttributeName: GSI2_SK, AttributeType: 'S' },
      { AttributeName: PENDING_PK, AttributeType: 'S' },
      { AttributeName: PENDING_SK, AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: PK, KeyType: 'HASH' },
      { AttributeName: SK, KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: GSI1,
        KeySchema: [
          { AttributeName: GSI1_PK, KeyType: 'HASH' },
          { AttributeName: GSI1_SK, KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: GSI2,
        KeySchema: [
          { AttributeName: GSI2_PK, KeyType: 'HASH' },
          { AttributeName: GSI2_SK, KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: PENDING,
        KeySchema: [
          { AttributeName: PENDING_PK, KeyType: 'HASH' },
          { AttributeName: PENDING_SK, KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  };
}

/**
 * Create the table with its indexes and TTL, and wait until it serves. Idempotent: an existing
 * table is left as it is — on DynamoDB Local that is the dev loop's table between restarts, and
 * on AWS the module made it and this is never called.
 */
export async function createTable(client: DynamoDBClient, name: string): Promise<{ created: boolean }> {
  let created = true;
  try {
    await client.send(new CreateTableCommand(tableDefinition(name)));
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) throw error;
    created = false;
  }
  await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: name });
  if (created) {
    await client.send(
      new UpdateTimeToLiveCommand({
        TableName: name,
        TimeToLiveSpecification: { AttributeName: TTL_ATTRIBUTE, Enabled: true },
      }),
    );
  }
  return { created };
}

export async function deleteTable(client: DynamoDBClient, name: string): Promise<void> {
  try {
    await client.send(new DeleteTableCommand({ TableName: name }));
  } catch (error) {
    if (error instanceof ResourceNotFoundException) return;
    throw error;
  }
  await waitUntilTableNotExists({ client, maxWaitTime: 60 }, { TableName: name });
}

export async function describeTable(client: DynamoDBClient, name: string): Promise<TableDescription> {
  const { Table } = await client.send(new DescribeTableCommand({ TableName: name }));
  if (!Table) throw new Error(`DynamoDB described no table named \`${name}\`.`);
  return Table;
}

/**
 * What a deployed table lacks against this schema — nothing, or the sentences to say at boot. Key
 * schema and index names: the shape a query depends on. Capacity mode, PITR and encryption are
 * the module's to get right and are not the code's to check.
 */
export function schemaDiscrepancies(table: TableDescription): string[] {
  const out: string[] = [];
  const keys = (table.KeySchema ?? []).map((k) => `${k.AttributeName}:${k.KeyType}`).sort();
  if (keys.join(',') !== [`${PK}:HASH`, `${SK}:RANGE`].join(',')) {
    out.push(`its key is (${keys.join(', ')}), not (${PK}, ${SK})`);
  }
  const indexes = new Map((table.GlobalSecondaryIndexes ?? []).map((i) => [i.IndexName, i]));
  for (const spec of tableDefinition('x').GlobalSecondaryIndexes ?? []) {
    const found = indexes.get(spec.IndexName);
    if (!found) {
      out.push(`it has no index \`${spec.IndexName}\``);
      continue;
    }
    const want = (spec.KeySchema ?? []).map((k) => `${k.AttributeName}:${k.KeyType}`).join(',');
    const have = (found.KeySchema ?? []).map((k) => `${k.AttributeName}:${k.KeyType}`).join(',');
    if (want !== have) out.push(`index \`${spec.IndexName}\` is keyed (${have}), not (${want})`);
  }
  return out;
}
