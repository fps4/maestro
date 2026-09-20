/**
 * The principal registry.
 *
 * A registry maps `(issuer, subject) → principal id`, and **only the local id is ever written** to a
 * draft, version, decision or export (§7.2). An issuer's subject is minted per deployment; move the
 * identity deployment and every subject re-mints, against decisions retained for years. The
 * indirection costs one collection now and is unavailable later.
 *
 * Agents are principals of kind `agent`, distinct from the credential they authenticate with and
 * from the human accountable for their work — which is what makes the attribution rule enforceable
 * rather than aspirational.
 */

import { PRINCIPALS } from '../db/collections.js';
import type { Store } from '../db/client.js';
import { mintPrincipalId } from '../domain/ids.js';
import type { Principal, PrincipalKind } from '../domain/types.js';

export interface PrincipalRecord extends Principal {
  issuer?: string;
  subject?: string;
  /** The human answerable for an agent's work. Never the agent, and never a credential. */
  operated_by?: string;
  created_at: string;
  last_seen_at?: string;
}

export class PrincipalDirectory {
  private readonly cache = new Map<string, PrincipalRecord>();

  constructor(private readonly store: Store) {}

  private collection() {
    return this.store.control().collection<PrincipalRecord>(PRINCIPALS);
  }

  /**
   * Resolve a token's issuer and subject to a local principal, minting one on first sight.
   *
   * First sight is the only moment the issuer's subject is stored, and it is stored here — in the
   * control database, on the mapping row — never on a record.
   */
  async resolve(input: {
    issuer: string;
    subject: string;
    kind: PrincipalKind;
    display_name: string;
    operated_by?: string;
  }): Promise<PrincipalRecord> {
    const now = new Date().toISOString();
    const existing = await this.collection().findOne({ issuer: input.issuer, subject: input.subject });
    if (existing) {
      // A display name changes; a principal id does not. Keeping the name current is what makes a
      // five-year-old decision readable without a lookup table nobody kept.
      if (existing.display_name !== input.display_name) {
        await this.collection().updateOne(
          { id: existing.id },
          { $set: { display_name: input.display_name, last_seen_at: now } },
        );
        existing.display_name = input.display_name;
      } else {
        await this.collection().updateOne({ id: existing.id }, { $set: { last_seen_at: now } });
      }
      this.cache.set(existing.id, existing);
      return existing;
    }

    const record: PrincipalRecord = {
      id: mintPrincipalId(input.kind),
      kind: input.kind,
      display_name: input.display_name,
      issuer: input.issuer,
      subject: input.subject,
      ...(input.operated_by ? { operated_by: input.operated_by } : {}),
      created_at: now,
      last_seen_at: now,
    };
    await this.collection().insertOne(record);
    this.cache.set(record.id, record);
    return record;
  }

  async get(id: string): Promise<PrincipalRecord | null> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const found = await this.collection().findOne({ id }, { projection: { _id: 0 } });
    if (found) this.cache.set(id, found);
    return found;
  }

  async getMany(ids: string[]): Promise<Map<string, PrincipalRecord>> {
    const unique = [...new Set(ids)].filter(Boolean);
    const missing = unique.filter((id) => !this.cache.has(id));
    if (missing.length > 0) {
      const found = await this.collection()
        .find({ id: { $in: missing } }, { projection: { _id: 0 } })
        .toArray();
      for (const record of found) this.cache.set(record.id, record);
    }
    const found = new Map<string, PrincipalRecord>();
    for (const id of unique) {
      const record = this.cache.get(id);
      if (record) found.set(id, record);
    }
    return found;
  }

  /**
   * A synchronous resolver over an already-loaded set.
   *
   * The attribution check is a pure function and must stay one, so callers load the principals a
   * decision names and hand this in rather than letting the domain reach for a database.
   */
  static resolverOver(records: Map<string, PrincipalRecord>) {
    return (id: string): Principal | undefined => records.get(id);
  }
}
