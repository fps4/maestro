/**
 * The DynamoDB client, the control items, and handle acquisition (maestro ADR-0018).
 *
 * No database credential exists: on AWS the function's role is the grant, and `DYNAMODB_ENDPOINT`
 * names DynamoDB Local on a laptop. The table is described at boot, so a table the module did not
 * make — or made differently from `table.ts` — is a sentence at start-up rather than a query that
 * fails later.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { Config } from '../config.js';
import { controlStore, type ControlStore, type WorkspaceRecord } from './control.js';
import { bind, PROJECTION_VERSION, workspaceHandle, type Bound, type WorkspaceHandle } from './handle.js';
import { Items, type Item, type Key } from './items.js';
import { RECORD_KINDS, workspacePrefix, type Kind } from './keys.js';
import { describeTable, KIND, PK, schemaDiscrepancies, SK } from './table.js';

export type { WorkspaceRecord } from './control.js';

export class UnknownWorkspace extends Error {
  constructor(workspace: string) {
    super(`No workspace \`${workspace}\` is registered in this deployment.`);
    this.name = 'UnknownWorkspace';
  }
}

export class ProjectionBehind extends Error {
  constructor(
    readonly workspace: string,
    readonly found: number,
  ) {
    super(
      `Workspace \`${workspace}\` was projected at version ${found}; this service projects at ${PROJECTION_VERSION}. ` +
        'Rebuild it from the archive; nothing migrates in place.',
    );
    this.name = 'ProjectionBehind';
  }
}

export type StoreConfig = Pick<Config, 'TABLE_NAME' | 'DYNAMODB_ENDPOINT' | 'AWS_REGION'>;

/** The client the configuration describes: the runtime's own credentials, or Local's stand-ins. */
export function dynamoClientFor(config: StoreConfig): DynamoDBClient {
  return new DynamoDBClient({
    region: config.AWS_REGION,
    ...(config.DYNAMODB_ENDPOINT
      ? {
          endpoint: config.DYNAMODB_ENDPOINT,
          // DynamoDB Local accepts any key pair; the SDK still insists on one.
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {}),
  });
}

export class Store {
  private readonly checked = new Set<string>();
  readonly control: ControlStore;

  private constructor(
    readonly client: DynamoDBClient,
    readonly doc: DynamoDBDocumentClient,
    readonly table: string,
  ) {
    this.control = controlStore(doc, table);
  }

  static async connect(config: StoreConfig): Promise<Store> {
    const client = dynamoClientFor(config);
    const doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
    const store = new Store(client, doc, config.TABLE_NAME);
    await store.assertTable();
    return store;
  }

  /** Fail at boot rather than at the first query: the module and `table.ts` declare one table. */
  private async assertTable(): Promise<void> {
    const problems = schemaDiscrepancies(await describeTable(this.client, this.table));
    if (problems.length > 0) {
      throw new Error(
        `Table \`${this.table}\` does not match api/src/db/table.ts: ${problems.join('; ')}. ` +
          'The Terraform module and table.ts declare the same table; one of them moved.',
      );
    }
  }

  async close(): Promise<void> {
    this.client.destroy();
  }

  private async registered(workspace: string): Promise<WorkspaceRecord> {
    const record = await this.control.workspaces.get(workspace);
    if (!record) throw new UnknownWorkspace(workspace);
    if (!this.checked.has(workspace)) {
      const meta = workspaceHandle(this.doc, this.table, workspace).meta;
      const found = await meta.get();
      if (!found) await meta.putIfAbsent({ projection_version: PROJECTION_VERSION });
      else if (found.projection_version < PROJECTION_VERSION)
        throw new ProjectionBehind(workspace, found.projection_version);
      this.checked.add(workspace);
    }
    return record;
  }

  /**
   * The only way to reach a workspace's items. No repository accepts a raw client or a workspace
   * id, so every access passes through here.
   */
  async handle(workspace: string): Promise<WorkspaceHandle> {
    await this.registered(workspace);
    return workspaceHandle(this.doc, this.table, workspace);
  }

  /** The bound item access under a handle, for the repositories that live beside it. */
  async bound(workspace: string): Promise<Bound> {
    await this.registered(workspace);
    return bind(this.doc, this.table, workspace);
  }

  /**
   * Every item under a workspace's prefix, paged — a rebuild's drop and the tests' snapshot. A scan
   * filtered on the prefix, the operator's and never a function's: no function is granted `Scan`.
   */
  async *dump(workspace: string): AsyncGenerator<Item> {
    const prefix = workspacePrefix(workspace);
    let start: Record<string, unknown> | undefined;
    do {
      const { Items: page, LastEvaluatedKey } = await this.doc.send(
        new ScanCommand({
          TableName: this.table,
          FilterExpression: 'begins_with(#pk, :prefix)',
          ExpressionAttributeNames: { '#pk': PK },
          ExpressionAttributeValues: { ':prefix': prefix },
          ConsistentRead: true,
          ...(start ? { ExclusiveStartKey: start } : {}),
        }),
      );
      for (const item of page ?? []) yield item as Item;
      start = LastEvaluatedKey;
    } while (start);
  }

  /** The kinds of record item a workspace holds — empty means a rebuild may write it. */
  async populatedRecordKinds(workspace: string): Promise<Kind[]> {
    const found = new Set<Kind>();
    for await (const item of this.dump(workspace)) {
      const kind = item[KIND] as Kind;
      if (RECORD_KINDS.includes(kind)) found.add(kind);
    }
    return RECORD_KINDS.filter((k) => found.has(k));
  }

  /** Delete a workspace's prefix — a rebuild's `--force`, never a request's. */
  async dropWorkspace(workspace: string): Promise<void> {
    if (!(await this.control.workspaces.get(workspace))) throw new UnknownWorkspace(workspace);
    const items = new Items(this.doc, this.table, workspacePrefix(workspace));
    const keys: Key[] = [];
    for await (const item of this.dump(workspace)) {
      keys.push({ pk: item[PK] as string, sk: item[SK] as string });
      if (keys.length >= 100) await items.batchWrite([], keys.splice(0));
    }
    if (keys.length > 0) await items.batchWrite([], keys);
    this.checked.delete(workspace);
  }
}
