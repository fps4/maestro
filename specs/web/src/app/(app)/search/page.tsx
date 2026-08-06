import Link from 'next/link';
import { search } from '@/lib/api';
import { Chip, Empty, Mono, Notice, PageTitle, Sealed, relativeDate } from '@/components/atoms';

export const dynamic = 'force-dynamic';

/**
 * Search, within this workspace only.
 *
 * The boundary is stated on the page — not as a limitation but as the guarantee it is. The index
 * lives in this workspace's own database, so search cannot cross it by construction rather than by
 * a filter someone might forget.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const results = q ? await search(q).catch(() => []) : [];

  return (
    <>
      <div className="flex flex-col gap-3">
        <PageTitle>Search</PageTitle>
        <form action="/search" className="flex gap-2">
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="A word from a title, a body, or a facet"
            aria-label="Search this workspace"
            className="w-full max-w-xl rounded border border-rule-strong bg-surface px-2.5 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded border border-rule-strong bg-surface px-3 py-1.5 text-sm hover:bg-surface-2"
          >
            Search
          </button>
        </form>
        {q ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>
              {results.length} {results.length === 1 ? 'result' : 'results'}
            </span>
            <span className="text-faint">·</span>
            <span>facets and bodies</span>
          </div>
        ) : null}
      </div>

      {q && results.length === 0 ? (
        <Empty title={`Nothing in this workspace matches “${q}”.`}>
          Search covers titles, bodies and facets of every version. If you expected something from another
          workspace, it will never appear here — and that is the guarantee, not a gap.
        </Empty>
      ) : null}

      <div className="flex flex-col gap-3">
        {results.map((version) => (
          <Sealed
            key={`${version.artifact}@${version.ordinal}`}
            className="rounded-md border border-rule bg-surface p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/artifacts/${version.artifact}`}
                    className="font-mono text-xs font-semibold underline-offset-2 hover:underline"
                  >
                    {version.artifact}@{version.ordinal}
                  </Link>
                  <Chip state={version.state}>{version.state}</Chip>
                  <span className="text-2xs text-faint">{version.type.replace(/_/g, ' ')}</span>
                </div>
                <b className="text-sm">{version.title}</b>
              </div>
              <span className="text-2xs text-faint">{relativeDate(version.proposed_at)}</span>
            </div>
          </Sealed>
        ))}
      </div>

      <Notice title="Search cannot cross a workspace.">
        The index lives in this workspace&rsquo;s own database, so the boundary holds by construction rather
        than by a filter someone might forget. Aggregating across workspaces is the consumer&rsquo;s job, not
        this service&rsquo;s.
      </Notice>

      <p className="m-0 text-2xs text-faint">
        Bodies are excluded from these rows deliberately: inline bodies make the wrong query expensive, so
        every list projection leaves them out. <Mono>Read this version</Mono> fetches one.
      </p>
    </>
  );
}
