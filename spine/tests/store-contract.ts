import { describe, expect, it } from 'vitest';
import type { ArchiveStore } from '../src/archive/port.js';
import { eventLine, seal } from '../src/domain/segment.js';
import { WS, event } from './helpers.js';

/**
 * The store contract, run against every adapter. What `append`, `sealDay` and `verifyRange` rely
 * on: write-once parts and manifests, a mutable head, listings in order.
 */
export function storeContract(name: string, make: () => Promise<ArchiveStore>) {
  describe(`${name} store`, () => {
    it('has no head until one is written, then the latest', async () => {
      const s = await make();
      expect(await s.readHead(WS)).toBeNull();
      await s.writeHead(WS, { last_seq: 3, day: '2026-09-18' });
      await s.writeHead(WS, { last_seq: 7, day: '2026-09-19' });
      expect(await s.readHead(WS)).toEqual({ last_seq: 7, day: '2026-09-19' });
    });

    it('writes a part once and reports a second write as exists, unchanged', async () => {
      const s = await make();
      expect(await s.putPart(WS, '2026-09-18', 1, ['a', 'b'])).toBe('written');
      expect(await s.putPart(WS, '2026-09-18', 1, ['x'])).toBe('exists');
      expect(await s.readPart(WS, '2026-09-18', 1)).toEqual(['a', 'b']);
    });

    it('lists parts by first sequence, ascending, across pages', async () => {
      const s = await make();
      for (const first of [300, 1, 20, 4000, 150]) await s.putPart(WS, '2026-09-18', first, [`s${first}`]);
      await s.writeHead(WS, { last_seq: 4000, day: '2026-09-18' });
      expect(await s.listParts(WS, '2026-09-18')).toEqual([1, 20, 150, 300, 4000]);
      expect(await s.listParts(WS, '2026-09-17')).toEqual([]);
    });

    it('writes a manifest once and refuses a second', async () => {
      const s = await make();
      const line = eventLine(event(1));
      const m = seal({
        workspace_id: WS,
        period: '2026-09-18',
        lines: [line],
        previous: null,
        sealed_at: 'x',
      });
      expect(await s.readManifest(WS, '2026-09-18')).toBeNull();
      await s.putManifest(WS, '2026-09-18', m);
      expect(await s.readManifest(WS, '2026-09-18')).toEqual(m);
      await expect(s.putManifest(WS, '2026-09-18', m)).rejects.toThrow(/already sealed/);
    });

    it('lists days and workspaces in order, ignoring the head', async () => {
      const s = await make();
      await s.putPart(WS, '2026-09-19', 5, ['e']);
      await s.putPart(WS, '2026-09-17', 1, ['a']);
      await s.putPart(WS, '2026-09-18', 3, ['c']);
      await s.writeHead(WS, { last_seq: 5, day: '2026-09-19' });
      await s.putPart('ws-other', '2026-09-18', 1, ['z']);
      expect(await s.listDays(WS)).toEqual(['2026-09-17', '2026-09-18', '2026-09-19']);
      expect(await s.listDays('ws-nobody')).toEqual([]);
      expect(await s.listWorkspaces()).toEqual([WS, 'ws-other']);
    });
  });
}
