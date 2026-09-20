/**
 * The payload store (ADR-0020 §1).
 *
 * The envelope carries tokens; what the service actually keeps — a version's text, a decision's
 * reasoning, a question, an answer, an evaluator's findings — is a payload: canonical JSON bytes
 * written to an erasable object store *before* the transaction that emits the event, and named on
 * the event by a locator (`payload_ref`) and a digest (`payload_digest`). Erase the payload and the
 * archive still proves what bytes were accepted at which gate; the archive itself is immutable, so
 * personal data has to live somewhere that is not.
 *
 * Two adapters, the same split as the archive's: S3 for maestro's deployment, the filesystem for a
 * laptop. Keys are `<workspace>/<subject_type>/<subject_id>/<what>` so a workspace's payloads are
 * one prefix and an export is one `sync`. The key layout is the contract; version it before a
 * component that is not this service reads it.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { canonicalize, sha256 } from '@fps4/maestro-spine';
import { spineWorkspaceId, versionRef } from '../domain/ids.js';

/** What an event carries for its payload: where the bytes are, and what they hash to. */
export interface PayloadRef {
  ref: string;
  digest: string;
}

export interface PayloadStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<PayloadRef>;
  /** The bytes a ref names. Refuses a ref outside this store: a locator is not a licence to read. */
  get(ref: string): Promise<Uint8Array>;
  erase(ref: string): Promise<void>;
}

export class PayloadRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadRefused';
  }
}

/** The bytes at a ref do not hash to the digest the event carries. */
export class PayloadMismatch extends Error {
  constructor(
    readonly ref: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`The payload at ${ref} hashes to ${actual}; the event says ${expected}.`);
    this.name = 'PayloadMismatch';
  }
}

export const PAYLOAD_CONTENT_TYPE = 'application/json';

/** `<workspace>/<subject_type>/<subject_id>/<what>`, the workspace in the spine's form. */
export function payloadKey(workspace: string, subjectType: string, subjectId: string, what: string): string {
  return `${spineWorkspaceId(workspace)}/${subjectType}/${subjectId}/${what}`;
}

/** The key for a payload about a version — the only subject type today. */
export function versionPayloadKey(
  workspace: string,
  subject: { artifact: string; ordinal: number },
  what: string,
): string {
  return payloadKey(workspace, 'version', versionRef(subject.artifact, subject.ordinal), what);
}

/** A payload's bytes: the canonical JSON of the value, UTF-8. The digest is the spine's form. */
export function encodePayload(value: unknown): { bytes: Uint8Array; digest: string } {
  const bytes = Buffer.from(canonicalize(value), 'utf8');
  return { bytes, digest: sha256(bytes) };
}

export async function writePayload(store: PayloadStore, key: string, value: unknown): Promise<PayloadRef> {
  const { bytes } = encodePayload(value);
  return store.put(key, bytes, PAYLOAD_CONTENT_TYPE);
}

/** Fetch a payload and check it against the digest the event carries before anyone reads it. */
export async function readPayload<T = unknown>(store: PayloadStore, ref: PayloadRef): Promise<T> {
  const bytes = await store.get(ref.ref);
  const actual = sha256(bytes);
  if (actual !== ref.digest) throw new PayloadMismatch(ref.ref, ref.digest, actual);
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
}

/**
 * Payloads under a directory: `file:///<abs root>/<key>`. Written atomically — a temporary file
 * renamed into place — so a reader never sees half a payload, and a retry of a failed transaction
 * overwrites the same key with the same bytes.
 */
export class FsPayloadStore implements PayloadStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathOf(ref: string): string {
    let path: string;
    try {
      path = fileURLToPath(ref);
    } catch {
      throw new PayloadRefused(`\`${ref}\` is not a file URL this store can read.`);
    }
    const resolved = resolve(path);
    if (resolved !== this.root && !resolved.startsWith(this.root + sep)) {
      throw new PayloadRefused(`\`${ref}\` is outside this payload store (${this.root}).`);
    }
    return resolved;
  }

  async put(key: string, bytes: Uint8Array): Promise<PayloadRef> {
    const path = join(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new PayloadRefused(`\`${key}\` escapes the payload root.`);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temp, bytes);
    await rename(temp, path);
    return { ref: pathToFileURL(path).href, digest: sha256(bytes) };
  }

  async get(ref: string): Promise<Uint8Array> {
    return readFile(this.pathOf(ref));
  }

  async erase(ref: string): Promise<void> {
    try {
      await unlink(this.pathOf(ref));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export interface S3PayloadStoreOptions {
  bucket: string;
  /** Under the bucket; `payloads` by default. Empty means the bucket root. */
  prefix?: string;
  client: S3Client;
}

/**
 * Payloads in this service's own object store: `s3://<bucket>/<prefix>/<key>`. Versioned and
 * encrypted by the bucket, never Object-Locked — erasure has to be possible here.
 */
export class S3PayloadStore implements PayloadStore {
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly client: S3Client;

  constructor(options: S3PayloadStoreOptions) {
    this.bucket = options.bucket;
    this.prefix = (options.prefix ?? 'payloads').replace(/^\/+|\/+$/g, '');
    this.client = options.client;
  }

  private objectKey(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  private keyOf(ref: string): string {
    const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(ref);
    if (!m) throw new PayloadRefused(`\`${ref}\` is not an S3 locator.`);
    const [, bucket, key] = m as unknown as [string, string, string];
    const under = this.prefix ? `${this.prefix}/` : '';
    if (bucket !== this.bucket || !key.startsWith(under)) {
      throw new PayloadRefused(`\`${ref}\` is outside this payload store (s3://${this.bucket}/${under}).`);
    }
    return key;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<PayloadRef> {
    const objectKey = this.objectKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: bytes, ContentType: contentType }),
    );
    return { ref: `s3://${this.bucket}/${objectKey}`, digest: sha256(bytes) };
  }

  async get(ref: string): Promise<Uint8Array> {
    const key = this.keyOf(ref);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new PayloadRefused(`\`${ref}\` has no body.`);
    return response.Body.transformToByteArray();
  }

  async erase(ref: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.keyOf(ref) }));
  }
}
