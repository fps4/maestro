'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Notice, cn } from './atoms';
import type { Question } from '@/lib/types';

/**
 * Questions on a version.
 *
 * The one channel a reviewer has short of "ask for changes". Asking never touches the version;
 * answering does not close the question; closing is the asker's (or any human's) act, so an agent's
 * answer is visible as an agent's and the loop is closed by a person. A closed question stays
 * readable — nothing here is deleted.
 */
export function Questions({
  workspace,
  artifact,
  ordinal,
  questions,
}: {
  workspace: string;
  artifact: string;
  ordinal: number;
  questions: Question[];
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const base = `/api/v1/workspaces/${workspace}/artifacts/${artifact}/versions/${ordinal}/questions`;
  const open = questions.filter((q) => !q.resolved_at);
  const closed = questions.filter((q) => q.resolved_at);

  async function post(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(payload.message ?? 'That was refused.');
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('The service could not be reached. Nothing was recorded.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {open.length === 0 ? (
        <p className="m-0 text-sm text-muted">No open questions.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {open.map((question) => (
            <QuestionCard key={question.id} question={question} base={base} post={post} busy={busy} />
          ))}
        </div>
      )}

      <form
        className="flex flex-col gap-1.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await post(base, { text })) setText('');
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-2xs text-faint">Ask a question about this version</span>
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What is unclear? It goes on the record and can be answered by the author or an assistant."
            className="w-full rounded border border-rule-strong bg-surface px-2.5 py-2 text-base sm:text-sm"
          />
        </label>
        <div className="flex items-center justify-between gap-2">
          <Button type="submit" size="sm" disabled={busy || text.trim().length === 0}>
            Ask
          </Button>
          {closed.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowClosed((s) => !s)}
              className="text-2xs text-faint underline-offset-2 hover:underline"
            >
              {showClosed ? 'Hide' : 'Show'} {closed.length} closed question{closed.length === 1 ? '' : 's'}
            </button>
          ) : null}
        </div>
      </form>

      {showClosed
        ? closed.map((question) => (
            <QuestionCard key={question.id} question={question} base={base} post={post} busy={busy} />
          ))
        : null}

      {error ? (
        <Notice tone="hard" title="That was refused.">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}

function QuestionCard({
  question,
  base,
  post,
  busy,
}: {
  question: Question;
  base: string;
  post: (path: string, body?: unknown) => Promise<boolean>;
  busy: boolean;
}) {
  const [reply, setReply] = useState('');
  const isOpen = !question.resolved_at;

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded border p-3 text-sm',
        isOpen ? 'border-rule bg-surface' : 'border-rule bg-surface-2 opacity-80',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span>{question.text}</span>
        <span className="text-2xs text-faint">
          Asked by {question.asked_kind === 'agent' ? 'an assistant' : 'a person'} ·{' '}
          {new Date(question.asked_at).toLocaleDateString('en-GB')}
          {question.resolved_at
            ? ` · closed ${new Date(question.resolved_at).toLocaleDateString('en-GB')}`
            : ''}
        </span>
      </div>

      {question.answers.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-l-2 border-rule-strong pl-3">
          {question.answers.map((answer) => (
            <div key={answer.id} className="flex flex-col gap-0.5">
              <span>{answer.text}</span>
              <span className="text-2xs text-faint">
                {answer.kind === 'agent' ? 'Answered by an assistant' : 'Answered by a person'} ·{' '}
                {new Date(answer.at).toLocaleDateString('en-GB')}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {isOpen ? (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await post(`${base}/${question.id}/answers`, { text: reply })) setReply('');
          }}
        >
          <textarea
            rows={2}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Answer, citing the version or a standard rather than asserting."
            className="w-full rounded border border-rule-strong bg-surface px-2.5 py-2 text-base sm:text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || reply.trim().length === 0}>
              Answer
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => post(`${base}/${question.id}/resolve`)}
            >
              {question.answers.length > 0 ? 'That answers it — close' : 'Close without an answer'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
