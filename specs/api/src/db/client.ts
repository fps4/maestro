/**
 * The Mongo client, the control database, and handle acquisition.
 *
 * A **replica set is required**, including in development. The outbox is transactional and
 * multi-document transactions need one, so a standalone `mongod` is not a supported configuration —
 * running against one would appear to work until the first partial write, which is the worst
 * possible moment to discover it.
 */

import { MongoClient, type Db } from 'mongodb';
import type { Config } from '../config.js';
import { databaseNameFor } from '../domain/ids.js';
import { catalogueHandle, workspaceHandle, type CatalogueHandle, type WorkspaceHandle } from './handle.js';
import {
  ensureControlIndexes,
  ensureProjectionVersion,
  ensureWorkspaceIndexes,
  WORKSPACES,
} from './collections.js';

export interface WorkspaceRecord {
  id: string;
  kind: 'tenant' | 'catalogue';
  title?: string;
  definition_version: number;
  created_at: string;
}

export class UnknownWorkspace extends Error {
  constructor(workspace: string) {
    super(`No workspace \`${workspace}\` is registered in this deployment.`);
    this.name = 'UnknownWorkspace';
  }
}

export class Store {
  private readonly indexed = new Set<string>();

  private constructor(
    readonly client: MongoClient,
    private readonly config: Config,
  ) {}

  static async connect(config: Config): Promise<Store> {
    const client = new MongoClient(config.MONGO_URI, {
      ...(config.MONGO_USER && config.MONGO_PASSWORD
        ? {
            auth: { username: config.MONGO_USER, password: config.MONGO_PASSWORD },
            authSource: config.MONGO_AUTH_SOURCE,
          }
        : {}),
      // A write that is not acknowledged by a majority can be rolled back by an election, and a
      // record that can be rolled back is not a record.
      writeConcern: { w: 'majority' },
      retryWrites: true,
    });
    await client.connect();

    const store = new Store(client, config);
    await ensureControlIndexes(store.control());
    await store.assertReplicaSet();
    return store;
  }

  /**
   * Fail at boot rather than at the first transaction.
   *
   * A standalone deployment answers every ordinary read and write happily and then refuses to start
   * a session transaction — so without this check the service looks healthy right up until the
   * outbox tries to do its one job.
   */
  private async assertReplicaSet(): Promise<void> {
    const info = (await this.client.db('admin').command({ hello: 1 })) as { setName?: string; msg?: string };
    if (!info.setName && info.msg !== 'isdbgrid') {
      throw new Error(
        'MongoDB is running standalone. The transactional outbox needs multi-document transactions, ' +
          'so a replica set is required — start mongod with --replSet and run rs.initiate().',
      );
    }
  }

  control(): Db {
    return this.client.db(this.config.MONGO_CONTROL_DB);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async workspaceRecord(workspace: string): Promise<WorkspaceRecord | null> {
    return this.control().collection<WorkspaceRecord>(WORKSPACES).findOne({ id: workspace });
  }

  private async database(workspace: string): Promise<{ db: Db; record: WorkspaceRecord }> {
    const record = await this.workspaceRecord(workspace);
    if (!record) throw new UnknownWorkspace(workspace);
    const db = this.client.db(databaseNameFor(workspace, this.config.MONGO_DB_PREFIX));
    if (!this.indexed.has(workspace)) {
      // A database an older projection wrote is refused here, before a handle exists (ADR-0020 §4).
      await ensureProjectionVersion(db, workspace);
      await ensureWorkspaceIndexes(db);
      this.indexed.add(workspace);
    }
    return { db, record };
  }

  /**
   * Drop a workspace's database — the rebuilder's `--force`, and nothing else's (ADR-0020 §4).
   *
   * On the Store rather than reached through a handle, because a handle is what a request holds and
   * a request must never be able to do this. The control database is untouched: definitions and
   * principals are not the workspace's.
   */
  async dropWorkspace(workspace: string): Promise<void> {
    if (!(await this.workspaceRecord(workspace))) throw new UnknownWorkspace(workspace);
    await this.client.db(databaseNameFor(workspace, this.config.MONGO_DB_PREFIX)).dropDatabase();
    this.indexed.delete(workspace);
  }

  /**
   * The only way to reach a tenant workspace's store.
   *
   * No repository accepts a raw client or a workspace id, so every access passes through here and
   * a code search for a query naming a workspace finds nothing.
   */
  async handle(workspace: string): Promise<WorkspaceHandle> {
    const { db } = await this.database(workspace);
    return workspaceHandle(db, workspace, () => this.client.startSession());
  }

  /**
   * Reads over the shared catalogue, and the only handle that crosses a workspace.
   *
   * Refuses any workspace not declared as a catalogue — otherwise this would be a read across the
   * confidentiality boundary wearing the one type allowed to cross it (ADR-0008).
   */
  async catalogue(workspace = this.config.CATALOGUE_WORKSPACE): Promise<CatalogueHandle> {
    const { db, record } = await this.database(workspace);
    return catalogueHandle(db, workspace, record.kind);
  }
}
