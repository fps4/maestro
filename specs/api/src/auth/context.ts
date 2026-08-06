/**
 * The request context: who is calling, in which workspace, with what handles.
 *
 * This is where the isolation rule is actually applied. A handle is acquired **once per request**,
 * for the one workspace the caller is a member of, and every service built below takes that handle
 * rather than a workspace id. There is no code path that resolves a second one.
 */

import { MEMBERSHIPS } from '../db/collections.js';
import type { Store } from '../db/client.js';
import type { CatalogueHandle, WorkspaceHandle } from '../db/handle.js';
import type { Principal } from '../domain/types.js';
import type { PrincipalDirectory, PrincipalRecord } from '../services/principals.js';
import type { LoadedWorkspace, WorkspaceRegistry } from '../services/workspaces.js';
import type { VerifiedToken } from './verify.js';

export class Forbidden extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Forbidden';
  }
}

export interface Membership {
  principal: string;
  roles: string[];
  /** Gates this principal is explicitly assigned to, for `resolver: assignment`. */
  gates?: string[];
}

export interface RequestContext {
  principal: PrincipalRecord;
  workspace: LoadedWorkspace;
  handle: WorkspaceHandle;
  catalogue: CatalogueHandle;
  roles: string[];
  gates: string[];
  actor: { principal: string; kind: Principal['kind'] };
}

export interface ContextDeps {
  store: Store;
  registry: WorkspaceRegistry;
  directory: PrincipalDirectory;
}

/**
 * Build a request context, or refuse.
 *
 * Roles come from two places and both are needed. The token carries what the identity deployment
 * knows (this principal is a `reviewer` of this Application); the membership record carries what
 * *this workspace* grants (this principal is the `sponsor` here). A gate resolver reads the union,
 * because "reviewer everywhere" and "sponsor in Aannemer X" are both true and mean different things.
 */
export async function buildContext(
  deps: ContextDeps,
  token: VerifiedToken,
  workspaceId: string,
): Promise<RequestContext> {
  const principal = await deps.directory.resolve({
    issuer: token.issuer,
    subject: token.subject,
    kind: token.kind,
    display_name: token.display_name,
  });

  const workspace = await deps.registry.load(workspaceId);

  // A token that scopes workspaces is authoritative about which ones it may reach at all. Without
  // that claim, membership is the only gate — and either way an unlisted workspace is refused
  // before a handle exists, so there is nothing to accidentally query.
  if (token.workspaces.length > 0 && !token.workspaces.includes(workspaceId)) {
    throw new Forbidden(`This token is not admitted to \`${workspaceId}\`.`);
  }

  const handle = await deps.store.handle(workspaceId);
  const membership = await handle
    .collection<Membership>(MEMBERSHIPS)
    .findOne({ principal: principal.id }, { projection: { _id: 0 } });

  if (!membership && token.workspaces.length === 0) {
    throw new Forbidden(
      `\`${principal.display_name}\` is not a member of \`${workspaceId}\`. Membership is granted in the workspace, not by the token.`,
    );
  }

  const catalogue = await deps.store.catalogue();

  return {
    principal,
    workspace,
    handle,
    catalogue,
    roles: [...new Set([...token.roles, ...(membership?.roles ?? [])])],
    gates: membership?.gates ?? [],
    actor: { principal: principal.id, kind: principal.kind },
  };
}

/** Capability check for ordinary authoring. Deciding is resolved per gate, not here. */
export function requireRole(context: RequestContext, role: string): void {
  if (!context.roles.includes(role)) {
    throw new Forbidden(
      `This action needs \`${role}\` in \`${context.workspace.record.id}\`; you hold ${
        context.roles.length ? context.roles.map((r) => `\`${r}\``).join(', ') : 'no roles here'
      }.`,
    );
  }
}
