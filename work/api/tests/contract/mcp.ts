/**
 * The tracker contract bound to an MCP server: each operation one `tools/call` of the tool of the same
 * name, the answer its `structuredContent`, a tool error a `TrackerRefusal` with its text. This is all
 * a skill needs to know about the transport.
 */

import { TrackerRefusal, type Tracker } from './tracker.js';

/** Send one JSON-RPC message as a principal; resolve with the response body. */
export type Send = (principal: string, message: unknown) => Promise<{ result?: unknown; error?: unknown }>;

export function mcpTracker(send: Send, principal: string): Tracker {
  let id = 0;
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await send(principal, {
      jsonrpc: '2.0',
      id: ++id,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    if (res.error) throw new Error(`MCP error: ${JSON.stringify(res.error)}`);
    const result = res.result as {
      isError?: boolean;
      structuredContent?: unknown;
      content: { text: string }[];
    };
    if (result.isError) throw new TrackerRefusal(result.content.map((c) => c.text).join('\n'));
    return result.structuredContent as never;
  };
  return {
    publish: (input) => call('publish', input),
    fetch: (item) => call('fetch', { item }),
    claim: (item) => call('claim', { item }),
    resolve: (item, outcome, reason) => call('resolve', { item, outcome, ...(reason ? { reason } : {}) }),
    frontier: (q = {}) => call('frontier', q),
    blocking: (item) => call('blocking', { item }),
  };
}
