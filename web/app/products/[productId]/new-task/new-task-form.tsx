'use client';

// Client part of the new-task form: minting the per-submission idempotency key (so a double-click
// or browser retry collapses to one event), surfacing validation errors from the server action.

import { useActionState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { dispatchTaskAction, type DispatchActionState } from './actions';

const INITIAL: DispatchActionState = { ok: true };

export function NewTaskForm({ productId, repos }: { productId: string; repos: string[] }) {
  const [state, formAction, pending] = useActionState(dispatchTaskAction, INITIAL);
  // One key per render. A retry of the SAME form (same submission) collapses to one event; a
  // fresh load is a fresh dispatch.
  const idempotencyKey = useMemo(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dispatch-${Date.now()}`,
    [],
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />

      <div className="space-y-1.5">
        <label htmlFor="intent" className="text-sm font-medium">
          Intent
        </label>
        <Textarea
          id="intent"
          name="intent"
          required
          minLength={1}
          maxLength={8000}
          rows={6}
          placeholder="Describe what you want built, in your own words. The spec agent will draft EARS criteria from this."
        />
        <p className="text-xs text-muted-foreground">
          Max 8,000 characters. The architect can refine in the workspace; this is the seed.
        </p>
      </div>

      {repos.length > 1 && (
        <div className="space-y-1.5">
          <label htmlFor="repo" className="text-sm font-medium">
            Target repo
          </label>
          <select
            id="repo"
            name="repo"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            defaultValue={repos[0]}
          >
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      )}
      {repos.length === 1 && <input type="hidden" name="repo" value={repos[0]} />}

      {state.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">{state.error.code}</p>
          <p className="mt-0.5 text-muted-foreground">{state.error.message}</p>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Dispatching…' : 'Dispatch task'}
        </Button>
      </div>
    </form>
  );
}
