'use client';

// Decide a gate (S3). The three buttons map to `approve` / `request_changes` / `reject`; the
// rationale textarea is required on the latter two (server action also enforces). If-Match seq
// is fed from the server component so a concurrent decision on the same gate by another
// role-holder (M3+; for M1 it's just the architect) surfaces 409 gate_state_moved cleanly.

import { useActionState, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { DecisionAction, GateType } from '@/lib/types';
import {
  decideGateAction,
  type DecisionActionState,
} from '@/app/products/[productId]/tasks/[taskId]/actions';

const INITIAL: DecisionActionState = { ok: true };

const LABEL: Record<DecisionAction, string> = {
  approve: 'Approve',
  request_changes: 'Request changes',
  reject: 'Reject',
};

export function GateDecisionPanel({
  productId,
  taskId,
  gateId,
  gateType,
  seq,
  resolvedRole,
}: {
  productId: string;
  taskId: string;
  gateId: GateType | string;
  gateType: string;
  seq: number;
  resolvedRole: string | null;
}) {
  const [state, formAction, pending] = useActionState(decideGateAction, INITIAL);
  const [decision, setDecision] = useState<DecisionAction>('approve');
  const idempotencyKey = useMemo(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `decide-${Date.now()}`,
    [],
  );
  const rationaleRequired = decision !== 'approve';

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="task_id" value={taskId} />
      <input type="hidden" name="gate_id" value={gateId} />
      <input type="hidden" name="if_match_seq" value={seq} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <input type="hidden" name="decision" value={decision} />

      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          Deciding the <span className="font-mono">{gateType}</span> gate
          {resolvedRole && <> as {resolvedRole}</>}.
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(LABEL) as DecisionAction[]).map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant={
                decision === d
                  ? d === 'approve'
                    ? 'default'
                    : d === 'reject'
                      ? 'destructive'
                      : 'secondary'
                  : 'outline'
              }
              onClick={() => setDecision(d)}
              aria-pressed={decision === d}
            >
              {LABEL[d]}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="rationale" className="text-xs text-muted-foreground">
          Rationale {rationaleRequired ? '(required)' : '(optional)'}
        </label>
        <Textarea
          id="rationale"
          name="rationale"
          rows={3}
          required={rationaleRequired}
          placeholder={
            rationaleRequired
              ? decision === 'request_changes'
                ? 'What needs to change — the bundled anchored comments above carry the specifics.'
                : 'Why are you rejecting this artefact?'
              : 'Why this is approved (optional but useful for audit).'
          }
        />
      </div>

      {state.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <span className="font-medium text-destructive">{state.error.code}</span>{' '}
          <span className="text-muted-foreground">{state.error.message}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Recording…' : `Record ${LABEL[decision].toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}
