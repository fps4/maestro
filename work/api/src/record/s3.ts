import { S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../config.js';

/** The S3 client the configuration describes: MinIO locally, the runtime's role on AWS. */
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
