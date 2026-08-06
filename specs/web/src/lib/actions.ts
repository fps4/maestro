import 'server-only';

/**
 * Server actions that write.
 *
 * Separate from `api.ts`, which only reads: a write needs the acting principal's token and returns
 * an id the caller redirects to, and mixing the two would make it easy to call a mutation from a
 * render.
 */

import { currentToken, currentWorkspace } from './auth';

const BASE = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8020';

export class WriteRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const token = await currentToken();
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new WriteRefused(response.status, payload.message ?? 'The write was refused.');
  return payload as T;
}

export async function createDraft(input: { type: string; title: string }): Promise<string> {
  const workspace = await currentWorkspace();
  const { draft } = await post<{ draft: { id: string } }>(`/v1/workspaces/${workspace}/drafts`, input);
  return draft.id;
}
