// Server-side write client for the orchestrator write API (S2/S3 + M1 dispatch).
//
// SERVER-ONLY. Imported only from Server Components / route handlers / server actions so the
// browser never holds the API URL or the caller identity — the webapp is a thin renderer that
// forwards the edge identity (ADR-0015 / ADR-0019). Do not import this from a `'use client'`
// module.
//
// Wire contract: docs/architecture/contracts/workspace-write-api.md.

import { API_BASE, ApiError } from '@/lib/api';
import { callerIdentity } from '@/lib/identity';
import type {
  CommentAnchor,
  CommentResponse,
  DecisionAction,
  DecisionResponse,
  DispatchResponse,
  GateType,
} from '@/lib/types';

// One header set per write. Idempotency-Key is per-request — the page mints it (form-submission id
// or crypto.randomUUID()) so a retry of the same intended action collapses to one event.
async function post<TResp>(
  path: string,
  body: unknown,
  opts: { idempotencyKey?: string; ifMatch?: number | string } = {},
): Promise<TResp> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const id = await callerIdentity();
  if (id) headers['X-Maestro-Identity'] = id;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.ifMatch !== undefined) headers['If-Match'] = String(opts.ifMatch);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'unreachable', `cannot reach the write API at ${API_BASE}`);
  }

  if (!res.ok) {
    let code = 'error';
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      code = errBody?.error?.code ?? code;
      message = errBody?.error?.message ?? message;
    } catch {
      /* non-JSON error body — keep the status text */
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as TResp;
}

/** POST /api/products/{p}/tasks — dispatch a new delivery task (US-0010 Q2 intake). */
export function dispatchTask(
  productId: string,
  intent: string,
  opts: { repo?: string; idempotencyKey: string },
): Promise<DispatchResponse> {
  return post<DispatchResponse>(
    `/api/products/${encodeURIComponent(productId)}/tasks`,
    opts.repo ? { intent, repo: opts.repo } : { intent },
    { idempotencyKey: opts.idempotencyKey },
  );
}

/** POST /api/products/{p}/tasks/{t}/comments — anchored or free-form comment (S2). */
export function postComment(
  productId: string,
  taskId: string,
  body: string,
  opts: {
    anchor?: CommentAnchor;
    inReplyTo?: string;
    idempotencyKey: string;
  },
): Promise<CommentResponse> {
  const payload: Record<string, unknown> = { body };
  if (opts.anchor) payload.anchor = opts.anchor;
  if (opts.inReplyTo) payload.in_reply_to = opts.inReplyTo;
  return post<CommentResponse>(
    `/api/products/${encodeURIComponent(productId)}/tasks/${encodeURIComponent(taskId)}/comments`,
    payload,
    { idempotencyKey: opts.idempotencyKey },
  );
}

/**
 * POST /api/products/{p}/tasks/{t}/gates/{gate_id}/decisions — decide a gate (S3).
 *
 * `gateId` is accepted as the type slug (`"functional"`, `"technical_design"`) or the opaque
 * `gate-<seq:04x>` form the projection mints. `ifMatchSeq` is the seq from `open_gates[].seq`
 * the workspace read in the same page — the optimistic-concurrency check the write API enforces.
 */
export function decideGate(
  productId: string,
  taskId: string,
  gateId: GateType | string,
  decision: DecisionAction,
  opts: {
    rationale?: string;
    ifMatchSeq: number;
    idempotencyKey: string;
  },
): Promise<DecisionResponse> {
  return post<DecisionResponse>(
    `/api/products/${encodeURIComponent(productId)}/tasks/${encodeURIComponent(taskId)}/gates/${encodeURIComponent(gateId)}/decisions`,
    opts.rationale !== undefined ? { decision, rationale: opts.rationale } : { decision },
    { idempotencyKey: opts.idempotencyKey, ifMatch: opts.ifMatchSeq },
  );
}
