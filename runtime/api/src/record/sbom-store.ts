/**
 * The SBOM store (maestro ADR-0027 §2): a pipeline uploads the CycloneDX file of what it built under
 * `sbom/<application>/<digest>.cdx.json`, then puts `maestro.build` naming that key. This service
 * only reads it: once when the build is recorded, and again on a rebuild.
 *
 * Two adapters, the same split as the archive's: S3 for maestro's deployment, a directory for a
 * laptop and the tests. A key is refused unless it is under `sbom/<application>/`, so a build record
 * cannot point this service at another application's file, or outside the store.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';

export interface SbomStore {
  /** The parsed document the key names, for the application it must belong to. */
  get(application: string, key: string): Promise<unknown>;
}

export class SbomRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SbomRefused';
  }
}

/** The key a pipeline uses: one file per application and digest. */
export const sbomKey = (application: string, digest: string): string =>
  `sbom/${application}/${digest}.cdx.json`;

function assertUnder(application: string, key: string): void {
  if (!key.startsWith(`sbom/${application}/`) || key.includes('..')) {
    throw new SbomRefused(
      `\`${key}\` is not under sbom/${application}/: a build names its own application's SBOM.`,
    );
  }
}

export class FsSbomStore implements SbomStore {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  async get(application: string, key: string): Promise<unknown> {
    assertUnder(application, key);
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new SbomRefused(`\`${key}\` is outside the SBOM store.`);
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  }
}

export class S3SbomStore implements SbomStore {
  constructor(
    private readonly bucket: string,
    private readonly client: S3Client,
  ) {}

  async get(application: string, key: string): Promise<unknown> {
    assertUnder(application, key);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new SbomRefused(`s3://${this.bucket}/${key} has no body.`);
    return JSON.parse(await response.Body.transformToString('utf8')) as unknown;
  }
}
