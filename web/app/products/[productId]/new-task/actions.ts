'use server';

// Server action backing the "New task" form (US-0010 Q2 — the workspace intake affordance).
// One submission ⇒ one POST /api/products/{p}/tasks ⇒ one `task.dispatched` event.

import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { taskPath } from '@/lib/links';
import { dispatchTask } from '@/lib/write';

export interface DispatchActionState {
  ok: boolean;
  error?: { code: string; message: string };
}

export async function dispatchTaskAction(
  _prev: DispatchActionState | undefined,
  formData: FormData,
): Promise<DispatchActionState> {
  const productId = String(formData.get('product_id') ?? '').trim();
  const intent = String(formData.get('intent') ?? '').trim();
  const repoRaw = String(formData.get('repo') ?? '').trim();
  // Form mints its own key per render — a retry of the same render collapses to one event; a
  // fresh page load is a fresh dispatch.
  const idempotencyKey = String(formData.get('idempotency_key') ?? '').trim() || randomUUID();

  if (!productId) {
    return { ok: false, error: { code: 'bad_request', message: 'product_id is required' } };
  }
  if (!intent) {
    return { ok: false, error: { code: 'validation_failed', message: 'intent is required' } };
  }

  let resp;
  try {
    resp = await dispatchTask(productId, intent, {
      repo: repoRaw || undefined,
      idempotencyKey,
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: { code: err.code, message: err.message } };
    throw err;
  }
  // Redirect to the task page — server-action redirect throws internally; do not wrap in try/catch.
  redirect(taskPath(productId, resp.task_id));
}
