import 'server-only';

/** Reads and writes against work-service (its client: `service.ts`). */

import { AUTH_MODE } from './session';
import { query, serviceCaller, ServiceError } from './service';
import type { Blocking, Board, FrontierRow, HistoryEntry, ItemView, Rates, Today } from './work-types';

/** A work-service error: the service's own, by name, for the pages that catch it. */
export { ServiceError as WorkError };

const call = serviceCaller({
  name: 'work-service',
  base: process.env.WORK_API_PROXY_TARGET ?? (AUTH_MODE === 'dev' ? 'http://127.0.0.1:8041' : ''),
  // work-service's development verifier reads `dev:<prn>[:roles]`; specs-service's dev token is another shape.
  devToken: process.env.WORK_DEV_TOKEN ?? 'dev:prn-h-demo-owner:owner,operations',
});

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

export const fetchHistory = (id: string): Promise<{ item_id: string; events: HistoryEntry[] }> =>
  call('GET', `/items/${encodeURIComponent(id)}/history`);
