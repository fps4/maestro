import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('configuration', () => {
  it('needs a table', () => {
    expect(() => loadConfig({})).toThrow(/TABLE_NAME/);
  });
  it('refuses dev auth in production', () => {
    expect(() => loadConfig({ TABLE_NAME: 't', NODE_ENV: 'production' })).toThrow(/AUTH_MODE=dev/);
  });
  it('asks for a payload bucket when the sink is not local', () => {
    expect(() => loadConfig({ TABLE_NAME: 't', RECORD_SINK: 'off' })).toThrow(/PAYLOAD_BUCKET/);
    expect(loadConfig({ TABLE_NAME: 't', RECORD_SINK: 'off', S3_BUCKET: 'b' }).PAYLOAD_STORE).toBe('s3');
  });
});
