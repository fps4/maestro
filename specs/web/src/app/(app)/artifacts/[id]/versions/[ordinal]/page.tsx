import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchLabels, fetchVersion } from '@/lib/api';
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
  const labels = await fetchLabels();

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

          {/* Rendered server-side against a strict allow-list. Never `dangerouslySetInnerHTML` over
              raw authored content — bodies are written by humans and agents and read by other people
              in the same workspace. */}
          <article
            className="max-w-none rounded border border-rule-strong bg-surface px-4 py-3 text-sm leading-[1.65] [&_a]:underline [&_code]:font-mono [&_code]:text-xs [&_h2]:mb-1 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_p]:mb-2 [&_table]:w-full [&_td]:border-b [&_td]:border-rule [&_td]:py-1 [&_th]:border-b [&_th]:border-rule-strong [&_th]:py-1 [&_th]:text-left [&_ul]:mb-2 [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: rendered?.html ?? '' }}
          />
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
