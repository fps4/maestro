/**
 * A Merkle tree over the day's events, RFC 6962 §2.1 (the Certificate Transparency construction).
 *
 * Chosen because it is fully specified for any number of leaves — no padding, no duplicated last
 * node — and because its inclusion proofs let a single event be shown to belong to a sealed segment
 * later, without the rest of the day. Leaves and interior nodes are domain-separated (0x00 / 0x01),
 * so a leaf can never be presented as a node.
 *
 * Computed here, in code, never by a vendor primitive: the chain is what the tenant can verify with
 * every service off (ADR-0003).
 */

import { createHash } from 'node:crypto';
import { type Digest, hexOf } from './digest.js';

const LEAF = Buffer.from([0x00]);
const NODE = Buffer.from([0x01]);

export function leafHash(canonicalBytes: Uint8Array | string): Digest {
  return `sha256:${createHash('sha256').update(LEAF).update(canonicalBytes).digest('hex')}`;
}

function nodeHash(left: Buffer, right: Buffer): Buffer {
  return createHash('sha256').update(NODE).update(left).update(right).digest();
}

/** The root over leaf digests in order. The empty tree's root is the hash of the empty string. */
export function merkleRoot(leaves: readonly Digest[]): Digest {
  if (leaves.length === 0) return `sha256:${createHash('sha256').digest('hex')}`;
  return `sha256:${subtreeRoot(leaves.map(hexOf)).toString('hex')}`;
}

function subtreeRoot(nodes: Buffer[]): Buffer {
  if (nodes.length === 1) return nodes[0]!;
  const k = largestPowerOfTwoBelow(nodes.length);
  return nodeHash(subtreeRoot(nodes.slice(0, k)), subtreeRoot(nodes.slice(k)));
}

/** The largest power of two strictly less than n (n ≥ 2), as RFC 6962 splits a tree. */
function largestPowerOfTwoBelow(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}
