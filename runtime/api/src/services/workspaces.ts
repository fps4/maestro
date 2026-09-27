/**
 * Workspace definitions: applied by the operator (`npm run workspace:apply`), read by every request.
 *
 * A definition is stored under its version and never changed; the workspace record points at the
 * version in force. The humans a definition names as accountable are registered as principals at
 * apply, so the relay can check that `accountable` is a human (the spine's rule) for an item raised
 * by an agent or a signal before that human has ever called.
 */

import type { Store } from '../db/client.js';
import { parseWorkspaceDefinition, type WorkspaceDefinition } from '../domain/definition.js';
import { Refusal } from '../domain/decide.js';

export interface ApplyResult {
  workspace: string;
  definition_version: number;
  created: boolean;
}

export class WorkspaceRegistry {
  private readonly cache = new Map<string, WorkspaceDefinition>();

  constructor(private readonly store: Store) {}

  async apply(definition: WorkspaceDefinition, appliedBy: string, now: string): Promise<ApplyResult> {
    const existing = await this.store.control.workspaces.get(definition.workspace);
    if (existing && definition.definition_version <= existing.definition_version) {
      throw new Refusal(
        `\`${definition.workspace}\` is at definition version ${existing.definition_version}; a new definition takes a higher version than that.`,
      );
    }
    await this.store.control.definitions.insert({
      workspace: definition.workspace,
      definition_version: definition.definition_version,
      definition,
      applied_at: now,
      applied_by: appliedBy,
    });
    for (const human of new Set([
      ...definition.applications.map((a) => a.accountable),
      ...(definition.steward ? [definition.steward] : []),
    ])) {
      await this.store.control.principals.seen(human, 'human', now);
    }
    await this.store.control.workspaces.upsert(
      {
        id: definition.workspace,
        definition_version: definition.definition_version,
        ...(definition.title ? { title: definition.title } : {}),
      },
      now,
    );
    return {
      workspace: definition.workspace,
      definition_version: definition.definition_version,
      created: !existing,
    };
  }

  /** The definition in force for a workspace. */
  async current(workspace: string): Promise<WorkspaceDefinition> {
    const record = await this.store.control.workspaces.get(workspace);
    if (!record || record.definition_version === 0) {
      throw new Refusal(
        `\`${workspace}\` has no definition applied; \`npm run workspace:apply\` stores one.`,
      );
    }
    const key = `${workspace}#${record.definition_version}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const stored = await this.store.control.definitions.get(workspace, record.definition_version);
    if (!stored) {
      throw new Error(
        `\`${workspace}\` points at definition version ${record.definition_version}, which is not stored.`,
      );
    }
    const definition = parseWorkspaceDefinition(stored.definition);
    this.cache.set(key, definition);
    return definition;
  }
}
