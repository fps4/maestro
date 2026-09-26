/**
 * The workspace registry — definitions in force, and the validators compiled from them.
 *
 * A workspace definition is data, versioned like anything else. Applying a new one is a governed
 * change: existing versions were written against the definition in force at the time, and that
 * definition version is stamped on them, so history stays readable under the schema it was written
 * against rather than being migrated to a schema it never satisfied.
 *
 * Facet schemas are stored **inline** with the definition rather than read from disk at runtime.
 * A running service that needs a file on the filesystem to validate a write is a service whose
 * behaviour depends on what someone left in a container.
 */

import { FacetValidator } from '../domain/facets.js';
import { parseWorkspaceDefinition, type WorkspaceDefinition } from '../domain/workspace-definition.js';
import type { Store, WorkspaceRecord } from '../db/client.js';

export type { StoredDefinition } from '../db/control.js';

export interface LoadedWorkspace {
  record: WorkspaceRecord;
  definition: WorkspaceDefinition;
  validator: FacetValidator;
  facet_schemas: Record<string, object>;
}

export class WorkspaceRegistry {
  private readonly cache = new Map<string, LoadedWorkspace>();

  constructor(private readonly store: Store) {}

  /** Drop a cached definition after applying a new one. */
  invalidate(workspace: string): void {
    this.cache.delete(workspace);
  }

  async load(workspace: string): Promise<LoadedWorkspace> {
    const cached = this.cache.get(workspace);
    if (cached) return cached;

    const record = await this.store.workspaceRecord(workspace);
    if (!record) throw new Error(`No workspace \`${workspace}\` is registered in this deployment.`);

    const stored = await this.store.control.definitions.get(workspace, record.definition_version);
    if (!stored) {
      throw new Error(
        `Workspace \`${workspace}\` names definition version ${record.definition_version}, which is not stored. ` +
          'Apply a definition before serving requests against it.',
      );
    }

    const definition = parseWorkspaceDefinition(stored.definition);
    const validator = new FacetValidator();
    for (const type of definition.types) {
      const schema = stored.facet_schemas[type.id];
      if (schema) validator.register(type.id, schema);
    }

    const loaded: LoadedWorkspace = {
      record,
      definition,
      validator,
      facet_schemas: stored.facet_schemas,
    };
    this.cache.set(workspace, loaded);
    return loaded;
  }

  async list(): Promise<WorkspaceRecord[]> {
    return this.store.control.workspaces.list();
  }

  /**
   * Apply a definition, bumping the workspace to it.
   *
   * Schema changes are additive-only against accepted versions: a breaking facet change creates a
   * new *type*, not a new version of one. History cannot be migrated, so it must stay readable
   * under the schema it was written against — and this is checked here rather than trusted.
   */
  async apply(input: {
    definition: WorkspaceDefinition;
    facet_schemas: Record<string, object>;
    applied_by: string;
    title?: string;
  }): Promise<{ workspace: string; definition_version: number; created: boolean }> {
    const { definition } = input;
    const control = this.store.control;
    const existing = await this.store.workspaceRecord(definition.workspace);

    if (existing && existing.kind !== definition.kind) {
      throw new Error(
        `Workspace \`${definition.workspace}\` is registered as \`${existing.kind}\` and this definition declares \`${definition.kind}\`. ` +
          'A workspace does not change kind: a catalogue holds shared standards and a tenant holds a tenant’s own record, and swapping one for the other would re-scope everything already written.',
      );
    }
    if (existing && definition.definition_version <= existing.definition_version) {
      throw new Error(
        `Workspace \`${definition.workspace}\` is at definition version ${existing.definition_version}; ` +
          `this definition declares ${definition.definition_version}. A definition version only moves forward.`,
      );
    }

    // Every type a stored version could name must still exist, or those versions become unreadable.
    if (existing) {
      const previous = await control.definitions.get(definition.workspace, existing.definition_version);
      if (previous) {
        const before = parseWorkspaceDefinition(previous.definition);
        const removed = before.types.filter((t) => !definition.types.some((n) => n.id === t.id));
        if (removed.length > 0) {
          throw new Error(
            `This definition removes ${removed.map((t) => `\`${t.id}\``).join(', ')}. ` +
              'Versions were written under those types and cannot be migrated, so removal would make them unreadable. ' +
              'Stop creating new artifacts of a type instead of deleting it.',
          );
        }
      }
    }

    const now = new Date().toISOString();
    await control.definitions.insert({
      workspace: definition.workspace,
      definition_version: definition.definition_version,
      definition,
      facet_schemas: input.facet_schemas,
      applied_at: now,
      applied_by: input.applied_by,
    });

    await control.workspaces.upsert(
      {
        id: definition.workspace,
        kind: definition.kind,
        definition_version: definition.definition_version,
        ...(input.title || definition.title ? { title: input.title ?? definition.title! } : {}),
      },
      now,
    );

    this.invalidate(definition.workspace);
    return {
      workspace: definition.workspace,
      definition_version: definition.definition_version,
      created: !existing,
    };
  }
}
