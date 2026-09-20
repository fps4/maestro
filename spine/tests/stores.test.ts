import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsArchive } from '../src/archive/fs.js';
import { MemoryArchive } from '../src/archive/memory.js';
import { S3Archive } from '../src/archive/s3.js';
import { FakeS3 } from './fakes.js';
import { storeContract } from './store-contract.js';
import { WS } from './helpers.js';

storeContract('memory', async () => new MemoryArchive());
storeContract('filesystem', async () => new FsArchive(await mkdtemp(join(tmpdir(), 'spine-'))));
storeContract('S3 (fake)', async () => new S3Archive({ bucket: 'b', client: new FakeS3() }));
storeContract(
  'S3 (fake, prefixed)',
  async () => new S3Archive({ bucket: 'b', prefix: 'tenant-a/', client: new FakeS3() }),
);

describe('the S3 adapter', () => {
  it('lays keys out under the prefix exactly as the filesystem adapter lays out paths', async () => {
    const fake = new FakeS3();
    const s = new S3Archive({ bucket: 'b', prefix: 'tenant-a', client: fake });
    await s.putPart(WS, '2026-09-18', 1, ['a']);
    await s.writeHead(WS, { last_seq: 1, day: '2026-09-18' });
    expect([...fake.objects.keys()].sort()).toEqual([
      `tenant-a/${WS}/2026-09-18/events-000000000001.jsonl`,
      `tenant-a/${WS}/head.json`,
    ]);
    expect(fake.objects.get(`tenant-a/${WS}/2026-09-18/events-000000000001.jsonl`)).toBe('a\n');
  });

  it('follows continuation tokens rather than trusting one page', async () => {
    const fake = new FakeS3();
    fake.pageSize = 1;
    const s = new S3Archive({ bucket: 'b', client: fake });
    for (const first of [1, 2, 3, 4, 5]) await s.putPart(WS, '2026-09-18', first, ['x']);
    fake.calls = 0;
    expect(await s.listParts(WS, '2026-09-18')).toEqual([1, 2, 3, 4, 5]);
    expect(fake.calls).toBeGreaterThan(1);
  });

  it('throws on a missing part rather than returning an empty day', async () => {
    const s = new S3Archive({ bucket: 'b', client: new FakeS3() });
    await expect(s.readPart(WS, '2026-09-18', 1)).rejects.toThrow(/no part/);
  });
});
