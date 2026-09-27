/**
 * The request context: who is calling, in which workspace, with what handle.
 *
 * This is where isolation is applied. A handle is acquired **once per request**, for the one
 * workspace the caller is a member of, and everything below takes that handle rather than a
 * workspace id. There is no code path that resolves a second one.
 */

import type { Store } from '../db/client.js';
import type { Membership, WorkspaceHandle } from '../db/handle.js';
import type { PrincipalKind } from '../domain/ids.js';
import type { VerifiedToken } from './verify.js';

export class Forbidden extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Forbidden';
  }
}

export interface Caller {
  principal: string;
  kind: PrincipalKind;
  /** The token's roles and the membership's, together. */
  roles: string[];
  /** For an agent: the human its membership names as answerable. */
  accountable?: string;
}

export interface RequestContext {
  workspace: string;
  caller: Caller;
  membership: Membership;
  handle: WorkspaceHandle;
}

export interface ContextDeps {
  store: Store;
  now?: () => string;
}

export async function buildContext(
  deps: ContextDeps,
  token: VerifiedToken,
  workspace: string,
): Promise<RequestContext> {
  const handle = await deps.store.handle(workspace);
  const membership = await handle.memberships.get(token.principal);
  if (!membership) {
    throw new Forbidden(
      `\`${token.principal}\` is not a member of \`${workspace}\`. Membership is granted in the workspace (\`npm run workspace:member\`), not by the token.`,
    );
  }
  await deps.store.control.principals.seen(token.principal, token.kind, (deps.now ?? isoNow)());
  const caller: Caller = {
    principal: token.principal,
    kind: token.kind,
    roles: [...new Set([...token.roles, ...membership.roles])],
    ...(membership.accountable ? { accountable: membership.accountable } : {}),
  };
  return { workspace, caller, membership, handle };
}

export function requireRole(context: RequestContext, role: string): void {
  if (!context.caller.roles.includes(role)) {
    throw new Forbidden(
      `This needs \`${role}\` in \`${context.workspace}\`; \`${context.caller.principal}\` holds ${
        context.caller.roles.length ? context.caller.roles.map((r) => `\`${r}\``).join(', ') : 'no roles here'
      }.`,
    );
  }
}

const isoNow = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
