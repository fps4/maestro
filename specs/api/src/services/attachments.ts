/**
 * Attachments — content-addressed, in object storage.
 *
 * Everything that is not the body: images, PDFs, spreadsheets, diagrams. Stored under a
 * **prefix per workspace**, so object storage mirrors the database isolation rather than being the
 * one place a workspace boundary is a naming convention.
 *
 * An unchanged attachment across ten versions is stored once, because the key *is* the digest.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.js';
import { digestBytes } from '../domain/digest.js';
import { mintAttachmentId } from '../domain/ids.js';
import { parseSize, type TypeDeclaration } from '../domain/workspace-definition.js';
import type { AttachmentRef } from '../domain/types.js';
import { Refused } from './artifacts.js';

/**
 * The S3 client this deployment's `S3_*` configuration describes: MinIO when `S3_ENDPOINT` names
 * it, the SDK's default endpoint for `S3_REGION` when it does not (AWS), static credentials when
 * both keys are set and the runtime's own otherwise. Shared by attachments and the payload store.
 */
export function s3ClientFor(
  config: Pick<
    Config,
    'S3_ENDPOINT' | 'S3_REGION' | 'S3_FORCE_PATH_STYLE' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY'
  >,
): S3Client {
  return new S3Client({
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    ...(config.S3_ACCESS_KEY && config.S3_SECRET_KEY
      ? { credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY } }
      : {}),
  });
}

/** Object storage for attachments: on when `S3_BUCKET` is set, off — no client — when it is not. */
export function createS3(config: Config): S3Client | null {
  if (!config.S3_BUCKET) return null;
  return s3ClientFor(config);
}

export class AttachmentService {
  constructor(
    private readonly client: S3Client,
    private readonly config: Config,
    private readonly workspace: string,
  ) {}

  /**
   * Store bytes and return the reference a body may point at.
   *
   * The type's declared policy is enforced here rather than trusted: a 40MB video in a workspace
   * that permits 25MB images is refused at upload, which is the only moment refusing it is cheap.
   */
  async put(
    type: TypeDeclaration,
    file: { filename: string; media_type: string; bytes: Uint8Array },
  ): Promise<AttachmentRef> {
    const policy = type.attachments;
    if (!policy) {
      throw new Refused(`Type \`${type.id}\` declares no attachment policy, so it accepts none.`);
    }
    const max = parseSize(policy.max_size);
    if (file.bytes.byteLength > max) {
      throw new Refused(
        `\`${file.filename}\` is ${file.bytes.byteLength} bytes; \`${type.id}\` permits ${policy.max_size}.`,
      );
    }
    if (!mediaTypeAllowed(file.media_type, policy.media_types)) {
      throw new Refused(
        `\`${file.media_type}\` is not permitted on \`${type.id}\`. Permitted: ${policy.media_types.join(', ')}.`,
      );
    }

    const digest = digestBytes(file.bytes);
    const key = `${this.workspace}/att/${digest.replace('sha256:', '')}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        Body: file.bytes,
        ContentType: file.media_type,
      }),
    );

    return {
      id: mintAttachmentId(),
      filename: file.filename,
      media_type: file.media_type,
      size: file.bytes.byteLength,
      digest,
      key,
    };
  }
}

/** `image/*` in a policy matches `image/png`; anything else is an exact match. */
function mediaTypeAllowed(mediaType: string, allowed: string[]): boolean {
  return allowed.some((pattern) => {
    if (!pattern.endsWith('/*')) return pattern === mediaType;
    return mediaType.startsWith(pattern.slice(0, -1));
  });
}

const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Short-lived signed URLs for a set of keys.
 *
 * Deliberately a batch, resolved **before** rendering rather than during it. Rendering is a pure,
 * synchronous transformation of a body into HTML — reaching into an async signer from inside it
 * would either block the render or hand it a URL that is not ready yet, and the second failure is
 * silent: an image that renders as a broken link only for the first reader.
 *
 * The body never stores a raw storage URL. One baked into an immutable record outlives the
 * credential that made it work, and a record full of dead links is a record nobody trusts.
 */
export type UrlSigner = (keys: string[]) => Promise<Map<string, string>>;

export function signedUrlFactory(config: Config): UrlSigner | undefined {
  const client = createS3(config);
  if (!client) return undefined;

  const cache = new Map<string, { url: string; expires: number }>();

  return async (keys: string[]): Promise<Map<string, string>> => {
    const now = Date.now();
    const resolved = new Map<string, string>();
    const needed: string[] = [];

    for (const key of new Set(keys)) {
      const cached = cache.get(key);
      // Refresh with a margin, so a URL handed to a browser is never seconds from expiry.
      if (cached && cached.expires > now + 30_000) resolved.set(key, cached.url);
      else needed.push(key);
    }

    const signed = await Promise.all(
      needed.map(async (key) => {
        const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), {
          expiresIn: SIGNED_URL_TTL_SECONDS,
        });
        return [key, url] as const;
      }),
    );

    for (const [key, url] of signed) {
      cache.set(key, { url, expires: now + SIGNED_URL_TTL_SECONDS * 1000 });
      resolved.set(key, url);
    }

    return resolved;
  };
}
