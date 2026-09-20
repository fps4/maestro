/**
 * Identifier minting and parsing.
 *
 * Ids are ours (§7.2). An issuer's `sub` is never written to a draft, version, decision or export:
 * a subject is minted per identity deployment, and moving that deployment would re-mint every one
 * of them against decisions retained for years. The registry indirection costs one collection now
 * and is unavailable later.
 */

import { randomBytes } from 'node:crypto';

/** Crockford base32 without I, L, O and U — no character pair reads alike out loud or in a font. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function token(bytes: number): string {
  const buf = randomBytes(bytes);
  let out = '';
  for (const b of buf) out += ALPHABET[b % 32];
  return out;
}

export const mintWorkspaceId = (): string => `ws-${token(8).toLowerCase()}`;

/**
 * The workspace as the spine names it: `ws-<id>`. A configured workspace is a bare slug here
 * (`aannemer-x`); maestro's record calls it `ws-aannemer-x`. Deterministic and lossless for a
 * slug that does not already start with `ws-` (ADR-0019 §4).
 */
export const spineWorkspaceId = (id: string): string => (id.startsWith('ws-') ? id : `ws-${id}`);
export const mintArtifactId = (): string => `art-${token(10).toLowerCase()}`;
export const mintDraftId = (): string => `dft-${token(10).toLowerCase()}`;
/**
 * maestro's form: the kind is in the id — `prn-h-…` human, `prn-a-…` agent, `prn-w-…` workload
 * (our `service`) — so the spine can tell a human from an agent without a registry call
 * (ADR-0019). Lower-case after the letter, as the spine's grammar requires.
 */
export const mintPrincipalId = (kind: 'human' | 'agent' | 'service'): string =>
  `prn-${kind === 'human' ? 'h' : kind === 'agent' ? 'a' : 'w'}-${token(12).toLowerCase()}`;
export const mintAttachmentId = (): string => `att-${token(10).toLowerCase()}`;
export const mintDecisionId = (): string => `dec-${token(12).toLowerCase()}`;
export const mintQuestionId = (): string => `qst-${token(10).toLowerCase()}`;

/**
 * A version's public identity: `<artifact>@<ordinal>`.
 *
 * This string appears in exports, in the console, and in an auditor's notes, so it is parsed as
 * often as it is printed and both directions live here.
 */
export function versionRef(artifact: string, ordinal: number): string {
  return `${artifact}@${ordinal}`;
}

export interface ParsedVersionRef {
  artifact: string;
  ordinal: number;
}

export function parseVersionRef(ref: string): ParsedVersionRef | null {
  const at = ref.lastIndexOf('@');
  if (at <= 0 || at === ref.length - 1) return null;
  const artifact = ref.slice(0, at);
  const ordinal = Number(ref.slice(at + 1));
  if (!Number.isInteger(ordinal) || ordinal < 1) return null;
  return { artifact, ordinal };
}

/**
 * The database name for a workspace.
 *
 * A workspace is logical and never physical (§2.1) — the id does not encode where it lives, so this
 * mapping is the only place that decides, and moving a workspace changes nothing an export or a
 * pinned reference can see.
 */
export function databaseNameFor(workspace: string, prefix = 'ws'): string {
  const safe = workspace.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${prefix}_${safe}`;
}
