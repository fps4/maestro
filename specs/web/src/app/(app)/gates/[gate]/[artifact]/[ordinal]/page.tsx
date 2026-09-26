import Link from 'next/link';
import { fetchPacket } from '@/lib/api';
import { currentWorkspace } from '@/lib/auth';
import {
  Card,
  Eyebrow,
  Mono,
  Notice,
  PageTitle,
  Rendered,
  SectionTitle,
  shortDigest,
} from '@/components/atoms';
import { Questions } from '@/components/questions';
import type { DecisionPacket } from '@/lib/types';
import { DecideForm } from './decide-form';

export const dynamic = 'force-dynamic';

/**
 * The decision page — the product, for the person who has to decide.
 *
 * One column, one call, plain language, in the order a sponsor on a phone reads it: what am I being
 * asked, what is this, what changed since I last looked, what did the checks find, what happens if I
 * press each button — and then the buttons. Everything on the page comes from the decider's packet,
 * which is the same object an agent reads over MCP, so what the sponsor sees and what their
 * assistant explains cannot drift apart.
 *
 * Identifiers appear only where they are the point: the digest and the ordinal, in the footer, for
 * the record.
 */
export default async function DecidePage({
  params,
}: {
  params: Promise<{ gate: string; artifact: string; ordinal: string }>;
}) {
  const { gate, artifact, ordinal } = await params;
  const n = Number(ordinal);
  const workspace = await currentWorkspace();
  const packet = await fetchPacket(gate, artifact, n);

  const blocking = packet.checks.filter((c) => c.blocking && !c.satisfied);
  const unconfirmed = packet.facets.filter((f) => !f.confirmed);
  const typeWord = packet.gate.type_title.toLowerCase();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Eyebrow>{packet.gate.title}</Eyebrow>
        <PageTitle>{packet.subject.title}</PageTitle>
        {packet.gate.description ? (
          <p className="m-0 text-base text-ink">
            <b>You are being asked:</b> {packet.gate.description}
          </p>
        ) : null}
        <p className="m-0 text-sm text-muted">
          A {typeWord}, version {n}, proposed{' '}
          {new Date(packet.subject.proposed_at).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}{' '}
          by <Mono>{packet.subject.proposed_by}</Mono>
          {packet.subject.contributors.some((c) => c.kind === 'agent')
            ? ', with an agent contributing to the draft'
            : ''}
          . Currently <b>{packet.subject.phase_label.toLowerCase()}</b>.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <SectionTitle>What this is</SectionTitle>
        {packet.gate.type_description ? (
          <p className="m-0 text-sm text-muted">
            A {typeWord}: {packet.gate.type_description}
          </p>
        ) : null}
        <Rendered html={packet.document.html} />
        {packet.facets.length > 0 ? <Facets facets={packet.facets} /> : null}
        {unconfirmed.length > 0 ? (
          <Notice tone="warn" title="Some of this was filled in by an agent and nobody has confirmed it yet.">
            {unconfirmed.map((f) => f.label).join(', ')}. An unconfirmed value cannot pass a gate; the author
            needs to confirm it before you can decide.
          </Notice>
        ) : null}
      </section>

      {packet.since ? (
        <section className="flex flex-col gap-3">
          <SectionTitle>What changed since version {packet.since.ordinal}</SectionTitle>
          <Since since={packet.since} artifact={artifact} ordinal={n} />
        </section>
      ) : (
        <section className="flex flex-col gap-1">
          <SectionTitle>What changed</SectionTitle>
          <p className="m-0 text-sm text-muted">
            This is the first time anyone is asked to decide on this {typeWord}. There is nothing to compare
            it with yet.
          </p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionTitle>What the checks found</SectionTitle>
        {packet.checks.length === 0 ? (
          <p className="m-0 text-sm text-muted">
            This gate runs no checks. The decision is your judgement, and it is recorded as such.
          </p>
        ) : (
          <Checks checks={packet.checks} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>
          Questions
          {packet.questions.open > 0 ? (
            <span className="ml-2 font-normal text-warning">{packet.questions.open} open</span>
          ) : null}
        </SectionTitle>
        <p className="m-0 text-sm text-muted">
          Anything unclear? Ask here rather than deciding on a guess. The author or an assistant answers, and
          you close the question when it is answered. Nothing you ask changes the version.
        </p>
        <Questions workspace={workspace} artifact={artifact} ordinal={n} questions={packet.questions.items} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>What happens if you…</SectionTitle>
        <div className="flex flex-col gap-2">
          {packet.decider.outcomes.map((outcome) => (
            <Card key={outcome.outcome} className="gap-1.5">
              <b className="text-sm">{outcome.label}</b>
              <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-sm text-muted">
                {outcome.effects.map((effect) => (
                  <li key={effect}>{effect}</li>
                ))}
              </ul>
              {outcome.blocked ? (
                <Notice tone="warn" title="This would be refused right now.">
                  {outcome.blocked}
                </Notice>
              ) : null}
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Your decision</SectionTitle>
        {!packet.decider.may_decide ? (
          <Notice tone="hard" title="This decision is not yours to take.">
            {packet.decider.reason}
          </Notice>
        ) : blocking.length > 0 ? (
          <Notice tone="hard" title="This cannot be decided yet.">
            {blocking.map((c) => `${c.title}: ${c.detail}`).join(' · ')}
          </Notice>
        ) : (
          <>
            <p className="m-0 text-sm text-muted">{packet.decider.reason}</p>
            <DecideForm
              workspace={workspace}
              gate={packet.gate.id}
              artifact={artifact}
              ordinal={n}
              outcomes={packet.decider.outcomes}
              required={packet.decider.attribution.required}
              optional={packet.decider.attribution.optional}
              fieldLabels={packet.decider.attribution.field_labels}
            />
          </>
        )}
      </section>

      {packet.history.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionTitle>Decided before</SectionTitle>
          <div className="flex flex-col gap-2">
            {packet.history.map((entry) => (
              <div key={`${entry.ordinal}-${entry.decided_at}`} className="flex flex-col gap-0.5 text-sm">
                <span>
                  <b>{entry.outcome_label}</b> on version {entry.ordinal} at {entry.gate_title},{' '}
                  {new Date(entry.decided_at).toLocaleDateString('en-GB')} by <Mono>{entry.decided_by}</Mono>
                </span>
                {entry.reasoning ? <span className="text-muted">&ldquo;{entry.reasoning}&rdquo;</span> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="flex flex-col gap-1 border-t border-rule pt-4 text-2xs text-faint">
        <span>
          For the record: <Mono>{artifact}</Mono> version {n}, digest{' '}
          <Mono>{shortDigest(packet.subject.digest)}</Mono>. Your decision is recorded against this exact
          content and cannot be edited or deleted afterwards. You are recorded as answerable for it.
        </span>
        <span className="flex flex-wrap gap-3">
          <Link href={`/artifacts/${artifact}/versions/${n}`} className="underline">
            Read the full version
          </Link>
          {packet.since ? (
            <Link
              href={`/artifacts/${artifact}/diff?from=${packet.since.ordinal}&to=${n}`}
              className="underline"
            >
              See every changed line
            </Link>
          ) : null}
          <Link href={`/artifacts/${artifact}`} className="underline">
            All versions
          </Link>
        </span>
      </footer>
    </div>
  );
}

function Facets({ facets }: { facets: DecisionPacket['facets'] }) {
  return (
    <Card flat className="gap-2">
      <span className="text-2xs uppercase tracking-[0.05em] text-faint">The facts the checks read</span>
      <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr),minmax(0,2fr)]">
        {facets.map((facet) => (
          <div key={facet.field} className="contents">
            <dt className="text-sm font-medium">
              {facet.label}
              {facet.description ? (
                <span className="block text-2xs font-normal text-faint">{facet.description}</span>
              ) : null}
            </dt>
            <dd className="m-0 text-sm text-muted">
              {summarise(facet.value)}
              {!facet.confirmed ? <span className="ml-1 text-warning">· not yet confirmed</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Since({
  since,
  artifact,
  ordinal,
}: {
  since: NonNullable<DecisionPacket['since']>;
  artifact: string;
  ordinal: number;
}) {
  const nothing =
    since.facets.length === 0 &&
    since.body.unchanged &&
    since.links.added.length === 0 &&
    since.links.removed.length === 0 &&
    since.links.repointed.length === 0;
  return (
    <Card className="gap-2 text-sm">
      {since.outcome ? (
        <p className="m-0 text-muted">
          Version {since.ordinal} was decided <b>{since.outcome.label.toLowerCase()}</b>
          {since.decided_at ? ` on ${new Date(since.decided_at).toLocaleDateString('en-GB')}` : ''}.
        </p>
      ) : null}
      {nothing ? (
        <p className="m-0">Nothing has changed. This is the same content, proposed again.</p>
      ) : (
        <>
          {since.facets.length > 0 ? (
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
              {since.facets.map((change) => (
                <li key={change.field}>
                  <b>{change.label}</b>{' '}
                  {change.kind === 'added'
                    ? `is new: ${summarise(change.after)}`
                    : change.kind === 'removed'
                      ? `was removed (was ${summarise(change.before)})`
                      : `changed from ${summarise(change.before)} to ${summarise(change.after)}`}
                </li>
              ))}
            </ul>
          ) : null}
          {!since.body.unchanged ? (
            <p className="m-0 text-muted">
              The text changed: {since.body.added_lines} line{since.body.added_lines === 1 ? '' : 's'} added,{' '}
              {since.body.removed_lines} removed.{' '}
              <Link
                href={`/artifacts/${artifact}/diff?from=${since.ordinal}&to=${ordinal}`}
                className="underline"
              >
                See every changed line
              </Link>
              .
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

function Checks({ checks }: { checks: DecisionPacket['checks'] }) {
  return (
    <div className="flex flex-col gap-2">
      {checks.map((check) => (
        <div key={check.id} className="flex items-start gap-2.5 text-sm">
          <span
            className={`mt-0.5 w-4 flex-none text-center font-mono font-bold ${
              check.satisfied ? 'text-accent' : check.blocking ? 'text-critical' : 'text-warning'
            }`}
            aria-label={check.satisfied ? 'passed' : check.blocking ? 'failed' : 'advisory'}
          >
            {check.satisfied ? '✓' : check.blocking ? '×' : '!'}
          </span>
          <div className="flex flex-col gap-0.5">
            <b className={check.satisfied ? '' : check.blocking ? 'text-critical' : 'text-warning'}>
              {check.title}
              {!check.blocking && !check.satisfied ? ' (advisory)' : ''}
            </b>
            <span className="text-muted">{check.detail}</span>
            {check.findings?.length ? (
              <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-muted">
                {check.findings.map((finding, i) => (
                  <li key={i}>
                    {finding.outcome === 'met'
                      ? 'Met'
                      : finding.outcome === 'unmet'
                        ? 'Not met'
                        : 'Not applicable'}
                    {finding.standard ? ` — ${finding.standard}` : ''}
                    {finding.detail ? `: ${finding.detail}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function summarise(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? '…' : String(v)}`)
    .join(', ');
}
