/**
 * The control items — never per workspace: which workspaces exist, the definitions in force, and
 * the principals this deployment has seen. Under `ctl#`, reached through the Store rather than a
 * handle, because they are the deployment's, not any workspace's.
 */

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { PrincipalKind } from '../domain/ids.js';
import { Conflict, Items, strip } from './items.js';
import { controlKeys, KINDS } from './keys.js';
import { PK } from './table.js';

export interface WorkspaceRecord {
  id: string;
  title?: string;
  definition_version: number;
  created_at: string;
}

export interface StoredDefinition {
  workspace: string;
  definition_version: number;
  /** The definition as validated at apply: seats, applications, policy. */
  definition: unknown;
  applied_at: string;
  applied_by: string;
}

/**
 * A principal this deployment has seen — in a token, a membership, or a definition. The id is
 * identity-service's `prn`; the kind is the one the id carries. The relay checks `accountable`
 * resolves to a human here, as the spine requires.
 */
export interface PrincipalRecord {
  id: string;
  kind: PrincipalKind;
  first_seen_at: string;
  last_seen_at?: string;
}

function principalFromItem(item: Record<string, unknown>): PrincipalRecord {
  const { principal_kind, ...rest } = strip<
    Omit<PrincipalRecord, 'kind'> & { principal_kind: PrincipalKind }
  >(item);
  return { ...rest, kind: principal_kind };
}

export class WorkspaceRepository {
  constructor(private readonly items: Items) {}

  async get(id: string): Promise<WorkspaceRecord | null> {
    const item = await this.items.get(controlKeys.workspace(id));
    return item ? strip<WorkspaceRecord>(item) : null;
  }

  async list(): Promise<WorkspaceRecord[]> {
    const items = await this.items.query(controlKeys.workspaces);
    return items.map((i) => strip<WorkspaceRecord>(i));
  }

  /** Register or move a workspace to a definition version; `created_at` is set once. */
  async upsert(record: Omit<WorkspaceRecord, 'created_at'>, now: string): Promise<void> {
    const { id, title, ...fields } = record;
    await this.items.update(controlKeys.workspace(id), {
      set: { kind: KINDS.workspace, id, ...fields, ...(title ? { title } : {}) },
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
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const items = await this.items.batchGet(unique.map((id) => controlKeys.principal(id)));
    return items.map((i) => principalFromItem(i));
  }

  /** Seen: registered on first sight, `last_seen_at` moved after. Idempotent. */
  async seen(id: string, kind: PrincipalKind, now: string): Promise<void> {
    try {
      await this.items.insert(
        { ...controlKeys.principal(id), kind: KINDS.principal, id, principal_kind: kind, first_seen_at: now },
        `Principal \`${id}\` is already registered.`,
      );
    } catch (error) {
      if (!(error instanceof Conflict)) throw error;
      await this.items.update(controlKeys.principal(id), {
        set: { last_seen_at: now },
        condition: (e) => `attribute_exists(${e.n(PK)})`,
      });
    }
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
