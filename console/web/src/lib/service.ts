import 'server-only';

/**
 * A component's HTTP API, called server-side with the signed-in person's token: work-service's and
 * runtime-service's clients are this, with their own base URL and development token.
 *
 * The console reaches each component's API directly and no component reads another's data through it
 * (ADR-0023). One token serves them all, because identity-service mints one audience for the
 * deployment. A component the console is not connected to answers as "not connected" rather than
 * failing, since a deployment may run without it.
 */

import { AUTH_MODE } from './session';
import { currentToken, currentWorkspace } from './auth';

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export type Caller = <T>(method: 'GET' | 'POST', path: string, body?: unknown) => Promise<T>;

export function serviceCaller(service: { name: string; base: string; devToken: string }): Caller {
  return async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!service.base) throw new ServiceError(503, `${service.name} is not connected to this console.`);
    const token = AUTH_MODE === 'dev' ? service.devToken : await currentToken();
    let response: Response;
    try {
      response = await fetch(`${service.base}/v1/workspaces/${await currentWorkspace()}${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new ServiceError(502, `${service.name} is not reachable right now.`);
    }
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      throw new ServiceError(response.status, payload.message ?? `${response.status} from ${path}`);
    }
    return payload as T;
  };
}

export const query = (params: Record<string, string | undefined>): string => {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return q.size ? `?${q}` : '';
};
