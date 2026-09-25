/**
 * The request context: who is calling, in which workspace, with what handles.
 *
 * This is where the isolation rule is actually applied. A handle is acquired **once per request**,
 * for the one workspace the caller is a member of, and every service built below takes that handle
 * rather than a workspace id. There is no code path that resolves a second one.
 */

import { uuidv7 } from '@fps4/maestro-spine';
import type { Store } from '../db/client.js';
import type { CatalogueHandle, WorkspaceHandle } from '../db/handle.js';
import { createRecorder, type Actor, type Recorder } from '../db/outbox.js';
import type { PayloadStore } from '../record/payload-store.js';
import type { PrincipalDirectory, PrincipalRecord } from '../services/principals.js';
import type { LoadedWorkspace, WorkspaceRegistry } from '../services/workspaces.js';
import type { VerifiedToken } from './verify.js';

export class Forbidden extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Forbidden';
  }
}

export type { Membership } from '../db/handle.js';

export interface RequestContext {
  principal: PrincipalRecord;
  workspace: LoadedWorkspace;
  handle: WorkspaceHandle;
  catalogue: CatalogueHandle;
  roles: string[];
  gates: string[];
  actor: Actor;
  /** One per request; every event the request records carries it. */
  correlation_id: string;
  recorder: Recorder;
  /** Where a payload is written before the transaction that names it (ADR-0020). */
  payloads: PayloadStore;
}

export interface ContextDeps {
  store: Store;
  registry: WorkspaceRegistry;
  directory: PrincipalDirectory;
  payloads: PayloadStore;
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
    ...(token.prn ? { prn: token.prn } : {}),
  });

  const workspace = await deps.registry.load(workspaceId);

  // A token that scopes workspaces is authoritative about which ones it may reach at all. Without
  // that claim, membership is the only gate — and either way an unlisted workspace is refused
  // before a handle exists, so there is nothing to accidentally query.
  if (token.workspaces.length > 0 && !token.workspaces.includes(workspaceId)) {
    throw new Forbidden(`This token is not admitted to \`${workspaceId}\`.`);
  }

  const handle = await deps.store.handle(workspaceId);
  const membership = await handle.memberships.get(principal.id);

  if (!membership && token.workspaces.length === 0) {
    throw new Forbidden(
      `\`${principal.display_name}\` is not a member of \`${workspaceId}\`. Membership is granted in the workspace, not by the token.`,
    );
  }

  const catalogue = await deps.store.catalogue();

  const roles = [...new Set([...token.roles, ...(membership?.roles ?? [])])];
  const actor: Actor = {
    principal: principal.id,
    kind: principal.kind,
    roles,
    ...(membership?.accountable ? { accountable: membership.accountable } : {}),
    ...(principal.supersedes?.length ? { supersedes: principal.supersedes } : {}),
  };
  const correlation_id = uuidv7();
  const recorder = createRecorder({
    handle,
    workspace: workspaceId,
    definition: workspace.definition,
    actor,
    principals: async (ids) => deps.directory.getMany(ids),
    correlation_id,
  });

  return {
    principal,
    workspace,
    handle,
    catalogue,
    roles,
    gates: membership?.gates ?? [],
    actor,
    correlation_id,
    recorder,
    payloads: deps.payloads,
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
