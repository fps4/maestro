'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Chip,
  Eyebrow,
  Mono,
  Notice,
  PageTitle,
  Provenance,
  SectionTitle,
} from '@/components/atoms';
import type { Draft, Readiness } from '@/lib/types';

/**
 * The editing surface — one document (ADR-0017).
 *
 * The author writes a single markdown text: front-matter for the title, classification, links and
 * facets; the body below; and, where the type declares a block, a table under a named heading that
 * *is* a facet. The service derives the projection at every save, and the panel beside the editor
 * shows what the gate will read — so the author sees the structure their prose became without ever
 * filling in a second form.
 *
 * Two further properties carry it.
 *
 * **Autosave with optimistic concurrency.** Saves are ordinary writes — a draft has no integrity
 * obligations because it is not a record — but a save carrying a stale revision is refused *with
 * the current state* rather than overwriting someone else's edit. A human and an agent editing the
 * same draft resolve without silent loss.
 *
 * **Unconfirmed extraction blocks propose.** The button is disabled and the notice names the facets
 * and the gate requirement that makes it so. The rule is enforced where it is felt, not only where
 * it is checked.
 */
export function Editor({
  workspace,
  draft: initial,
  requiresConfirmedFacets,
  gateName,
  pinnedLink,
  classificationRequired,
  readiness: initialReadiness,
  document: initialDocument,
  blocks,
}: {
  workspace: string;
  draft: Draft;
  requiresConfirmedFacets: boolean;
  gateName: string | null;
  pinnedLink: { id: string; to: string } | null;
  classificationRequired: boolean;
  readiness: Readiness | null;
  document: string;
  blocks: Array<{ facet: string; heading: string }>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [document, setDocument] = useState(initialDocument);
  const [savedDocument, setSavedDocument] = useState(initialDocument);
  const [status, setStatus] = useState<'saved' | 'saving' | 'dirty' | 'conflict'>('saved');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(initialReadiness);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Readiness is the schema's questions, re-asked after every save — so the checklist the author
  // writes toward is never one revision behind what they typed.
  const refreshReadiness = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/workspaces/${workspace}/drafts/${draft.id}/readiness`);
      if (!response.ok) return;
      const payload = (await response.json()) as { readiness?: Readiness };
      if (payload.readiness) setReadiness(payload.readiness);
    } catch {
      // A stale checklist is better than an error over one; the next save asks again.
    }
  }, [draft.id, workspace]);

  const unconfirmed = Object.entries(draft.provenance)
    .filter(([, p]) => p.source === 'extracted' && !p.confirmed_by)
    .map(([field]) => field);

  const save = useCallback(
    async (text: string) => {
      setStatus('saving');
      const response = await fetch(`/api/v1/workspaces/${workspace}/drafts/${draft.id}/document`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: draft.revision, document: text }),
      });
      const payload = (await response.json()) as {
        draft?: Draft;
        document?: string;
        message?: string;
        actual?: number;
      };

      if (response.status === 409) {
        // Refused *with the current state*, which is what makes this recoverable rather than a
        // silent overwrite. The editor stops autosaving until the reader has seen what changed.
        setStatus('conflict');
        setError(payload.message ?? 'This draft moved on while you were editing.');
        return;
      }
      if (!response.ok || !payload.draft) {
        setStatus('dirty');
        setError(payload.message ?? 'The save was refused.');
        return;
      }
      setDraft(payload.draft);
      // What was sent is what is saved; the composed document may differ in whitespace, and
      // replacing the author's text with it mid-typing would move their cursor.
      setSavedDocument(text);
      setStatus('saved');
      setError(null);
      void refreshReadiness();
    },
    [draft.id, draft.revision, workspace, refreshReadiness],
  );

  // Autosave on a pause, not on every keystroke: a draft is saved continuously, but a request per
  // character would make the slowest thing in the service the act of writing in it.
  useEffect(() => {
    if (document === savedDocument) return;
    if (status === 'conflict') return;
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void save(document);
    }, 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [document, savedDocument, save, status]);

  async function confirm(field: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/workspaces/${workspace}/drafts/${draft.id}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fields: [field] }),
      });
      const payload = (await response.json()) as { draft?: Draft; message?: string };
      if (payload.draft) {
        setDraft(payload.draft);
        void refreshReadiness();
      } else setError(payload.message ?? 'The confirmation was refused.');
    } finally {
      setBusy(false);
    }
  }

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/workspaces/${workspace}/drafts/${draft.id}/propose`, {
        method: 'POST',
      });
      const payload = (await response.json()) as {
        version?: { artifact: string; ordinal: number };
        message?: string;
      };
      if (!response.ok || !payload.version) {
        setError(payload.message ?? 'The proposal was refused.');
        return;
      }
      router.push(`/artifacts/${payload.version.artifact}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const blocked = requiresConfirmedFacets && unconfirmed.length > 0;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Eyebrow>draft · mutable · not a record</Eyebrow>
          <PageTitle>{draft.title || 'Untitled draft'}</PageTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Mono>{draft.type}</Mono>
            <span className="text-faint">·</span>
            <span>
              rev <Mono>{draft.revision}</Mono>
            </span>
            <span className="text-faint">·</span>
            <span className="text-faint">
              {status === 'saved'
                ? 'saved'
                : status === 'saving'
                  ? 'saving…'
                  : status === 'conflict'
                    ? 'not saved'
                    : 'unsaved changes'}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-faint">Contributors</span>
          {draft.contributors.map((c) => (
            <Chip key={c.principal} state={c.kind === 'agent' ? 'draft' : 'neutral'}>
              {c.principal}
            </Chip>
          ))}
          <Button variant="primary" onClick={propose} disabled={busy || blocked || status === 'conflict'}>
            Propose version
          </Button>
        </div>
      </div>

      {status === 'conflict' ? (
        <Notice tone="hard" title="This draft moved on while you were editing.">
          {error} Nothing you typed has been sent. Reload to see the current state, then apply your edit again
          — the alternative would be overwriting someone else&rsquo;s work without either of you knowing.
        </Notice>
      ) : null}

      {readiness ? <ReadinessCard readiness={readiness} gateName={gateName} /> : null}

      {blocked ? (
        <Notice
          tone="warn"
          title={`${unconfirmed.length} facet${unconfirmed.length === 1 ? ' is' : 's are'} extracted and unconfirmed, so this cannot be proposed.`}
        >
          An agent proposed {unconfirmed.map((f) => `\`${f}\``).join(', ')}. The {gateName ?? 'gate'} declares{' '}
          <Mono>confirmed_facets</Mono>, and an unconfirmed extraction never reaches a gate — confirm each
          below, or edit it first.
        </Notice>
      ) : null}

      {error && status !== 'conflict' ? (
        <Notice tone="hard" title="Refused">
          {error}
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.3fr),minmax(0,1fr)]">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle>
              The document <span className="font-normal text-faint font-mono">{draft.body.format}</span>
            </SectionTitle>
          </div>

          <textarea
            value={document}
            onChange={(e) => setDocument(e.target.value)}
            aria-label="Document"
            spellCheck
            className="min-h-[520px] w-full rounded border border-dashed border-rule-strong bg-surface-2 px-3.5 py-3 font-mono text-xs leading-[1.65]"
          />

          <p className="m-0 text-2xs text-faint">
            One text. The front-matter between the <Mono>---</Mono> lines carries the title, classification,
            links and any facet; everything below is the body.
            {blocks.length > 0
              ? ` A table under the heading ${blocks.map((b) => `“${b.heading}”`).join(' or ')} is read as a facet.`
              : ''}{' '}
            Autosaved on every pause; a save carrying a stale revision is refused rather than overwriting.
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <SectionTitle>
            What the gate will read{' '}
            <span className="font-normal text-faint">— derived from the document</span>
          </SectionTitle>

          {Object.keys(draft.facets).length === 0 ? (
            <Card flat>
              <p className="m-0 text-xs text-muted">
                Nothing yet. Add keys to the front-matter
                {blocks.length > 0 ? `, or a table under “${blocks[0]!.heading}”` : ''}, and they appear here
                as the facets a gate reads. A draft may be incomplete; a proposal may not.
              </p>
            </Card>
          ) : (
            Object.entries(draft.facets).map(([field, value]) => {
              const p = draft.provenance[field];
              const needsConfirming = p?.source === 'extracted' && !p.confirmed_by;
              return (
                <div
                  key={field}
                  className={`flex flex-col gap-1 rounded border border-dashed bg-surface-2 px-2.5 py-2 ${
                    needsConfirming ? 'border-warning' : 'border-rule'
                  }`}
                >
                  <span
                    className={`font-mono text-2xs uppercase tracking-[0.06em] ${
                      needsConfirming ? 'text-warning' : 'text-faint'
                    }`}
                  >
                    {field}
                  </span>
                  <span className="font-mono text-2xs">
                    {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {p ? (
                      <Provenance
                        source={p.source}
                        confirmed={Boolean(p.confirmed_by)}
                        by={p.confirmed_by ?? p.by}
                      />
                    ) : null}
                    {needsConfirming ? (
                      <Button size="sm" onClick={() => confirm(field)} disabled={busy}>
                        Review &amp; confirm
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}

          {classificationRequired ? (
            <Card flat className="gap-1.5">
              <Eyebrow>Classification</Eyebrow>
              <span className="text-2xs text-muted">
                {draft.facets && (initial as Draft & { classification?: unknown }).classification
                  ? 'Recorded. Validated again at propose.'
                  : 'This type requires a classification at propose. A version written without one is unclassifiable rather than merely unclassified — it can never be given a retention rule or a lawful basis afterwards.'}
              </span>
            </Card>
          ) : null}

          {pinnedLink ? (
            <Card flat className="gap-1.5">
              <Eyebrow>Pin on acceptance</Eyebrow>
              <span className="text-2xs text-muted">
                <Mono>
                  {pinnedLink.id} → {pinnedLink.to}
                </Mono>{' '}
                will freeze to whichever version is accepted at the moment this is accepted. It cannot be
                repointed afterwards.
              </span>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

/**
 * What this draft still needs, in the schema's own words.
 *
 * Two lists, kept apart because they mean different things: what stops *propose* (the schema and
 * the classification) and what the gate will then refuse (an unconfirmed extraction, an open
 * question). Both are the author's to clear; only the first makes the button do nothing.
 */
function ReadinessCard({ readiness, gateName }: { readiness: Readiness; gateName: string | null }) {
  const stopsPropose = readiness.blockers.filter((b) =>
    ['facet_missing', 'facet_invalid', 'classification_missing'].includes(b.kind),
  );
  const gateWillRefuse = readiness.blockers.filter((b) => !stopsPropose.includes(b));

  if (readiness.blockers.length === 0) {
    return (
      <Notice tone="ok" title="Ready to propose.">
        Everything this type asks for is here.
        {readiness.gates[0]
          ? ` Once proposed, ${readiness.gates[0].title} will check: ${readiness.gates[0].requirements.join(' ')}`
          : ''}
      </Notice>
    );
  }

  return (
    <Card flat className="gap-2.5">
      <SectionTitle>
        Before you can propose{' '}
        <span className="font-normal text-faint">
          — {readiness.blockers.length} thing{readiness.blockers.length === 1 ? '' : 's'} still to do
        </span>
      </SectionTitle>
      {stopsPropose.length > 0 ? (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
          {stopsPropose.map((b) => (
            <li key={`${b.kind}-${b.field ?? b.label}`}>
              <b>{b.label}</b>
              {b.description ? <span className="text-muted"> — {b.description}</span> : null}
              <span className="block text-2xs text-faint">{b.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {gateWillRefuse.length > 0 ? (
        <>
          <span className="text-2xs uppercase tracking-[0.05em] text-faint">
            And before {gateName ?? 'the gate'} will open
          </span>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
            {gateWillRefuse.map((b) => (
              <li key={`${b.kind}-${b.field ?? b.label}`}>
                <b>{b.label}</b>
                <span className="block text-2xs text-faint">{b.detail}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}
