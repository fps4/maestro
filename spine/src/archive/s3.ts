/**
 * The archive on S3: the system of record on AWS. Same layout as the filesystem adapter under a
 * bucket and an optional key prefix (one prefix per tenant when a deployment is shared).
 *
 * Write-once is S3's conditional put (`If-None-Match: *`): a part or a manifest that is already
 * there comes back 412 and is reported as `exists`, never overwritten. The bucket has Object Lock
 * with a default retention — the Terraform module sets it — so even a principal that could
 * overwrite cannot remove what was written; versioning, which Object Lock requires, keeps every
 * version of `head.json`, the one object the relay rewrites. The verifier never reads the head.
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { SegmentManifest } from '../domain/segment.js';
import { DAY } from '../domain/segment.js';
import {
  type ArchiveHead,
  type ArchiveStore,
  HEAD_NAME,
  MANIFEST_NAME,
  PART_PREFIX,
  joinLines,
  partName,
  partSeq,
  splitLines,
} from './port.js';

export interface S3ArchiveOptions {
  bucket: string;
  /** Key prefix inside the bucket, without a trailing slash. Empty by default. */
  prefix?: string;
  client?: S3Sender;
  clientConfig?: S3ClientConfig;
}

/** The subset of the client the adapter uses, so a test can hand it a fake. */
export type S3Sender = Pick<S3Client, 'send'>;

export class S3Archive implements ArchiveStore {
  readonly bucket: string;
  readonly prefix: string;
  private readonly client: S3Sender;

  constructor(options: S3ArchiveOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix ? options.prefix.replace(/\/+$/, '') + '/' : '';
    this.client = options.client ?? new S3Client(options.clientConfig ?? {});
  }

  private key(...parts: string[]): string {
    return this.prefix + parts.join('/');
  }

  async readHead(workspace: string): Promise<ArchiveHead | null> {
    const raw = await this.getOrNull(this.key(workspace, HEAD_NAME));
    return raw === null ? null : (JSON.parse(raw) as ArchiveHead);
  }

  async writeHead(workspace: string, head: ArchiveHead): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(workspace, HEAD_NAME),
        Body: JSON.stringify(head),
        ContentType: 'application/json',
      }),
    );
  }

  async putPart(
    workspace: string,
    day: string,
    firstSeq: number,
    lines: readonly string[],
  ): Promise<'written' | 'exists'> {
    return this.putOnce(
      this.key(workspace, day, partName(firstSeq)),
      joinLines(lines),
      'application/x-ndjson',
    );
  }

  async listParts(workspace: string, day: string): Promise<number[]> {
    const prefix = this.key(workspace, day, PART_PREFIX);
    const keys = await this.list(prefix);
    return keys
      .map((k) => partSeq(k.slice(this.key(workspace, day, '').length)))
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
  }

  async readPart(workspace: string, day: string, firstSeq: number): Promise<string[]> {
    const key = this.key(workspace, day, partName(firstSeq));
    const raw = await this.getOrNull(key);
    if (raw === null) throw new Error(`no part s3://${this.bucket}/${key}`);
    return splitLines(raw);
  }

  async readManifest(workspace: string, day: string): Promise<SegmentManifest | null> {
    const raw = await this.getOrNull(this.key(workspace, day, MANIFEST_NAME));
    return raw === null ? null : (JSON.parse(raw) as SegmentManifest);
  }

  async putManifest(workspace: string, day: string, manifest: SegmentManifest): Promise<void> {
    const outcome = await this.putOnce(
      this.key(workspace, day, MANIFEST_NAME),
      JSON.stringify(manifest),
      'application/json',
    );
    if (outcome === 'exists') throw new Error(`${workspace}/${day} is already sealed`);
  }

  async listDays(workspace: string): Promise<string[]> {
    const prefix = this.key(workspace, '');
    const dirs = await this.listCommonPrefixes(prefix);
    return dirs.filter((d) => DAY.test(d)).sort();
  }

  async listWorkspaces(): Promise<string[]> {
    const dirs = await this.listCommonPrefixes(this.prefix);
    return dirs.filter((d) => d.startsWith('ws-')).sort();
  }

  private async putOnce(key: string, body: string, contentType: string): Promise<'written' | 'exists'> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          IfNoneMatch: '*',
        }),
      );
      return 'written';
    } catch (error) {
      if (isPreconditionFailed(error)) return 'exists';
      throw error;
    }
  }

  private async getOrNull(key: string): Promise<string | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return out.Body ? await out.Body.transformToString('utf8') : '';
    } catch (error) {
      if (isNoSuchKey(error)) return null;
      throw error;
    }
  }

  /** Every key under `prefix`, following continuation tokens. */
  private async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const out = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of out.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  /** The immediate "directories" under `prefix`, without the prefix or the trailing slash. */
  private async listCommonPrefixes(prefix: string): Promise<string[]> {
    const dirs: string[] = [];
    let token: string | undefined;
    do {
      const out = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          Delimiter: '/',
          ContinuationToken: token,
        }),
      );
      for (const p of out.CommonPrefixes ?? []) {
        if (p.Prefix) dirs.push(p.Prefix.slice(prefix.length).replace(/\/$/, ''));
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return dirs;
  }
}

function isPreconditionFailed(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'PreconditionFailed' || e?.$metadata?.httpStatusCode === 412;
}

function isNoSuchKey(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}
