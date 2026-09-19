/**
 * Digests, in the one textual form every record carries: `sha256:<64 lowercase hex>`.
 */

import { createHash } from 'node:crypto';
import { canonicalize } from './canonical.js';

export const DIGEST = /^sha256:[0-9a-f]{64}$/;

export type Digest = `sha256:${string}`;

export function sha256(bytes: Uint8Array | string): Digest {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** The digest of a value's canonical form — what "the digest of an event" means everywhere. */
export function digestOf(value: unknown): Digest {
  return sha256(canonicalize(value));
}

export function isDigest(value: unknown): value is Digest {
  return typeof value === 'string' && DIGEST.test(value);
}

export function hexOf(digest: Digest): Buffer {
  return Buffer.from(digest.slice('sha256:'.length), 'hex');
}
