/**
 * The Fastify bridge for MCP.
 *
 * Streamable HTTP, stateless: each POST carries one JSON-RPC message and is answered on the same
 * response. A stateless transport suits a governed service — there is no session to hold authority
 * across, and every call re-resolves the caller's principal, workspace and roles from the token it
 * carries.
 *
 * The tool list comes from `handler.ts` and contains no decision tool. This file does not import
 * `DecisionService`, and that absence is the guarantee (ADR-0005).
 */

import type { FastifyInstance } from 'fastify';
import { zodToJsonSchema } from './schema.js';
import { buildContext } from '../auth/context.js';
import { Unauthenticated } from '../auth/verify.js';
import { TOOLS, callTool } from './handler.js';
import type { RouteDeps } from '../http/routes.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = '2025-06-18';

export async function registerMcp(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  // Unset in every deployment that does not expose an MCP endpoint. Setting it publishes the
  // discovery document *and* accepts a token bound to that resource, so the URL is configured once.
  if (!deps.config.MCP_RESOURCE_URL && deps.config.isProduction) return;

  app.post<{ Params: { ws: string }; Body: JsonRpcRequest }>(
    '/v1/workspaces/:ws/mcp',
    async (request, reply) => {
      const message = request.body;
      const id = message?.id ?? null;

      const respond = (result: unknown) => reply.send({ jsonrpc: '2.0', id, result });
      const fail = (code: number, error: string) =>
        reply.send({ jsonrpc: '2.0', id, error: { code, message: error } });

      try {
        switch (message.method) {
          case 'initialize':
            return respond({
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: 'maestro-specs', version: '0.1.0' },
              instructions:
                'A governed specification service. You may read anything in this workspace, read the shared standards catalogue, edit drafts and propose versions. ' +
                'You cannot decide at a gate — no tool here does, by design. Facets you write are marked `extracted` and attributed to you; a named human must confirm them before they can reach a gate.',
            });

          case 'notifications/initialized':
            return reply.code(202).send();

          case 'tools/list':
            return respond({
              tools: TOOLS.map((tool) => ({
                name: tool.name,
                title: tool.title,
                description: tool.description,
                inputSchema: zodToJsonSchema(tool.inputSchema),
              })),
            });

          case 'tools/call': {
            const name = String(message.params?.name ?? '');
            const args = (message.params?.arguments as unknown) ?? {};

            const header = request.headers.authorization;
            if (!header?.startsWith('Bearer '))
              throw new Unauthenticated('This endpoint needs a bearer token.');
            const token = await deps.verifier.verify(header.slice('Bearer '.length));
            const context = await buildContext(deps, token, request.params.ws);

            const result = await callTool(name, context, args);
            return respond({
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              structuredContent: result,
            });
          }

          default:
            return fail(-32601, `Method not found: ${message.method}`);
        }
      } catch (error) {
        const err = error as Error;
        request.log.warn({ msg: 'mcp call failed', method: message?.method, err: err.message });
        // Tool failures are reported as results with `isError`, not as protocol errors — the model
        // needs to read the refusal and act on it, and a transport error is not shown to it.
        if (message?.method === 'tools/call') {
          return reply.send({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: err.message }], isError: true },
          });
        }
        return fail(-32603, err.message);
      }
    },
  );
}
