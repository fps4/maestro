/**
 * M2 build gate 6: a skill written against the tracker contract runs its acceptance suite green
 * against the MCP server. The suite (`tests/contract/tracker.ts`) knows the six operations and
 * nothing else; here it is bound to `POST /v1/workspaces/:ws/mcp` on the demo workspace.
 *
 * Beside it, what the transport itself owes a client: the handshake, a tool list whose schemas a
 * client can build calls from, and a 401 that points at the resource's metadata.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mcpTracker, type Send } from '../contract/mcp.js';
import { trackerAcceptance } from '../contract/tracker.js';
import { bearer, demoWorkspace, harness, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const ALICE = 'prn-h-alice';
const BOB = 'prn-h-bob';
const OWNER = 'prn-h-demo-owner';
const AGENT = 'prn-a-remed';

let h: Harness;
const send: Send = async (principal, message) => {
  const res = await h.app.server.inject({
    method: 'POST',
    url: `/v1/workspaces/${WS}/mcp`,
    headers: bearer(principal),
    payload: message as object,
  });
  return res.json();
};

beforeAll(async () => {
  h = await harness('tracker', '2026-09-25T08:00:00Z', {
    env: { MCP_RESOURCE_URL: 'https://work.example.test/v1/workspaces/aannemer-x/mcp' },
  });
  await demoWorkspace(h.app, [
    { principal: ALICE, roles: ['operations'] },
    { principal: BOB, roles: ['operations'] },
    { principal: OWNER, roles: ['owner', 'operations'] },
    { principal: AGENT, roles: ['operations'], accountable: ALICE },
  ]);
});
afterAll(async () => h.close());

trackerAcceptance('work-service over MCP', () => ({
  as: (principal) => mcpTracker(send, principal),
  person: ALICE,
  other: BOB,
  agent: AGENT,
  owner: OWNER,
  governed: { application: 'app1', environment: 'prod' },
  operated: { application: 'app2' },
}));

describe('the MCP transport', () => {
  it('initializes, and lists the contract with a schema for each tool', async () => {
    const init = await send(ALICE, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(init.result).toMatchObject({ serverInfo: { name: 'maestro-work' }, capabilities: { tools: {} } });

    const list = (await send(ALICE, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).result as {
      tools: Array<{ name: string; inputSchema: { type: string; properties: Record<string, unknown> } }>;
    };
    const names = list.tools.map((t) => t.name);
    for (const op of ['publish', 'fetch', 'claim', 'resolve', 'frontier', 'blocking'])
      expect(names).toContain(op);
    const publish = list.tools.find((t) => t.name === 'publish')!;
    expect(publish.inputSchema).toMatchObject({ type: 'object', required: ['class', 'title'] });
    expect(Object.keys(publish.inputSchema.properties)).not.toContain('severity');
    const link = list.tools.find((t) => t.name === 'link')!;
    expect(Object.keys(link.inputSchema.properties)).toEqual(['item', 'pull_request', 'artifact']);
  });

  it('answers a tool call without a token 401, pointing at the resource metadata', async () => {
    const res = await h.app.server.inject({
      method: 'POST',
      url: `/v1/workspaces/${WS}/mcp`,
      payload: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'frontier', arguments: {} } },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="https://work.example.test/.well-known/oauth-protected-resource"',
    );
    const meta = await h.app.server.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' });
    expect(meta.json()).toMatchObject({ resource: 'https://work.example.test/v1/workspaces/aannemer-x/mcp' });
  });

  it('refuses a non-member as a tool error, not a transport error', async () => {
    const res = await send('prn-h-stranger', {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'frontier', arguments: {} },
    });
    expect(res.result).toMatchObject({ isError: true });
  });

  it('names an unknown tool', async () => {
    const res = await send(ALICE, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'accept' },
    });
    expect(res.result).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining('No tool `accept`') }],
    });
  });
});
