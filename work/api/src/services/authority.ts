/**
 * Projecting runtime-service's `InstanceLevelSet` and `InstanceTierSet` (maestro ADR-0027 §4): read
 * → project → one conditional transaction holding the application's authority and the outbox row
 * that records it, like every other write here. A replay of an event already projected — the
 * subscription delivers at least once — changes nothing and records nothing.
 */

import { uuidv7, type SpineEvent } from '@fps4/maestro-spine';
import {
  applicationOfSource,
  AuthorityRefused,
  evolveAuthority,
  project,
  PROJECTED,
  type AuthorityField,
} from '../domain/authority.js';
import { spineWorkspaceId, type PrincipalKind } from '../domain/ids.js';
import type { Store } from '../db/client.js';
import { emit } from './recorder.js';
import type { Scope } from './work-items.js';
import type { WorkspaceRegistry } from './workspaces.js';

export interface Projection {
  outcome: 'projected' | 'unchanged';
  application: string;
  field: AuthorityField;
}

export class AuthorityService {
  constructor(
    private readonly store: Store,
    private readonly workspaces: WorkspaceRegistry,
    private readonly now: () => string,
  ) {}

  async apply(scope: Scope, source: SpineEvent): Promise<Projection> {
    if (source.workspace_id !== spineWorkspaceId(scope.workspace)) {
      throw new AuthorityRefused(
        `\`${source.type}\` belongs to \`${source.workspace_id}\`, not \`${scope.workspace}\`.`,
      );
    }
    const definition = await this.workspaces.declared(scope.workspace);
    // The person who set it answers for the projection too; the spine checks they are a human.
    await this.store.control.principals.seen(source.accountable, 'human', this.now());
    const principals = async (ids: string[]): Promise<Map<string, PrincipalKind>> => {
      const found = await this.store.control.principals.getMany(ids);
      return new Map(found.map((p) => [p.id, p.kind]));
    };

    return scope.handle.transaction(async (tx) => {
      const before = await scope.handle.authorities.get(applicationOfSource(source));
      const event = project(definition, before, source, scope.actor.principal);
      if (!event) {
        return { outcome: 'unchanged', application: before!.application, field: PROJECTED[source.type]! };
      }
      const after = evolveAuthority(before, event);
      scope.handle.authorities.stage(tx, before, after);
      await emit(
        tx,
        { handle: scope.handle, workspace: scope.workspace, correlation_id: uuidv7(), principals },
        [{ event, subject_seq: after.revision, consequence_class: definition.consequence_class }],
      );
      return { outcome: 'projected', application: event.application, field: event.body.field };
    });
  }
}
