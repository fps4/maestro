// Server-side client for the orchestrator read API (S1, read-only — ADR-0018).
//
// SERVER-ONLY. Imported only from Server Components / route handlers so the browser never holds the
// API URL or the caller identity — the webapp is a thin renderer that calls this API and nothing else
// (ADR-0015). Do not import this from a 'use client' module.

import { callerIdentity } from '@/lib/identity';
import type { Product, SpecDetail, SpecsIndex, TaskDetail } from '@/lib/types';

// `||` (not `??`): treat an empty env value — common in Docker/compose — as unset, not as a base URL.
export const API_BASE = process.env.MAESTRO_API_URL || 'http://127.0.0.1:8800';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function get<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const id = await callerIdentity();
  if (id) headers['X-Maestro-Identity'] = id;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers, cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'unreachable', `cannot reach the read API at ${API_BASE}`);
  }

  if (!res.ok) {
    let code = 'error';
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {
      /* non-JSON error body — keep the status text */
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

export function listProducts(): Promise<Product[]> {
  return get<Product[]>('/api/products');
}

export function listSpecs(
  productId: string,
  opts: { branch?: string; kind?: string; feature?: string } = {},
): Promise<SpecsIndex> {
  const qs = new URLSearchParams();
  for (const k of ['branch', 'kind', 'feature'] as const) {
    if (opts[k]) qs.set(k, opts[k]!);
  }
  const q = qs.toString();
  return get<SpecsIndex>(`/api/products/${encodeURIComponent(productId)}/specs${q ? `?${q}` : ''}`);
}

export function getSpec(
  productId: string,
  feature: string,
  kind: string,
  branch?: string,
  commit?: string,
): Promise<SpecDetail> {
  const qs = new URLSearchParams();
  if (branch) qs.set('branch', branch);
  if (commit) qs.set('commit', commit);
  const q = qs.toString();
  return get<SpecDetail>(
    `/api/products/${encodeURIComponent(productId)}/specs/${encodeURIComponent(feature)}/${encodeURIComponent(kind)}${q ? `?${q}` : ''}`,
  );
}

export function getTask(productId: string, taskId: string): Promise<TaskDetail> {
  return get<TaskDetail>(
    `/api/products/${encodeURIComponent(productId)}/tasks/${encodeURIComponent(taskId)}`,
  );
}

export interface ArtefactContent {
  contentType: string;
  text: string;
}

/**
 * Fetch a stored artefact's **content** for in-app rendering (US-0033 AC #3/#4).
 *
 * Server-side only: resolve the read API's artefact endpoint (which 302s to a short-TTL presigned
 * URL), then fetch the bytes from that URL here on the workspace server and hand the text to a
 * renderer. This keeps the caller identity server-side and dodges browser CORS on the store; the
 * bytes are rendered in-app, never proxied through the *orchestrator* (US-0033 AC #2 — the
 * orchestrator only minted the URL). Throws `ApiError` on 404 (absent / not a participant) or 503
 * (store unavailable / expired) so the viewer can show a retry (AC #7).
 */
export async function getArtefactContent(
  productId: string,
  key: string,
): Promise<ArtefactContent> {
  const keyPath = key.split('/').map(encodeURIComponent).join('/');
  const path = `/api/products/${encodeURIComponent(productId)}/artifacts/${keyPath}`;

  const headers: Record<string, string> = {};
  const id = await callerIdentity();
  if (id) headers['X-Maestro-Identity'] = id;

  // Step 1: ask the orchestrator for the presigned URL (it answers 302, never the bytes).
  let redirect: Response;
  try {
    redirect = await fetch(`${API_BASE}${path}`, {
      headers,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(503, 'degraded', `cannot reach the read API at ${API_BASE}`);
  }
  if (redirect.status === 404) throw new ApiError(404, 'not_found', 'artefact not found');
  if (redirect.status !== 302 && redirect.status !== 307) {
    throw new ApiError(503, 'degraded', 'artefact store unavailable');
  }
  const location = redirect.headers.get('location');
  if (!location) throw new ApiError(503, 'degraded', 'artefact store returned no location');

  // Step 2: follow the presigned URL to the bytes (server-side; identity stays here).
  let res: Response;
  try {
    res = await fetch(location, { cache: 'no-store' });
  } catch {
    throw new ApiError(503, 'degraded', 'artefact content fetch failed');
  }
  if (!res.ok) throw new ApiError(503, 'degraded', `artefact content fetch failed (${res.status})`);
  return {
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    text: await res.text(),
  };
}
