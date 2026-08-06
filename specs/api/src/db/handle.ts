/**
 * Workspace isolation, as a type (ADR-0006).
 *
 * The rule, stated once:
 *
 * > A workspace-scoped handle is acquired once per request, and no query names a workspace.
 *
 * **This fails closed, and that is the argument.** A forgotten `WHERE tenant_id` returns every
 * tenant's rows. A forgotten handle has no database to query — it does not compile, and at worst it
 * errors. The failure mode of the mistake is what matters, not the elegance of the mechanism.
 *
 * The catalogue (ADR-0008) is the one workspace readable from another, and it gets a **different
 * type**. A `CatalogueHandle` exposes reads only, cannot be constructed for a tenant workspace, and
 * is not assignable to a `WorkspaceHandle` — so "read a standard" and "read a tenant's business
 * case" cannot be confused by a caller, however tired.
 */

import type { ClientSession, Collection, Db, Document } from 'mongodb';

/** Reads and writes, bound to exactly one tenant workspace's database. */
export interface WorkspaceHandle {
  readonly kind: 'tenant';
  readonly workspace: string;
  readonly db: Db;
  collection<T extends Document>(name: string): Collection<T>;
  /**
   * A transaction over this workspace's database.
   *
   * On the handle rather than reached from a client, so a service can write a change and its
   * outbox event atomically without ever holding something that could address another workspace.
   */
  transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T>;
}

/**
 * The subset of a collection a catalogue reader may reach.
 *
 * Deliberately not `Collection<T>` with a comment saying "please only read". A write method that is
 * absent from the type cannot be called by accident, and this is the boundary where an accident
 * would cross a workspace.
 */
export type ReadOnlyCollection<T extends Document> = Pick<
  Collection<T>,
  'find' | 'findOne' | 'countDocuments' | 'distinct' | 'aggregate'
>;

/** Reads only, bound to the catalogue workspace. Never constructible for a tenant. */
export interface CatalogueHandle {
  readonly kind: 'catalogue';
  readonly workspace: string;
  collection<T extends Document>(name: string): ReadOnlyCollection<T>;
}

export class IsolationViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsolationViolation';
  }
}

/**
 * A writable handle, bound to exactly one workspace.
 *
 * The catalogue is *authored* through one of these too — writing a standard is ordinary authoring,
 * through the same drafts, versions and gates as anything else. What stops a tenant session
 * reaching the catalogue this way is not the handle's type but membership: a handle is only ever
 * acquired for a workspace the caller belongs to, and that check lives in the auth layer where the
 * caller is known. Putting it here as well would give two answers to one question.
 */
export function workspaceHandle(
  db: Db,
  workspace: string,
  startSession: () => ClientSession,
): WorkspaceHandle {
  return {
    kind: 'tenant',
    workspace,
    db,
    collection: <T extends Document>(name: string) => db.collection<T>(name),
    async transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
      const session = startSession();
      try {
        let result!: T;
        await session.withTransaction(async () => {
          result = await work(session);
        });
        return result;
      } finally {
        await session.endSession();
      }
    },
  };
}

export function catalogueHandle(db: Db, workspace: string, kind: 'tenant' | 'catalogue'): CatalogueHandle {
  // A CatalogueHandle over a tenant database would be a read across the confidentiality boundary
  // wearing the one type that is allowed to cross it. This is the check that makes the type mean
  // what it says, and the adversarial test in tests/integration/isolation.test.ts drives it.
  if (kind !== 'catalogue') {
    throw new IsolationViolation(
      `\`${workspace}\` is a tenant workspace and cannot be reached through a CatalogueHandle. Only the catalogue is readable across workspaces.`,
    );
  }
  return {
    kind: 'catalogue',
    workspace,
    collection: <T extends Document>(name: string) => db.collection<T>(name) as ReadOnlyCollection<T>,
  };
}
