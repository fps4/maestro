import 'server-only';

/**
 * Reads and writes against work-service, server-side, with the signed-in person's token.
 *
 * Its own base URL: the console reaches each component's API directly and no component reads
 * another's data through it (ADR-0023). One token serves both, because identity-service mints one
 * audience for the deployment. A console with no work-service configured renders its work pages as
 * "not connected" rather than failing, since a deployment may run specs-service alone.
 */

import { AUTH_MODE } from './session';
import { currentToken, currentWorkspace } from './auth';
import type { Blocking, Board, FrontierRow, ItemView, Rates, Today } from './work-types';

const BASE = process.env.WORK_API_PROXY_TARGET ?? (AUTH_MODE === 'dev' ? 'http://127.0.0.1:8041' : '');

/** work-service's development verifier reads `dev:<prn>[:roles]`; specs-service's dev token is another shape. */
const DEV_TOKEN = process.env.WORK_DEV_TOKEN ?? 'dev:prn-h-demo-owner:owner,operations';

export class WorkError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'WorkError';
  }
}

export const workConfigured = (): boolean => BASE !== '';

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!BASE) throw new WorkError(503, 'work-service is not connected to this console.');
  const token = AUTH_MODE === 'dev' ? DEV_TOKEN : await currentToken();
  let response: Response;
  try {
    response = await fetch(`${BASE}/v1/workspaces/${await currentWorkspace()}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new WorkError(502, 'work-service is not reachable right now.');
  }
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok)
    throw new WorkError(response.status, payload.message ?? `${response.status} from ${path}`);
  return payload as T;
}

const query = (params: Record<string, string | undefined>): string => {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return q.size ? `?${q}` : '';
};

export const fetchToday = (): Promise<Today> => call('GET', '/today');

export async function fetchFrontier(
  filter: { for?: string; application?: string } = {},
): Promise<FrontierRow[]> {
  return (await call<{ rows: FrontierRow[] }>('GET', `/frontier${query(filter)}`)).rows;
}

export const fetchBoard = (filter: { application?: string } = {}): Promise<Board> =>
  call('GET', `/board${query(filter)}`);

export const fetchItem = (id: string): Promise<ItemView> => call('GET', `/items/${encodeURIComponent(id)}`);

export const fetchBlocking = (id: string): Promise<Blocking> =>
  call('GET', `/items/${encodeURIComponent(id)}/blocking`);

export const fetchRates = (application: string): Promise<Rates> =>
  call('GET', `/rates${query({ application })}`);

export type ClaimResult = { result: 'claimed' } | { result: 'refused'; check: string; sentence: string };

export const claimItem = (id: string): Promise<ClaimResult> =>
  call('POST', `/items/${encodeURIComponent(id)}/claim`);

export const releaseItem = (id: string): Promise<unknown> =>
  call('POST', `/items/${encodeURIComponent(id)}/release`);

export const moveItem = (id: string, state: 'in_progress' | 'blocked'): Promise<unknown> =>
  call('POST', `/items/${encodeURIComponent(id)}/transition`, { state });

export const resolveItem = (id: string, outcome: string, reason?: string): Promise<unknown> =>
  call('POST', `/items/${encodeURIComponent(id)}/resolve`, { outcome, ...(reason ? { reason } : {}) });

export const linkPullRequest = (id: string, pullRequest: string): Promise<unknown> =>
  call('POST', `/items/${encodeURIComponent(id)}/link`, { pull_request: pullRequest });

/** Who work-service takes the signed-in person to be here. */
export const fetchMe = (): Promise<{ principal: string; kind: string; roles: string[] }> =>
  call('GET', '/me');
