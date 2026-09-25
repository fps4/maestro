/**
 * Errors → HTTP. A refusal is a sentence the caller can act on; the status says whose move it is.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { Forbidden } from '../auth/context.js';
import { Unauthenticated } from '../auth/verify.js';
import { ProjectionBehind, UnknownWorkspace } from '../db/client.js';
import { Conflict, IsolationViolation } from '../db/items.js';
import { DefinitionError } from '../domain/definition.js';
import { Refusal } from '../domain/decide.js';

/** Something the caller named does not exist in this workspace. */
export class NotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFound';
  }
}

/** The request is well-formed and the service will not do it — a rule, not a race. */
export class Refused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refused';
  }
}

export function statusOf(error: unknown): number {
  if (error instanceof ZodError) return 400;
  if (error instanceof Unauthenticated) return 401;
  if (error instanceof Forbidden || error instanceof IsolationViolation) return 403;
  if (error instanceof NotFound || error instanceof UnknownWorkspace) return 404;
  if (error instanceof Conflict) return 409;
  if (error instanceof Refused || error instanceof Refusal || error instanceof DefinitionError) return 422;
  if (error instanceof ProjectionBehind) return 503;
  const status = (error as FastifyError).statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : 500;
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  const status = statusOf(error);
  if (status >= 500) request.log.error({ err: error }, 'request failed');
  const body =
    error instanceof ZodError
      ? {
          error: 'invalid',
          issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        }
      : {
          error: error.name,
          message: status >= 500 ? 'The service failed; the log has the detail.' : error.message,
        };
  void reply.code(status).send(body);
}
