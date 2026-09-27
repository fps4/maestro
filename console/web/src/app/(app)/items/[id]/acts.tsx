'use client';

import { useActionState, useState } from 'react';
import { Button, Notice } from '@/components/atoms';
import { act, type ActState } from './actions';

export interface Allowed {
  claim: boolean;
  holder: boolean;
  state: string;
  /** The holder or the answerable person: who may close it with a reason. */
  closer: boolean;
}

/**
 * What the reader may do to this item, and nothing else. The service still decides: a control shown
 * here is a guess from the head, and a refusal comes back as a sentence.
 */
export function Acts({ item, allowed }: { item: string; allowed: Allowed }) {
  const [state, dispatch, pending] = useActionState<ActState, FormData>(act, {});
  const [closing, setClosing] = useState(false);

  const Act = ({ name, label, primary }: { name: string; label: string; primary?: boolean }) => (
    <Button
      type="submit"
      name="act"
      value={name}
      size="sm"
      variant={primary ? 'primary' : 'default'}
      disabled={pending}
    >
      {label}
    </Button>
  );

  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <input type="hidden" name="item" value={item} />
      <div className="flex flex-wrap gap-2">
        {allowed.claim ? <Act name="claim" label="Take it" primary /> : null}
        {allowed.holder && allowed.state === 'assigned' ? <Act name="in_progress" label="Start" /> : null}
        {allowed.holder && allowed.state === 'blocked' ? <Act name="in_progress" label="Unblock" /> : null}
        {allowed.holder && allowed.state !== 'blocked' ? <Act name="blocked" label="Blocked" /> : null}
        {allowed.holder ? <Act name="done" label="Resolve" primary /> : null}
        {allowed.holder ? <Act name="release" label="Release" /> : null}
        {allowed.closer && !closing ? (
          <Button type="button" size="sm" onClick={() => setClosing(true)}>
            Close with a reason…
          </Button>
        ) : null}
      </div>

      {closing ? (
        <div className="flex max-w-[60ch] flex-col gap-2 rounded border border-dashed border-rule-strong p-3">
          <label className="text-xs text-muted" htmlFor="reason">
            Why it closes. Kept on the item, for whoever reads it next.
          </label>
          <textarea
            id="reason"
            name="reason"
            rows={3}
            className="rounded border border-rule-strong bg-surface p-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Act name="superseded" label="Superseded" />
            <Act name="refused" label="Decline" />
            <Button type="button" size="sm" onClick={() => setClosing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {state.error ? <Notice tone="hard">{state.error}</Notice> : null}
    </form>
  );
}

/** Link the pull request the evidence waits on; it arms `merged_change`. */
export function LinkPullRequest({ item }: { item: string }) {
  const [state, dispatch, pending] = useActionState<ActState, FormData>(act, {});
  return (
    <form action={dispatch} className="flex flex-col gap-2">
      <input type="hidden" name="item" value={item} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="pull_request"
          placeholder="owner/repo#123"
          aria-label="Pull request"
          className="w-56 rounded border border-rule-strong bg-surface px-2 py-1 font-mono text-xs"
        />
        <Button type="submit" name="act" value="link" size="sm" disabled={pending}>
          Link pull request
        </Button>
      </div>
      {state.error ? <Notice tone="hard">{state.error}</Notice> : null}
    </form>
  );
}
