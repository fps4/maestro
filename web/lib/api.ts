// Server-side client for the orchestrator read API (S1, read-only — ADR-0018).
//
// SERVER-ONLY. Imported only from Server Components / route handlers so the browser never holds the
// API URL or the caller identity — the webapp is a thin renderer that calls this API and nothing else
// (ADR-0015). Do not import this from a 'use client' module.

import type { Product, SpecDetail, SpecsIndex } from '@/lib/types';

// `||` (not `??`): treat an empty env value — common in Docker/compose — as unset, not as a base URL.
const API_BASE = process.env.MAESTRO_API_URL || 'http://127.0.0.1:8800';

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

// S1 identity: a dev/stub forwarded as X-Maestro-Identity (ADR-0019). In production the Cloudflare
// Access + component-auth edge establishes the user; this is the seam where the webapp forwards that
// identity to the API. Until the auth slice, the local stub stands in.
function identity(): string | undefined {
  return process.env.MAESTRO_DEV_IDENTITY || undefined;
}

async function get<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const id = identity();
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
): Promise<SpecDetail> {
  const qs = branch ? `?branch=${encodeURIComponent(branch)}` : '';
  return get<SpecDetail>(
    `/api/products/${encodeURIComponent(productId)}/specs/${encodeURIComponent(feature)}/${encodeURIComponent(kind)}${qs}`,
  );
}
