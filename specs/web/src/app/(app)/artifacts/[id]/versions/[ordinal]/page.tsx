import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchLabels, fetchQuestions, fetchVersion } from '@/lib/api';
import { currentWorkspace } from '@/lib/auth';
import { Questions } from '@/components/questions';
import { stateLabel, typeLabel } from '@/lib/labels';
import {
  Card,
  Chip,
  Eyebrow,
  KeyValue,
  Mono,
  Notice,
  PageTitle,
  Provenance,
  Rendered,
  Sealed,
  SectionTitle,
  shortDigest,
} from '@/components/atoms';

export const dynamic = 'force-dynamic';

/**
 * One immutable version, read.
 *
 * Sealed throughout: solid rules, a visible digest, and **no edit affordance anywhere on the page**,
 * because there is no operation to offer. A change is a new draft, then a new version.
 */
export default async function VersionPage({ params }: { params: Promise<{ id: string; ordinal: string }> }) {
  const { id, ordinal } = await params;

  let data;
  try {
    data = await fetchVersion(id, Number(ordinal), true);
  } catch {
    notFound();
  }
  const { version, rendered } = data;
  const [labels, questions, workspace] = await Promise.all([
    fetchLabels(),
    fetchQuestions(id, Number(ordinal)).catch(() => []),
    currentWorkspace(),
  ]);

  return (
    <>
      <Sealed className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip state={version.state}>{stateLabel(version.state)}</Chip>
          <span className="font-mono text-2xs text-faint">
            @{version.ordinal} · {shortDigest(version.digest)}
          </span>
          {version.supersedes ? (
            <span className="text-2xs text-faint">supersedes @{version.supersedes}</span>
          ) : null}
        </div>
        <Eyebrow>
          {typeLabel(labels, version.type)} ·{' '}
          <Link href={`/artifacts/${id}`} className="underline underline-offset-2">
            {id}
          </Link>
        </Eyebrow>
        <PageTitle>{version.title}</PageTitle>
      </Sealed>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.75fr),minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <SectionTitle>
            Body <span className="font-normal text-faint font-mono">{version.body.format}</span>
          </SectionTitle>

          {rendered?.unresolved?.length ? (
            <Notice tone="warn" title="This body references attachments this version does not carry.">
              {rendered.unresolved.join(', ')} — a reference that resolves to nothing is shown as written
              rather than silently dropped.
            </Notice>
          ) : null}

          <Rendered html={rendered?.html ?? ''} />

          <SectionTitle>
            Questions
            {questions.some((q) => !q.resolved_at) ? (
              <span className="ml-2 font-normal text-warning">
                {questions.filter((q) => !q.resolved_at).length} open
              </span>
            ) : null}
          </SectionTitle>
          <Questions workspace={workspace} artifact={id} ordinal={Number(ordinal)} questions={questions} />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>Envelope</SectionTitle>
            <KeyValue
              rows={[
                ['digest', <Mono key="d">{shortDigest(version.digest)}</Mono>],
                ['definition', <Mono key="def">v{version.definition_version}</Mono>],
                ['proposed by', <Mono key="p">{version.proposed_by}</Mono>],
                ['proposed at', new Date(version.proposed_at).toLocaleString('en-GB')],
                ...(version.decided_at
                  ? ([['decided at', new Date(version.decided_at).toLocaleString('en-GB')]] as Array<
                      [React.ReactNode, React.ReactNode]
                    >)
                  : []),
              ]}
            />
          </Card>

          {Object.keys(version.facets).length > 0 ? (
            <Card>
              <SectionTitle>
                Facets <span className="font-normal text-faint">— the only thing a gate reads</span>
              </SectionTitle>
              <div className="flex flex-col gap-2">
                {Object.entries(version.facets).map(([field, value]) => {
                  const p = version.provenance[field];
                  return (
                    <div key={field} className="flex flex-col gap-0.5">
                      <span className="font-mono text-2xs uppercase tracking-[0.05em] text-faint">
                        {field}
                      </span>
                      <span className="font-mono text-2xs">
                        {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
                      </span>
                      {p ? (
                        <Provenance
                          source={p.source}
                          confirmed={Boolean(p.confirmed_by)}
                          by={p.confirmed_by ?? p.by}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}

          <Card>
            <SectionTitle>Contributors</SectionTitle>
            <div className="flex flex-col gap-1">
              {version.contributors.map((c) => (
                <span key={c.principal} className="text-2xs">
                  <Mono>{c.principal}</Mono>{' '}
                  <span className="text-faint">
                    {c.kind === 'agent' ? '· agent' : c.kind === 'service' ? '· service' : '· human'}
                  </span>
                </span>
              ))}
            </div>
            <span className="text-2xs text-faint">
              Carried from the draft. &ldquo;An agent drafted this and a human proposed it&rdquo; is recorded
              rather than inferred.
            </span>
          </Card>
        </div>
      </div>
    </>
  );
}
