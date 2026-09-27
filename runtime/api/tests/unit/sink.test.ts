import { describe, expect, it } from 'vitest';
import { WorkSignalSink } from '../../src/signals/sink.js';

const signal = {
  workspace: 'aannemer-x',
  application: 'app1',
  environment: 'prod',
  digest: `sha256:${'f'.repeat(64)}`,
  at: '2026-09-27T08:00:00Z',
  delivery: 'evt-1',
};

describe('the signal to work-service', () => {
  it('takes a client-credentials token once, and posts the envelope to the workspace’s intake', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/oauth2/token'))
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 900 }), { status: 200 });
      return new Response('{}', { status: 201 });
    }) as unknown as typeof fetch;
    const sink = new WorkSignalSink({
      workApiUrl: 'https://work.example/',
      tokenUrl: 'https://identity.example/oauth2/token',
      clientId: 'runtime-signals',
      clientSecret: 's3cret',
      fetch: fake,
    });

    expect(await sink.mismatch(signal)).toBe('delivered');
    expect(await sink.mismatch({ ...signal, delivery: 'evt-2' })).toBe('delivered');
    expect(calls.map((c) => c.url)).toEqual([
      'https://identity.example/oauth2/token',
      'https://work.example/v1/workspaces/aannemer-x/signals',
      'https://work.example/v1/workspaces/aannemer-x/signals',
    ]);
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[1]!.init.body as string)).toMatchObject({
      kind: 'digest_mismatch',
      fingerprint: `app1#prod#${signal.digest}`,
      delivery_id: 'evt-1',
    });
  });

  it('answers failed, and throws nothing, when work-service refuses', async () => {
    const fake = (async (url: string) =>
      url.endsWith('/token')
        ? new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
        : new Response('no', { status: 400 })) as unknown as typeof fetch;
    const sink = new WorkSignalSink({
      workApiUrl: 'https://work.example',
      tokenUrl: 'https://identity.example/token',
      clientId: 'c',
      clientSecret: 's',
      fetch: fake,
    });
    expect(await sink.mismatch(signal)).toBe('failed');
  });
});
