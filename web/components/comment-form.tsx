'use client';

// Anchored or unanchored comment composer (S2). Anchor defaults to the artefact under review;
// the locator field accepts an EARS criterion id (e.g. AC-3) or a heading slug — the server
// action picks the right shape for the artefact kind.

import { useActionState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { SpecKind, SpecRef } from '@/lib/types';
import {
  postCommentAction,
  type CommentActionState,
} from '@/app/products/[productId]/tasks/[taskId]/actions';

const INITIAL: CommentActionState = { ok: true };

export function CommentForm({
  productId,
  taskId,
  artefactKind,
  artefactRef,
  defaultLocator,
}: {
  productId: string;
  taskId: string;
  artefactKind: SpecKind | null;
  artefactRef: SpecRef | null;
  defaultLocator?: string;
}) {
  const [state, formAction, pending] = useActionState(postCommentAction, INITIAL);
  const idempotencyKey = useMemo(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `comment-${Date.now()}`,
    [],
  );

  // No artefact under review (no spec/design drafted yet) → no anchor possible; the form still
  // accepts free-form comments so the architect can note something before the spec lands.
  const anchorable = artefactKind !== null && artefactRef !== null;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="task_id" value={taskId} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      {anchorable && (
        <>
          <input type="hidden" name="artefact_kind" value={artefactKind!} />
          <input type="hidden" name="artefact_repo" value={artefactRef!.repo} />
          <input type="hidden" name="artefact_branch" value={artefactRef!.branch} />
          <input type="hidden" name="artefact_path" value={artefactRef!.path} />
          <input type="hidden" name="artefact_commit" value={artefactRef!.commit} />
        </>
      )}

      <Textarea
        name="body"
        required
        rows={3}
        placeholder={
          anchorable
            ? 'Comment, optionally anchored to a criterion id or heading slug below.'
            : 'Free-form comment on the task.'
        }
      />

      {anchorable && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="anchor_locator">
            Anchor
          </label>
          <Input
            id="anchor_locator"
            name="anchor_locator"
            placeholder={
              artefactKind === 'functional_spec' ? 'AC-3 or heading-slug (optional)' : 'heading-slug (optional)'
            }
            defaultValue={defaultLocator ?? ''}
            className="max-w-sm"
          />
        </div>
      )}

      {state.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <span className="font-medium text-destructive">{state.error.code}</span>{' '}
          <span className="text-muted-foreground">{state.error.message}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Posting…' : 'Post comment'}
        </Button>
      </div>
    </form>
  );
}
