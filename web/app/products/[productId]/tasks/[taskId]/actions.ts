'use server';

// Server actions for the task-detail page: post a comment (S2) and decide a gate (S3).
// Each is one POST → one event in the log. Idempotency-Key minted per-submission so a retry
// collapses to one event; If-Match on decisions enforces the projection's optimistic-concurrency
// rule.

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { ApiError } from '@/lib/api';
import { taskPath } from '@/lib/links';
import type {
  CommentAnchor,
  DecisionAction,
  GateType,
  SpecKind,
} from '@/lib/types';
import { decideGate, postComment } from '@/lib/write';

export interface CommentActionState {
  ok: boolean;
  error?: { code: string; message: string };
}

export interface DecisionActionState {
  ok: boolean;
  error?: { code: string; message: string };
}

const OK: CommentActionState = { ok: true };

export async function postCommentAction(
  _prev: CommentActionState | undefined,
  formData: FormData,
): Promise<CommentActionState> {
  const productId = String(formData.get('product_id') ?? '').trim();
  const taskId = String(formData.get('task_id') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const repo = String(formData.get('artefact_repo') ?? '').trim();
  const branch = String(formData.get('artefact_branch') ?? '').trim();
  const path = String(formData.get('artefact_path') ?? '').trim();
  const commit = String(formData.get('artefact_commit') ?? '').trim();
  const kindRaw = String(formData.get('artefact_kind') ?? '').trim() as SpecKind;
  const locatorRaw = String(formData.get('anchor_locator') ?? '').trim();
  const inReplyTo = String(formData.get('in_reply_to') ?? '').trim();
  const idempotencyKey = String(formData.get('idempotency_key') ?? '').trim() || randomUUID();

  if (!body) {
    return { ok: false, error: { code: 'validation_failed', message: 'comment body is required' } };
  }

  // Anchor is optional: an unanchored comment is a valid fallback (workspace-write-api.md
  // §POST-comments). When the user fills in `anchor_locator`, we shape it per the artefact kind.
  let anchor: CommentAnchor | undefined;
  if (locatorRaw) {
    const locator =
      kindRaw === 'functional_spec'
        ? locatorRaw.startsWith('AC-')
          ? { criterion_id: locatorRaw }
          : { heading: locatorRaw }
        : { heading: locatorRaw };
    anchor = {
      artefact: { kind: kindRaw, ref: { repo, branch, path, commit } },
      locator,
    };
  }

  try {
    await postComment(productId, taskId, body, {
      anchor,
      inReplyTo: inReplyTo || undefined,
      idempotencyKey,
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: { code: err.code, message: err.message } };
    throw err;
  }

  revalidatePath(taskPath(productId, taskId));
  return OK;
}

export async function decideGateAction(
  _prev: DecisionActionState | undefined,
  formData: FormData,
): Promise<DecisionActionState> {
  const productId = String(formData.get('product_id') ?? '').trim();
  const taskId = String(formData.get('task_id') ?? '').trim();
  const gateId = String(formData.get('gate_id') ?? '').trim() as GateType | string;
  const decision = String(formData.get('decision') ?? '').trim() as DecisionAction;
  const rationale = String(formData.get('rationale') ?? '').trim();
  const ifMatchSeqRaw = String(formData.get('if_match_seq') ?? '').trim();
  const idempotencyKey = String(formData.get('idempotency_key') ?? '').trim() || randomUUID();

  const ifMatchSeq = Number.parseInt(ifMatchSeqRaw, 10);
  if (!Number.isFinite(ifMatchSeq)) {
    return {
      ok: false,
      error: { code: 'bad_request', message: 'If-Match seq is missing or not a number' },
    };
  }

  if ((decision === 'request_changes' || decision === 'reject') && !rationale) {
    return {
      ok: false,
      error: {
        code: 'validation_failed',
        message: `rationale is required for decision "${decision}"`,
      },
    };
  }

  try {
    await decideGate(productId, taskId, gateId, decision, {
      rationale: rationale || undefined,
      ifMatchSeq,
      idempotencyKey,
    });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: { code: err.code, message: err.message } };
    throw err;
  }

  revalidatePath(taskPath(productId, taskId));
  return { ok: true };
}
