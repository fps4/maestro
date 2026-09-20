/**
 * The control items — never per workspace: which workspaces exist, the definitions in force, and
 * the principal registry. Under `ctl#`, reached through the Store rather than a handle, because
 * they are the deployment's, not any workspace's (ADR-0021 §1).
 */

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Principal } from '../domain/types.js';
import { Conflict, Items, strip } from './items.js';
import { controlKeys, KINDS } from './keys.js';
import { PK } from './table.js';

export interface WorkspaceRecord {
  id: string;
  kind: 'tenant' | 'catalogue';
  title?: string;
  definition_version: number;
  created_at: string;
}

export interface StoredDefinition {
  workspace: string;
  definition_version: number;
  definition: unknown;
  /** Resolved at apply time, so the running service never reads a schema file. */
  facet_schemas: Record<string, object>;
  applied_at: string;
  applied_by: string;
}

export interface PrincipalRecord extends Principal {
  issuer?: string;
  subject?: string;
  /** The human answerable for an agent's work. Never the agent, and never a credential. */
  operated_by?: string;
  created_at: string;
  last_seen_at?: string;
}

/**
 * `kind` is the table's: every item names its type there. A record whose own field is called
 * `kind` — a workspace's, a principal's — keeps it on the item as `<record>_kind` and reads it
 * back under its own name (ADR-0021 §1).
 */
function workspaceFromItem(item: Record<string, unknown>): WorkspaceRecord {
  const { workspace_kind, ...rest } = strip<
    Omit<WorkspaceRecord, 'kind'> & { workspace_kind: WorkspaceRecord['kind'] }
  >(item);
  return { ...rest, kind: workspace_kind };
}

function principalFromItem(item: Record<string, unknown>): PrincipalRecord {
  const { principal_kind, ...rest } = strip<
    Omit<PrincipalRecord, 'kind'> & { principal_kind: PrincipalRecord['kind'] }
  >(item);
  return { ...rest, kind: principal_kind };
}

export class WorkspaceRepository {
  constructor(private readonly items: Items) {}

  async get(id: string): Promise<WorkspaceRecord | null> {
    const item = await this.items.get(controlKeys.workspace(id));
    return item ? workspaceFromItem(item) : null;
  }

  /** Every workspace, by id. */
  async list(): Promise<WorkspaceRecord[]> {
    const items = await this.items.query(controlKeys.workspaces);
    return items.map((i) => workspaceFromItem(i));
  }

  /** Register or move a workspace to a definition version; `created_at` is set once. */
  async upsert(record: Omit<WorkspaceRecord, 'created_at'>, now: string): Promise<void> {
    const { id, title, kind, ...fields } = record;
    await this.items.update(controlKeys.workspace(id), {
      set: { kind: KINDS.workspace, workspace_kind: kind, id, ...fields, ...(title ? { title } : {}) },
      setRaw: (e) => [['created_at', `if_not_exists(${e.n('created_at')}, ${e.v(now)})`]],
    });
  }
}

export class DefinitionRepository {
  constructor(private readonly items: Items) {}

  async get(workspace: string, version: number): Promise<StoredDefinition | null> {
    const item = await this.items.get(controlKeys.definition(workspace, version));
    return item ? strip<StoredDefinition>(item) : null;
  }

  /** `(workspace, definition_version)` is the key: a version is applied once. */
  async insert(stored: StoredDefinition): Promise<void> {
    await this.items.insert(
      {
        ...controlKeys.definition(stored.workspace, stored.definition_version),
        kind: KINDS.workspace_definition,
        ...stored,
      },
      `Workspace \`${stored.workspace}\` already has definition version ${stored.definition_version}.`,
    );
  }
}

export class PrincipalRepository {
  constructor(private readonly items: Items) {}

  async get(id: string): Promise<PrincipalRecord | null> {
    const item = await this.items.get(controlKeys.principal(id));
    return item ? principalFromItem(item) : null;
  }

  async getMany(ids: string[]): Promise<PrincipalRecord[]> {
    if (ids.length === 0) return [];
    const items = await this.items.batchGet(ids.map((id) => controlKeys.principal(id)));
    return items.map((i) => principalFromItem(i));
  }

  /** The registry's lookup: `(issuer, subject)` → the principal, through the uniqueness item. */
  async bySubject(issuer: string, subject: string): Promise<PrincipalRecord | null> {
    const mapping = await this.items.get<{ principal: string }>(
      controlKeys.principalBySubject(issuer, subject),
      ['principal'],
    );
    return mapping ? this.get(mapping.principal) : null;
  }

  /**
   * Mint: the principal and its `(issuer, subject)` uniqueness item in one transaction, each
   * conditioned on not existing (ADR-0021 §3). Two first sights of one subject: one wins, the
   * other reads what it minted.
   */
  async insert(record: PrincipalRecord): Promise<{ inserted: boolean }> {
    const { kind, ...fields } = record;
    const tx = this.items.transaction();
    tx.insert(
      { ...controlKeys.principal(record.id), kind: KINDS.principal, principal_kind: kind, ...fields },
      `Principal \`${record.id}\` already exists.`,
    );
    if (record.issuer !== undefined && record.subject !== undefined) {
      tx.insert(
        {
          ...controlKeys.principalBySubject(record.issuer, record.subject),
          kind: KINDS.unique,
          principal: record.id,
        },
        'This subject was registered by a concurrent first sight.',
      );
    }
    try {
      await tx.commit();
      return { inserted: true };
    } catch (error) {
      if (error instanceof Conflict) return { inserted: false };
      throw error;
    }
  }

  async touch(id: string, fields: { display_name?: string; last_seen_at: string }): Promise<void> {
    await this.items.update(controlKeys.principal(id), {
      set: fields,
      condition: (e) => `attribute_exists(${e.n(PK)})`,
    });
  }
}

export interface ControlStore {
  workspaces: WorkspaceRepository;
  definitions: DefinitionRepository;
  principals: PrincipalRepository;
}

export function controlStore(doc: DynamoDBDocumentClient, table: string): ControlStore {
  const items = new Items(doc, table, controlKeys.prefix);
  return {
    workspaces: new WorkspaceRepository(items),
    definitions: new DefinitionRepository(items),
    principals: new PrincipalRepository(items),
  };
}
