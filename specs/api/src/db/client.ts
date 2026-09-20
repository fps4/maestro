/**
 * The DynamoDB client, the control items, and handle acquisition (ADR-0021; maestro ADR-0018).
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
import {
  catalogueHandle,
  PROJECTION_VERSION,
  workspaceHandle,
  type CatalogueHandle,
  type WorkspaceHandle,
} from './handle.js';
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
        'Rebuild it from the archive (`npm run workspace:rebuild -- --workspace <id> --force`); nothing migrates in place.',
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
    private readonly config: Pick<Config, 'CATALOGUE_WORKSPACE'>,
  ) {
    this.control = controlStore(doc, table);
  }

  static async connect(config: StoreConfig & Pick<Config, 'CATALOGUE_WORKSPACE'>): Promise<Store> {
    const client = dynamoClientFor(config);
    const doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    const store = new Store(client, doc, config.TABLE_NAME, config);
    await store.assertTable();
    return store;
  }

  /**
   * Fail at boot rather than at the first query.
   *
   * The module declares the table and the code declares its shape (`table.ts`); the two must
   * match, and this is where a mismatch is found — at start-up, in a sentence naming the index.
   */
  private async assertTable(): Promise<void> {
    const description = await describeTable(this.client, this.table);
    const problems = schemaDiscrepancies(description);
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

  async workspaceRecord(workspace: string): Promise<WorkspaceRecord | null> {
    return this.control.workspaces.get(workspace);
  }

  private async registered(workspace: string): Promise<WorkspaceRecord> {
    const record = await this.control.workspaces.get(workspace);
    if (!record) throw new UnknownWorkspace(workspace);
    if (!this.checked.has(workspace)) {
      // A workspace an older projection wrote is refused here, before a handle exists (ADR-0020 §4).
      await this.ensureProjectionVersion(workspace);
      this.checked.add(workspace);
    }
    return record;
  }

  /**
   * Stamp a workspace the running service first serves with the current projection version, and
   * refuse one written by an older projection. Once per workspace per process.
   */
  private async ensureProjectionVersion(workspace: string): Promise<void> {
    const meta = workspaceHandle(this.doc, this.table, workspace).meta;
    const found = await meta.get();
    if (!found) {
      await meta.putIfAbsent({ projection_version: PROJECTION_VERSION });
      return;
    }
    if (found.projection_version < PROJECTION_VERSION)
      throw new ProjectionBehind(workspace, found.projection_version);
  }

  /**
   * The only way to reach a tenant workspace's items.
   *
   * No repository accepts a raw client or a workspace id, so every access passes through here and
   * a code search for a query naming a workspace finds nothing.
   */
  async handle(workspace: string): Promise<WorkspaceHandle> {
    await this.registered(workspace);
    return workspaceHandle(this.doc, this.table, workspace);
  }

  /**
   * Reads over the shared catalogue, and the only handle that crosses a workspace.
   *
   * Refuses any workspace not declared as a catalogue — otherwise this would be a read across the
   * confidentiality boundary wearing the one type allowed to cross it (ADR-0008).
   */
  async catalogue(workspace = this.config.CATALOGUE_WORKSPACE): Promise<CatalogueHandle> {
    const record = await this.registered(workspace);
    return catalogueHandle(this.doc, this.table, workspace, record.kind);
  }

  /**
   * Every item under a workspace's prefix, paged — the rebuilder's drop and its emptiness check,
   * and the tests' snapshot. A scan filtered on the prefix: a tenant's table holds that tenant
   * (maestro ADR-0007), so the scan reads what it is about to return.
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

  /** The kinds of record item a workspace holds — empty means the rebuilder may write it. */
  async populatedRecordKinds(workspace: string): Promise<Kind[]> {
    const found = new Set<Kind>();
    for await (const item of this.dump(workspace)) {
      const kind = item[KIND] as Kind;
      if (RECORD_KINDS.includes(kind)) found.add(kind);
    }
    return RECORD_KINDS.filter((k) => found.has(k));
  }

  /**
   * Delete a workspace's prefix — the rebuilder's `--force`, and nothing else's (ADR-0020 §4).
   *
   * On the Store rather than reached through a handle, because a handle is what a request holds and
   * a request must never be able to do this. Control items are untouched: definitions and
   * principals are not the workspace's.
   */
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
