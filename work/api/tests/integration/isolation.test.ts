/**
 * The adversarial isolation test (maestro build-standards): acquire workspace A's handle, attempt
 * B's data, assert failure — at the membership, and underneath it, at the key.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bind } from '../../src/db/handle.js';
import { IsolationViolation } from '../../src/db/items.js';
import { workspaceKeys } from '../../src/db/keys.js';
import { bearer, harness, registerWorkspace, type Harness } from './helpers.js';

const ALICE = 'prn-h-alice';
const BOB = 'prn-h-bob';

describe('workspace isolation', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness('isolation');
    await registerWorkspace(h.app, 'tenant-a', [{ principal: ALICE, roles: ['operations'] }]);
    await registerWorkspace(h.app, 'tenant-b', [{ principal: BOB, roles: ['operations'] }]);
  });
  afterAll(async () => h.close());

  it('serves a member their own workspace', async () => {
    const res = await h.app.server.inject({
      method: 'GET',
      url: '/v1/workspaces/tenant-a/me',
      headers: bearer(ALICE),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      workspace: 'tenant-a',
      principal: ALICE,
      kind: 'human',
      roles: ['operations'],
    });
  });

  it('refuses a member of A in B, before a handle serves anything', async () => {
    const res = await h.app.server.inject({
      method: 'GET',
      url: '/v1/workspaces/tenant-b/me',
      headers: bearer(ALICE),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('not a member of `tenant-b`');
  });

  it('answers an unknown workspace with 404, not an empty one', async () => {
    const res = await h.app.server.inject({
      method: 'GET',
      url: '/v1/workspaces/tenant-c/me',
      headers: bearer(ALICE),
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses B's exact key through A's item access, for the table and for an index", async () => {
    const a = bind(h.app.store.doc, h.app.store.table, 'tenant-a');
    const b = workspaceKeys('tenant-b');
    await expect(a.items.get(b.membership(BOB))).rejects.toBeInstanceOf(IsolationViolation);
    await expect(a.items.query(b.open, { index: 'gsi1' })).rejects.toBeInstanceOf(IsolationViolation);
    await expect(
      a.items.put({ ...a.keys.item('wrk-1'), ...b.openKey('2026-09-25T08:00:00Z', 'wrk-1') }),
    ).rejects.toBeInstanceOf(IsolationViolation);
  });

  it('refuses a token with no principal id', async () => {
    const res = await h.app.server.inject({
      method: 'GET',
      url: '/v1/workspaces/tenant-a/me',
      headers: { authorization: 'Bearer dev:alice' },
    });
    expect(res.statusCode).toBe(401);
  });
});
