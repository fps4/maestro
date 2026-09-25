/**
 * The principal registry.
 *
 * A registry maps `(issuer, subject) → principal id`, and **only the principal id is ever written**
 * to a draft, version, decision or export (§7.2). An issuer's subject is minted per deployment;
 * move the identity deployment and every subject re-mints, against decisions retained for years.
 *
 * The id is identity-service's (ADR-0022): it mints the maestro principal id and carries it in
 * every token as `prn`, and this registry records that id against the token's `(issuer, subject)`
 * on first sight rather than minting one of its own — one human, one id, in every component's
 * record. Only a development token without a `prn` is still given a locally minted id.
 *
 * Agents are principals of kind `agent`, distinct from the credential they authenticate with and
 * from the human accountable for their work — which is what makes the attribution rule enforceable
 * rather than aspirational.
 */

import { Forbidden } from '../auth/context.js';
import type { Store } from '../db/client.js';
import type { PrincipalRecord } from '../db/control.js';
import { kindOfPrincipalId, mintPrincipalId } from '../domain/ids.js';
import type { Principal, PrincipalKind } from '../domain/types.js';

export type { PrincipalRecord } from '../db/control.js';

/** The operator's command that aligns an identity registered under an id this service minted. */
export const ADOPT_COMMAND = 'npm run principal:adopt';

export class PrincipalDirectory {
  private readonly cache = new Map<string, PrincipalRecord>();

  constructor(private readonly store: Store) {}

  private get principals() {
    return this.store.control.principals;
  }

  /**
   * Resolve a token's issuer and subject to a principal, registering it on first sight.
   *
   * With a `prn` — every verified token — the principal **is** that id: registered under it on first
   * sight, and refused if this registry already knows the identity by another id. That is the case
   * of an identity first seen before this service read `prn`, when it minted its own; the records
   * that name the old id are history and stay as they are, and an operator aligns the registry once
   * with `principal:adopt` (ADR-0022 §3). Refusing, rather than silently re-pointing a grant at
   * request time, keeps a change to who holds a membership an operator's act.
   *
   * Without one — a development token — the id is minted here on first sight, as before.
   *
   * First sight is the only moment the issuer's subject is stored, and it is stored here — among
   * the control items, on the mapping item — never on a record.
   */
  async resolve(input: {
    issuer: string;
    subject: string;
    kind: PrincipalKind;
    display_name: string;
    prn?: string;
    operated_by?: string;
  }): Promise<PrincipalRecord> {
    const now = new Date().toISOString();
    if (input.prn !== undefined && kindOfPrincipalId(input.prn) !== input.kind) {
      throw new Forbidden(`\`${input.prn}\` is not ${article(input.kind)} ${input.kind}'s principal id.`);
    }
    const existing = await this.principals.bySubject(input.issuer, input.subject);
    if (existing) {
      if (input.prn !== undefined && existing.id !== input.prn) throw mismatch(input, existing.id);
      return this.seen(existing, input.display_name, now);
    }
    if (input.prn !== undefined) {
      const taken = await this.principals.get(input.prn);
      if (taken) {
        throw new Forbidden(
          `\`${input.prn}\` is registered here for another identity than \`${input.issuer}\` / \`${input.subject}\`. An operator looks before anything is re-pointed.`,
        );
      }
    }

    const record: PrincipalRecord = {
      id: input.prn ?? mintPrincipalId(input.kind),
      kind: input.kind,
      display_name: input.display_name,
      issuer: input.issuer,
      subject: input.subject,
      ...(input.operated_by ? { operated_by: input.operated_by } : {}),
      created_at: now,
      last_seen_at: now,
    };
    const { inserted } = await this.principals.insert(record);
    if (!inserted) {
      // Two first sights at once: the other one registered, and it is the one to keep.
      const minted = await this.principals.bySubject(input.issuer, input.subject);
      if (!minted) throw new Error(`Principal for ${input.issuer}/${input.subject} vanished after a race.`);
      if (input.prn !== undefined && minted.id !== input.prn) throw mismatch(input, minted.id);
      return this.seen(minted, input.display_name, now);
    }
    this.cache.set(record.id, record);
    return record;
  }

  /**
   * A display name changes; a principal id does not. Keeping the name current is what makes a
   * five-year-old decision readable without a lookup table nobody kept.
   */
  private async seen(existing: PrincipalRecord, displayName: string, now: string): Promise<PrincipalRecord> {
    const renamed = existing.display_name !== displayName;
    await this.principals.touch(existing.id, {
      ...(renamed ? { display_name: displayName } : {}),
      last_seen_at: now,
    });
    const current = { ...existing, display_name: displayName, last_seen_at: now };
    this.cache.set(current.id, current);
    return current;
  }

  async get(id: string): Promise<PrincipalRecord | null> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const found = await this.principals.get(id);
    if (found) this.cache.set(id, found);
    return found;
  }

  async getMany(ids: string[]): Promise<Map<string, PrincipalRecord>> {
    const unique = [...new Set(ids)].filter(Boolean);
    const missing = unique.filter((id) => !this.cache.has(id));
    if (missing.length > 0) {
      for (const record of await this.principals.getMany(missing)) this.cache.set(record.id, record);
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

function mismatch(input: { issuer: string; subject: string; prn?: string }, registered: string): Forbidden {
  return new Forbidden(
    `This identity is registered here as \`${registered}\`, a principal id this service minted before it read identity-service's; the token names \`${input.prn}\`. ` +
      `An operator aligns them once: \`${ADOPT_COMMAND} -- --issuer ${input.issuer} --subject ${input.subject} --prn ${input.prn}\`.`,
  );
}

const article = (word: string): string => (/^[aeiou]/.test(word) ? 'an' : 'a');
