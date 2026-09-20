/**
 * The store contract against a real bucket — S3, or anything S3-compatible with conditional
 * writes (MinIO). Skipped unless SPINE_S3_TEST_BUCKET names one; credentials and endpoint come
 * from the usual AWS environment (AWS_PROFILE, AWS_ENDPOINT_URL_S3, …). Writes under a random
 * prefix and leaves it: a bucket with Object Lock would refuse the clean-up anyway.
 *
 *   SPINE_S3_TEST_BUCKET=my-test-bucket npm test -- s3.live
 */

import { randomUUID } from 'node:crypto';
import { describe } from 'vitest';
import { S3Archive } from '../src/archive/s3.js';
import { storeContract } from './store-contract.js';

const bucket = process.env.SPINE_S3_TEST_BUCKET;

describe.skipIf(!bucket)('S3 (live)', () => {
  storeContract('live bucket', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Archive({
      bucket: bucket!,
      prefix: `spine-test/${randomUUID()}`,
      client: new S3Client({ forcePathStyle: Boolean(process.env.AWS_ENDPOINT_URL_S3) }),
    });
  });
});
