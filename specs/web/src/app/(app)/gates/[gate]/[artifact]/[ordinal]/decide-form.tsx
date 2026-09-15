'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Notice, SectionTitle } from '@/components/atoms';

/**
 * The outcome control.
 *
 * Each option states its consequence in the option itself, because a decision whose effects are
 * invisible is one nobody can take responsibly. The reasoning box is not optional decoration: it is
 * carried onto the decision permanently, and it is what a reader five years from now has instead of
 * the conversation you are having now.
 */
export function DecideForm({
  workspace,
  gate,
  artifact,
  ordinal,
  outcomes,
  outcomeLabels,
  required,
  optional,
  fieldLabels,
  acceptedOrdinal,
  hasPin,
}: {
  workspace: string;
  gate: string;
  artifact: string;
  ordinal: number;
  outcomes: string[];
  /** Outcome id → the word on the button. The record carries the id; the person reads the label. */
  outcomeLabels: Record<string, string>;
  required: string[];
  optional: string[];
  fieldLabels: Record<string, string>;
  acceptedOrdinal?: number;
  hasPin: boolean;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState(outcomes[0] ?? '');
  const [reasoning, setReasoning] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attributionFields = [...required, ...optional].filter((f) => f !== 'accountable' && f !== 'acting');

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
      <div className="flex flex-col gap-2.5">
        <SectionTitle>Outcome</SectionTitle>
        {outcomes.map((option) => (
          <label
            key={option}
            className={`flex cursor-pointer items-start gap-2.5 rounded border p-3 text-sm ${
              outcome === option ? 'border-accent bg-accent-soft' : 'border-rule'
            }`}
          >
            <input
              type="radio"
              name="outcome"
              value={option}
              checked={outcome === option}
              onChange={() => setOutcome(option)}
              className="sr-only"
            />
            <span
              className={`mt-1 h-3 w-3 flex-none rounded-full border ${
                outcome === option ? 'border-4 border-accent' : 'border-rule-strong'
              }`}
            />
            <span className="flex flex-col gap-px">
              <b>{outcomeLabels[option] ?? option}</b>
              <span className="text-2xs text-muted">
                {consequence(option, ordinal, acceptedOrdinal, hasPin)}
              </span>
            </span>
          </label>
        ))}
      </div>

      {attributionFields.length > 0 ? (
        <div className="flex flex-col gap-2">
          <SectionTitle>
            Attribution{' '}
            <span className="font-normal text-faint">— required by this gate&rsquo;s profile</span>
          </SectionTitle>
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
                  className="rounded border border-rule-strong bg-surface px-2.5 py-1.5 text-sm"
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <SectionTitle>
          Reasoning <span className="font-normal text-faint">— carried onto the decision, permanently</span>
        </SectionTitle>
        <textarea
          rows={3}
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          className="w-full rounded border border-rule-strong bg-surface px-2.5 py-2 text-sm"
          placeholder="What made this the right call, in one or two sentences."
        />
      </div>

      {error ? (
        <Notice tone="hard" title="The decision was refused, and the refusal is on the record.">
          {error}
        </Notice>
      ) : null}

      <Button variant="primary" onClick={submit} disabled={busy || !outcome} className="w-full py-2">
        {busy ? 'Recording…' : 'Record decision'}
      </Button>
    </div>
  );
}

function consequence(
  outcome: string,
  ordinal: number,
  acceptedOrdinal: number | undefined,
  hasPin: boolean,
): string {
  if (outcome === 'approve' || outcome === 'accept' || outcome === 'publish') {
    const supersedes =
      acceptedOrdinal && acceptedOrdinal !== ordinal ? `, @${acceptedOrdinal} becomes superseded` : '';
    const pin = hasPin ? ', and any pinned link freezes to what is accepted now' : '';
    return `@${ordinal} becomes accepted${supersedes}, the phase moves on${pin}.`;
  }
  if (outcome === 'request_changes') {
    return `Opens a new draft based on @${ordinal} carrying your reasoning. @${ordinal} stays in the record — the loop is visible, not erased.`;
  }
  return `@${ordinal} is refused and stays in the record. Silence is not an outcome, so the refusal is recorded with your reasoning.`;
}
