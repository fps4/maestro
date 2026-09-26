/**
 * The Fastify bridge for MCP: `POST /v1/workspaces/:ws/mcp`.
 *
 * Streamable HTTP, stateless: each POST carries one JSON-RPC message and is answered on the same
 * response. There is no session to hold authority across — every tool call resolves the caller's
 * principal, membership and roles from the token it carries, as an HTTP request does. The same
 * shape as specs-service's bridge; not shared, since the services share published contracts only.
 */

import type { FastifyInstance } from 'fastify';
import { buildContext } from '../auth/context.js';
import { Unauthenticated } from '../auth/verify.js';
import { statusOf } from '../http/errors.js';
import type { RouteDeps } from '../http/routes.js';
import type { WorkItemService } from '../services/work-items.js';
import { buildTools, callTool } from './handler.js';
import { zodToJsonSchema } from './schema.js';
import { ZodError } from 'zod';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = '2025-06-18';

export async function registerMcp(
  app: FastifyInstance,
  deps: RouteDeps,
  items: WorkItemService,
): Promise<void> {
  // Unset in a deployment that exposes no MCP endpoint. Setting it publishes the discovery document
  // and accepts a token bound to that resource, so the URL is configured once.
  if (!deps.config.MCP_RESOURCE_URL && deps.config.isProduction) return;
  const tools = buildTools(items);

  app.post<{ Params: { ws: string }; Body: JsonRpcRequest }>(
    '/v1/workspaces/:ws/mcp',
    async (request, reply) => {
      const message = request.body;
      const id = message?.id ?? null;
      const respond = (result: unknown) => reply.send({ jsonrpc: '2.0', id, result });
      const fail = (code: number, error: string) =>
        reply.send({ jsonrpc: '2.0', id, error: { code, message: error } });

      try {
        switch (message?.method) {
          case 'initialize':
            return respond({
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: 'maestro-work', version: '0.1.0' },
              instructions:
                'The tracker for this workspace: who owes what, by when, under whose authority. Find work with `frontier`, read it with `fetch`, take it with `claim`, finish it with `resolve`. ' +
                'Authority is checked when you claim, and a refusal is an answer, not an error. Severity, clocks and the accountable human are resolved by the service — you cannot set them. ' +
                'An item closes `done` on evidence (a merge, a deploy, an all-clear), not on your word alone.',
            });

          case 'notifications/initialized':
            return reply.code(202).send();

          case 'ping':
            return respond({});

          case 'tools/list':
            return respond({
              tools: tools.map((tool) => ({
                name: tool.name,
                title: tool.title,
                description: tool.description,
                inputSchema: zodToJsonSchema(tool.inputSchema),
              })),
            });

          case 'tools/call': {
            const header = request.headers.authorization;
            if (!header?.startsWith('Bearer '))
              throw new Unauthenticated('This endpoint needs a bearer token.');
            const token = await deps.verifier.verify(header.slice('Bearer '.length));
            const ctx = await buildContext(deps, token, request.params.ws);
            const result = await callTool(
              tools,
              String(message.params?.name ?? ''),
              ctx,
              (message.params?.arguments as unknown) ?? {},
            );
            return respond({
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              structuredContent: result,
            });
          }

          default:
            return fail(-32601, `Method not found: ${message?.method}`);
        }
      } catch (error) {
        // No token, or one that does not verify: the transport's answer, so a client can go and get one.
        if (error instanceof Unauthenticated) {
          if (deps.config.MCP_RESOURCE_URL) {
            void reply.header(
              'www-authenticate',
              `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource', deps.config.MCP_RESOURCE_URL).href}"`,
            );
          }
          return reply
            .code(401)
            .send({ jsonrpc: '2.0', id, error: { code: -32001, message: error.message } });
        }
        const failed = statusOf(error) >= 500;
        const text =
          error instanceof ZodError
            ? error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
            : failed
              ? 'The service failed; the log has the detail.'
              : (error as Error).message;
        if (failed) request.log.error({ msg: 'mcp call failed', method: message?.method, err: error });
        else request.log.warn({ msg: 'mcp call refused', method: message?.method, err: text });
        // A tool's failure is a result with `isError`, not a protocol error: the model has to read the
        // refusal to act on it, and a transport error is not shown to it.
        if (message?.method === 'tools/call') {
          return reply.send({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }], isError: true },
          });
        }
        return fail(-32603, text);
      }
    },
  );
}
