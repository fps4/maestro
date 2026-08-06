import Link from 'next/link';
import { fetchLineage } from '@/lib/api';
import { Card, Empty, Eyebrow, Mono, PageTitle } from '@/components/atoms';

export const dynamic = 'force-dynamic';

/**
 * Lineage, in both directions.
 *
 * **The pinned edge is the only solid one.** Everything else follows a lineage and is drawn dashed,
 * so the distinction the whole audit chain rests on is visible before anyone reads the legend — and
 * the legend is there anyway.
 */
export default async function LineagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lineage = await fetchLineage(id);

  const byId = new Map(lineage.nodes.map((n) => [n.artifact, n]));
  const outgoing = lineage.edges.filter((e) => e.from === id);
  const incoming = lineage.edges.filter((e) => e.to === id);
  const root = byId.get(id);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Eyebrow>both directions, across links</Eyebrow>
        <PageTitle>Lineage of {root?.title ?? id}</PageTitle>
        <p className="text-sm text-muted">
          Why does this exist, and what happened to my idea — the same graph read from either end.
        </p>
      </div>

      {lineage.edges.length === 0 ? (
        <Empty title="Nothing links to or from this artifact yet.">
          Links are declared per type in the workspace definition. A lineage with no edges is a standalone
          record, not a broken one.
        </Empty>
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="text-sm font-semibold">
              Backward <span className="font-normal text-faint">— why does this exist</span>
            </h2>
            {outgoing.length === 0 ? (
              <p className="m-0 text-xs text-muted">This artifact points at nothing.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {outgoing.map((edge) => (
                  <Edge key={`${edge.type}-${edge.to}`} edge={edge} node={byId.get(edge.to)} direction="to" />
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="text-sm font-semibold">
              Forward <span className="font-normal text-faint">— what happened to my idea</span>
            </h2>
            {incoming.length === 0 ? (
              <p className="m-0 text-xs text-muted">
                Nothing points at this artifact yet. Forward edges into deployment and conformance arrive with
                the services that own them.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {incoming.map((edge) => (
                  <Edge
                    key={`${edge.type}-${edge.from}`}
                    edge={edge}
                    node={byId.get(edge.from)}
                    direction="from"
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-2xs text-muted">
        <Legend className="border-t-2 border-accent">pinned — frozen to a version at acceptance</Legend>
        <Legend className="border-t-2 border-dashed border-faint">
          follows the lineage — always the latest accepted
        </Legend>
        <Legend className="border-t-2 border-dotted border-faint">unresolved — nothing accepted yet</Legend>
      </div>
    </>
  );
}

function Edge({
  edge,
  node,
  direction,
}: {
  edge: { type: string; pinned: boolean; ordinal?: number; resolution: string };
  node?: { artifact: string; title: string; type: string; phase: string };
  direction: 'to' | 'from';
}) {
  const style = edge.pinned
    ? 'border-l-2 border-accent'
    : edge.resolution === 'unresolved'
      ? 'border-l-2 border-dotted border-faint'
      : 'border-l-2 border-dashed border-faint';

  return (
    <div className={`flex flex-col gap-0.5 pl-3 ${style}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-2xs uppercase tracking-[0.05em] text-faint">
          {direction === 'to' ? `${edge.type} →` : `← ${edge.type}`}
        </span>
        {edge.pinned ? (
          <span className="font-mono text-2xs font-semibold text-accent">
            PIN{edge.ordinal !== undefined ? ` @${edge.ordinal}` : ''}
          </span>
        ) : null}
      </div>
      {node ? (
        <Link href={`/artifacts/${node.artifact}`} className="text-sm underline-offset-2 hover:underline">
          {node.title}
        </Link>
      ) : null}
      <span className="text-2xs text-faint">
        <Mono>{node?.artifact ?? '—'}</Mono>
        {node ? ` · ${node.type.replace(/_/g, ' ')} · ${node.phase}` : ''}
      </span>
      {edge.pinned ? (
        <span className="text-2xs text-accent-ink">
          Reads against @{edge.ordinal}, whatever the lineage says now.
        </span>
      ) : null}
    </div>
  );
}

function Legend({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-5 ${className}`} />
      {children}
    </span>
  );
}
