/**
 * Object storage is on when `S3_BUCKET` is set — not when an endpoint is. On AWS the deployment
 * leaves `S3_ENDPOINT` unset and the SDK's default endpoint for the region applies; locally
 * `S3_ENDPOINT` names MinIO. The payload store's bucket defaults to the attachments' and is
 * required whenever the store is S3.
 */

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createS3 } from '../../src/services/attachments.js';

const env = (overrides: Record<string, string>) =>
  loadConfig({ SPECS_ENV: 'ci', TABLE_NAME: 'specs', ...overrides } as NodeJS.ProcessEnv);

describe('the S3 client gate', () => {
  it('is off without a bucket, whatever else is set', () => {
    expect(createS3(env({}))).toBeNull();
    expect(createS3(env({ S3_ENDPOINT: 'http://minio:9000' }))).toBeNull();
  });

  it('is on with a bucket and no endpoint: the SDK’s default endpoint for the region (AWS)', async () => {
    const client = createS3(
      env({ S3_BUCKET: 'specs-store', S3_REGION: 'eu-west-1', S3_FORCE_PATH_STYLE: 'false' }),
    )!;
    expect(client).not.toBeNull();
    expect(await client.config.region()).toBe('eu-west-1');
    expect(client.config.forcePathStyle).toBe(false);
    expect(client.config.endpoint).toBeUndefined();
    client.destroy();
  });

  it('is on with a bucket and an endpoint: MinIO, path-style, static credentials', async () => {
    const client = createS3(
      env({
        S3_BUCKET: 'mstr-specs',
        S3_ENDPOINT: 'http://minio:9000',
        S3_ACCESS_KEY: 'minio',
        S3_SECRET_KEY: 'minio-secret',
      }),
    )!;
    expect(client).not.toBeNull();
    const endpoint = await client.config.endpoint!();
    expect(`${endpoint.protocol}//${endpoint.hostname}:${endpoint.port}`).toBe('http://minio:9000');
    expect(client.config.forcePathStyle).toBe(true);
    const credentials = await client.config.credentials();
    expect(credentials.accessKeyId).toBe('minio');
    client.destroy();
  });
});

describe('the payload bucket', () => {
  it('defaults to the attachments bucket, and the store follows the sink', () => {
    const local = env({ RECORD_SINK: 'local' });
    expect(local.PAYLOAD_STORE).toBe('local');
    expect(local.PAYLOAD_BUCKET).toBeUndefined();

    const aws = env({ RECORD_SINK: 'off', S3_BUCKET: 'specs-store' });
    expect(aws.PAYLOAD_STORE).toBe('s3');
    expect(aws.PAYLOAD_BUCKET).toBe('specs-store');
    expect(aws.PAYLOAD_PREFIX).toBe('payloads');

    const named = env({ RECORD_SINK: 'off', S3_BUCKET: 'specs-store', PAYLOAD_BUCKET: 'specs-payloads' });
    expect(named.PAYLOAD_BUCKET).toBe('specs-payloads');
  });

  it('is required whenever the store is S3, by name or by default', () => {
    expect(() => env({ RECORD_SINK: 'off' })).toThrow(
      /PAYLOAD_STORE=s3 \(the default under RECORD_SINK=off\) requires PAYLOAD_BUCKET/,
    );
    expect(() => env({ PAYLOAD_STORE: 's3' })).toThrow(/PAYLOAD_STORE=s3 requires PAYLOAD_BUCKET/);
    expect(env({ PAYLOAD_STORE: 'local', RECORD_SINK: 'off' }).PAYLOAD_STORE).toBe('local');
  });
});
