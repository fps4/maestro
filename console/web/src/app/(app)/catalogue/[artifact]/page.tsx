import { notFound } from 'next/navigation';
import { fetchStandard } from '@/lib/api';
import {
  Card,
  Chip,
  Eyebrow,
  KeyValue,
  Mono,
  Notice,
  PageTitle,
  Sealed,
  SectionTitle,
  shortDigest,
} from '@/components/atoms';

export const dynamic = 'force-dynamic';

/**
 * One standard, in full.
 *
 * For a platform standard the body **is** the authoritative text, including the know-how — why we
 * hold it, what counts as satisfying it, how to satisfy it cheaply. That is the part an agent needs
 * and a citation cannot give.
 *
 * For an external one the body is our summary and our reading, and the authoritative source is
 * cited in the facets. The page says which, prominently, because the difference is the whole point.
 */
export default async function StandardPage({ params }: { params: Promise<{ artifact: string }> }) {
  const { artifact } = await params;

  let data;
  try {
    data = await fetchStandard(artifact);
  } catch {
    notFound();
  }
  const { standard, rendered } = data;
  const facets = standard.facets as Record<string, unknown>;
  const ours = standard.type === 'platform_standard';

  return (
    <>
      <Sealed className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip state={standard.state}>{standard.state}</Chip>
          <Chip>{standard.type}</Chip>
          <span className="font-mono text-2xs text-faint">
            @{standard.ordinal} · {shortDigest(standard.digest)}
          </span>
          {standard.materiality ? (
            <Chip state={standard.materiality === 'material' ? 'expired' : 'neutral'}>
              {standard.materiality}
            </Chip>
          ) : null}
        </div>
        <Eyebrow>{String(facets.standard_id ?? artifact)}</Eyebrow>
        <PageTitle>{standard.title}</PageTitle>
      </Sealed>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.75fr),minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-2">
            <SectionTitle>
              {ours ? 'Full text' : 'Our summary and our reading'}{' '}
              <span className="font-normal text-faint">
                — {ours ? 'ours, so the body is the standard' : 'not the licensed text'}
              </span>
            </SectionTitle>
            <span className="font-mono text-2xs text-faint">{standard.body.format} · rendered</span>
          </div>

          {!ours ? (
            <Notice tone="warn" title="This is not the authoritative text.">
              The obligation is {String((facets.authority_body as string) ?? 'an external body')}&rsquo;s.
              What is below is our summary and our interpretation of it, held under{' '}
              <Mono>{String(facets.licence_disposition ?? 'an unrecorded disposition')}</Mono>. Quote the
              source, not this page.
            </Notice>
          ) : null}

          {/* Rendered server-side against a strict allow-list. Bodies are authored by humans *and
              agents* and read by other people in the same workspace, so unsanitised HTML would be
              stored XSS against exactly the people the record exists to protect. */}
          <article
            className="prose-sm max-w-none rounded border border-rule-strong bg-surface px-4 py-3 font-mono text-xs leading-[1.7] [&_a]:underline [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:font-bold [&_li]:ml-4 [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />

          <p className="m-0 text-2xs text-faint">
            This is the body a person reads and an agent retrieves. A gate does not read it — it reads the
            machine-evaluable facets alongside.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>
              Machine-evaluable facets{' '}
              <span className="font-normal text-faint">— what a gate and an evaluator read</span>
            </SectionTitle>
            <KeyValue
              rows={Object.entries(facets)
                .filter(([k]) => k !== 'standard_id')
                .map(([key, value]) => [
                  key,
                  <span key={key} className="font-mono text-2xs">
                    {typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}
                  </span>,
                ])}
            />
          </Card>

          {standard.effective ? (
            <Card>
              <SectionTitle>In force</SectionTitle>
              <KeyValue
                rows={[
                  ['from', <Mono key="f">{standard.effective.effective_from ?? 'undated'}</Mono>],
                  ['to', <Mono key="t">{standard.effective.effective_to ?? 'open'}</Mono>],
                  ['on lapse', <Mono key="l">{standard.effective.lapse_behaviour ?? 'fail'}</Mono>],
                ]}
              />
              <p className="m-0 text-2xs text-faint">
                Accepted and <i>in force</i> are different questions. A standard can lapse with nothing
                following it, and the pack states what a claim resting on it becomes.
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
