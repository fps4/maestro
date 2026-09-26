/**
 * Content addressing.
 *
 * A version's identity is `lineage@ordinal` plus a digest over the envelope, facets, body and
 * attachment digests — so a fork, an export and an adoption in another workspace all refer to the
 * same bytes, and a decision can name what it decided on rather than merely when.
 *
 * Redaction is the one operation that deliberately breaks the match (§8.3). A mismatch with no
 * `BodyRedacted` event is corruption; a mismatch with one is a lawful erasure. That distinction
 * only works if the digest is computed identically every time, which is what canonicalisation
 * below is for.
 */

import { createHash } from 'node:crypto';
import type { AttachmentRef, Body, Facets, Link, CatalogueRef, EffectiveWindow } from './types.js';

/**
 * Canonical JSON: object keys sorted, no insignificant whitespace, `undefined` dropped.
 *
 * Without this, two versions with identical content but different key insertion order would carry
 * different digests — and every equality claim the record makes would be a claim about how a
 * document happened to be built.
 */
export function canonicalise(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Cannot canonicalise a non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
  }
  // undefined, function, symbol — never part of a record.
  throw new TypeError(`Cannot canonicalise a value of type ${typeof value}`);
}

export interface DigestSubject {
  workspace: string;
  artifact: string;
  type: string;
  ordinal: number;
  definition_version: number;
  facets: Facets;
  body: Body;
  attachments: AttachmentRef[];
  links: Link[];
  catalogue_refs?: CatalogueRef[];
  effective?: EffectiveWindow;
}

/**
 * The digest over a version.
 *
 * Provenance and contributors are deliberately excluded: who confirmed a facet is part of the
 * record but not part of the content, and including it would mean the same bytes reviewed by two
 * people carried two identities.
 */
export function digestVersion(subject: DigestSubject): string {
  const payload = {
    workspace: subject.workspace,
    artifact: subject.artifact,
    type: subject.type,
    ordinal: subject.ordinal,
    definition_version: subject.definition_version,
    facets: subject.facets,
    body: { format: subject.body.format, content: subject.body.content },
    attachments: subject.attachments
      .map((a) => ({ id: a.id, digest: a.digest, media_type: a.media_type, filename: a.filename }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    links: subject.links
      .map((l) => ({ type: l.type, target: l.target, pinned_to: l.pinned_to ?? null }))
      .sort((a, b) => (`${a.type}${a.target}` < `${b.type}${b.target}` ? -1 : 1)),
    catalogue_refs: (subject.catalogue_refs ?? [])
      .map((r) => ({ standard: r.standard, ordinal: r.ordinal, pack: r.pack, pack_version: r.pack_version }))
      .sort((a, b) => (`${a.standard}${a.ordinal}` < `${b.standard}${b.ordinal}` ? -1 : 1)),
    effective: subject.effective ?? null,
  };
  return `sha256:${createHash('sha256').update(canonicalise(payload), 'utf8').digest('hex')}`;
}

/** Content addressing for an attachment's bytes. Identical bytes across ten versions store once. */
/** The digest of a text that stays out of the record: a question, a reason. */
export function digestOf(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** For display: `sha256:9f2c4a…e18b`. Never for comparison. */
export function abbreviateDigest(digest: string): string {
  const [algo, hex] = digest.split(':');
  if (!hex || hex.length < 12) return digest;
  return `${algo}:${hex.slice(0, 6)}…${hex.slice(-4)}`;
}
