'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Notice } from '@/components/atoms';
import type { OutcomeConsequence } from '@/lib/types';

/**
 * The outcome control.
 *
 * Each option carries the effects the api computed for it, so what the button says it will do is
 * what the service will do — the console no longer guesses from the outcome's name. The reasoning
 * box is not optional decoration: it is carried onto the decision permanently, and it is what a
 * reader five years from now has instead of the conversation you are having now.
 */
export function DecideForm({
  workspace,
  gate,
  artifact,
  ordinal,
  outcomes,
  required,
  optional,
  fieldLabels,
}: {
  workspace: string;
  gate: string;
  artifact: string;
  ordinal: number;
  outcomes: OutcomeConsequence[];
  required: string[];
  optional: string[];
  fieldLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState(outcomes.find((o) => !o.blocked)?.outcome ?? '');
  const [reasoning, setReasoning] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attributionFields = [...required, ...optional].filter((f) => f !== 'accountable' && f !== 'acting');
  const chosen = outcomes.find((o) => o.outcome === outcome);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/workspaces/${workspace}/gates/${gate}/decisions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          artifact,
          ordinal,
          outcome,
          reasoning: reasoning || undefined,
          // `accountable` and `acting` are resolved server-side to the signed-in principal. The
          // browser is not trusted to say who is answerable — that is the one field an attacker
          // would most want to choose.
          attribution: { ...fields },
        }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(body.message ?? 'The decision was refused.');
        return;
      }
      router.push(`/artifacts/${artifact}`);
      router.refresh();
    } catch {
      setError('The service could not be reached. Nothing was recorded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Outcome">
        {outcomes.map((option) => (
          <label
            key={option.outcome}
            className={`flex items-start gap-3 rounded border p-3 text-sm ${
              option.blocked
                ? 'cursor-not-allowed border-rule opacity-60'
                : outcome === option.outcome
                  ? 'cursor-pointer border-accent bg-accent-soft'
                  : 'cursor-pointer border-rule'
            }`}
          >
            <input
              type="radio"
              name="outcome"
              value={option.outcome}
              checked={outcome === option.outcome}
              disabled={Boolean(option.blocked)}
              onChange={() => setOutcome(option.outcome)}
              className="sr-only"
            />
            <span
              className={`mt-1 h-3.5 w-3.5 flex-none rounded-full border ${
                outcome === option.outcome ? 'border-4 border-accent' : 'border-rule-strong'
              }`}
              aria-hidden
            />
            <span className="flex flex-col gap-0.5">
              <b className="text-base">{option.label}</b>
              <span className="text-2xs text-muted">{option.blocked ?? option.effects[0]}</span>
            </span>
          </label>
        ))}
      </div>

      {attributionFields.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {attributionFields.map((field) => (
            <label key={field} className="flex flex-col gap-1">
              <span className="text-2xs text-faint">
                {fieldLabels[field] ?? field}
                {required.includes(field) ? ' *' : ''}
              </span>
              <input
                value={fields[field] ?? ''}
                onChange={(e) => setFields({ ...fields, [field]: e.target.value })}
                className="rounded border border-rule-strong bg-surface px-2.5 py-2 text-base sm:text-sm"
              />
            </label>
          ))}
        </div>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-2xs text-faint">
          Why — one or two sentences, kept with the decision permanently
        </span>
        <textarea
          rows={3}
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          className="w-full rounded border border-rule-strong bg-surface px-2.5 py-2 text-base sm:text-sm"
          placeholder="What made this the right call."
        />
      </label>

      {error ? (
        <Notice tone="hard" title="The decision was refused, and the refusal is on the record.">
          {error}
        </Notice>
      ) : null}

      <Button
        variant="primary"
        onClick={submit}
        disabled={busy || !chosen || Boolean(chosen.blocked)}
        className="w-full py-3 text-base"
      >
        {busy ? 'Recording…' : chosen ? `${chosen.label} — record my decision` : 'Record decision'}
      </Button>
    </div>
  );
}
