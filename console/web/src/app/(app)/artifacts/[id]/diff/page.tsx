import { fetchDiff } from '@/lib/api';
import { Card, Eyebrow, Notice, PageTitle, SectionTitle, shortDigest } from '@/components/atoms';

export const dynamic = 'force-dynamic';

/**
 * Diff — *what changed and who accepted it* is the primary audit question.
 *
 * Facet diff and body diff side by side: a gate reads the left column and a human reads the right,
 * and confirming an extraction is a human act on both at once.
 *
 * The accent appears here for *added* and critical for *removed* — the one place the accent is not
 * about lifecycle state, and it is still about what changed.
 */
export default async function DiffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const from = Number(query.from ?? 1);
  const to = Number(query.to ?? 2);

  const diff = await fetchDiff(id, from, to);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Eyebrow>what changed, and who accepted it</Eyebrow>
        <PageTitle>
          {id} · @{diff.from.ordinal} → @{diff.to.ordinal}
        </PageTitle>
        <div className="flex flex-wrap items-center gap-2 font-mono text-2xs text-faint">
          <span>{shortDigest(diff.from.digest)}</span>
          <span>→</span>
          <span>{shortDigest(diff.to.digest)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-2.5">
          <SectionTitle>
            Facet diff <span className="font-normal text-faint">— structural, every type</span>
          </SectionTitle>

          {diff.facets.changes.length === 0 && diff.facets.provenance.length === 0 ? (
            <Card flat>
              <p className="m-0 text-xs text-muted">No facet changed between these two versions.</p>
            </Card>
          ) : (
            <Card className="gap-3">
              {diff.facets.changes.map((change) => (
                <div key={`${change.kind}-${change.field}`} className="flex flex-col gap-0.5">
                  <span className="font-mono text-2xs uppercase tracking-[0.05em] text-faint">
                    {change.kind} · {change.field}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {change.before !== undefined ? (
                      <span className="font-mono text-critical line-through">{render(change.before)}</span>
                    ) : null}
                    {change.before !== undefined && change.after !== undefined ? (
                      <span className="text-faint">→</span>
                    ) : null}
                    {change.after !== undefined ? (
                      <span className="font-mono font-semibold text-accent-ink">{render(change.after)}</span>
                    ) : null}
                  </div>
                </div>
              ))}

              {diff.facets.provenance.map((change) => (
                <div key={`prov-${change.field}`} className="flex flex-col gap-0.5">
                  <span className="font-mono text-2xs uppercase tracking-[0.05em] text-faint">
                    provenance · {change.field}
                  </span>
                  <span className="text-xs text-muted">
                    {describeProvenance(change.before)} <span className="text-faint">→</span>{' '}
                    {describeProvenance(change.after)}
                  </span>
                </div>
              ))}
            </Card>
          )}

          <SectionTitle>Link diff</SectionTitle>
          <Card>
            {diff.links.added.length === 0 &&
            diff.links.removed.length === 0 &&
            diff.links.repointed.length === 0 ? (
              <p className="m-0 text-xs text-muted">No link changed.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {diff.links.added.map((l) => (
                  <span key={`a-${l.type}${l.target}`} className="font-mono text-sm text-accent-ink">
                    + {l.type} → {l.target}
                  </span>
                ))}
                {diff.links.removed.map((l) => (
                  <span key={`r-${l.type}${l.target}`} className="font-mono text-sm text-critical">
                    − {l.type} → {l.target}
                  </span>
                ))}
                {diff.links.repointed.map((l) => (
                  <span key={`p-${l.type}`} className="font-mono text-sm text-warning">
                    ~ {l.type}: {l.before.target} → {l.after.target}
                  </span>
                ))}
              </div>
            )}
            <span className="text-2xs text-faint">
              No pinned link is affected. A pin, once frozen, cannot appear in a diff as repointed — the
              operation does not exist.
            </span>
          </Card>
        </div>

        <div className="flex flex-col gap-2.5">
          <SectionTitle>
            Body diff <span className="font-normal text-faint">— per format, {diff.body.format}</span>
          </SectionTitle>

          {diff.body.format_changed ? (
            <Notice tone="warn" title="The body format changed between these versions.">
              A diff across two formats compares different kinds of thing. Read each version instead.
            </Notice>
          ) : null}

          {diff.body.unchanged ? (
            <Card flat>
              <p className="m-0 text-xs text-muted">The body is byte-identical between these versions.</p>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded border border-rule font-mono text-xs leading-[1.7]">
              {diff.body.hunks.map((hunk, i) => (
                <div key={i}>
                  {hunk.lines.map((line, j) => (
                    <div
                      key={j}
                      className={
                        hunk.kind === 'added'
                          ? 'bg-accent-soft px-2.5 text-accent-ink'
                          : hunk.kind === 'removed'
                            ? 'bg-critical-soft px-2.5 text-critical'
                            : 'px-2.5 text-muted'
                      }
                    >
                      {hunk.kind === 'added' ? '+ ' : hunk.kind === 'removed' ? '− ' : '  '}
                      {line || ' '}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <p className="m-0 text-2xs text-faint">
            A body diff a reviewer cannot read is a defect in the format, not in the reviewer. The bar is
            whether a non-technical owner can confirm their intent was captured.
          </p>
        </div>
      </div>
    </>
  );
}

function render(value: unknown): string {
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

function describeProvenance(p?: { source: string; confirmed: boolean }): string {
  if (!p) return 'none';
  return p.source === 'extracted'
    ? p.confirmed
      ? 'extracted · confirmed'
      : 'extracted · unconfirmed'
    : p.source;
}
