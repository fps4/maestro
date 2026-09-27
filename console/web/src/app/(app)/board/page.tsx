import Link from 'next/link';
import { Mono, PageTitle } from '@/components/atoms';
import { FilterGroup, FilterLink, MarkList, WorkUnavailable, Who } from '@/components/work';
import { consolePreferences, rememberChoice } from '@/lib/preferences';
import { fetchBoard, fetchFrontier, fetchMe } from '@/lib/work';
import { CLASS_LABELS, ITEM_STATE_LABELS, OUTCOME_LABELS, dueIn } from '@/lib/work-labels';
import type { Board, BoardColumn, FrontierRow } from '@/lib/work-types';

export const dynamic = 'force-dynamic';

const COLUMNS: BoardColumn[] = ['open', 'assigned', 'in_progress', 'blocked', 'escalated', 'resolved'];

/**
 * The board (ux.md): the open set by state, one column per state of the machine, and what closed
 * today — with the machine written under it, so a reader knows what moves a card and who may.
 * Filtered by application. Cards do not drag: a state changes by an act on the item, recorded.
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ application?: string; set?: string }>;
}) {
  // As on Owed: a filter link carries `set` and is remembered (ADR-0029); a bare URL opens on the last.
  const url = await searchParams;
  const params =
    url.set !== undefined || url.application !== undefined ? url : ((await consolePreferences()).board ?? {});
  const application = params.application || undefined;
  if (url.set !== undefined) await rememberChoice('board', application ? { application } : {});

  let board: Board;
  let applications: string[];
  let me: string;
  try {
    const [b, all, who] = await Promise.all([fetchBoard({ application }), fetchFrontier(), fetchMe()]);
    board = b;
    me = who.principal;
    applications = [...new Set(all.map((r) => r.about.application).filter((a): a is string => !!a))].sort();
  } catch (error) {
    return (
      <>
        <PageTitle>Board</PageTitle>
        <WorkUnavailable error={error} />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <PageTitle>Board</PageTitle>
        <p className="text-sm text-muted">The open items by state, and what closed today.</p>
      </div>

      {applications.length > 0 ? (
        <FilterGroup label="Application">
          <FilterLink href="/board?set=1" on={!application}>
            All
          </FilterLink>
          {applications.map((a) => (
            <FilterLink
              key={a}
              href={`/board?set=1&application=${encodeURIComponent(a)}`}
              on={a === application}
            >
              <Mono>{a}</Mono>
            </FilterLink>
          ))}
        </FilterGroup>
      ) : null}

      <div className="overflow-x-auto">
        <div className="grid min-w-[1100px] grid-cols-7 gap-2.5">
          {COLUMNS.map((c) => (
            <Column key={c} title={ITEM_STATE_LABELS[c]} count={board.columns[c].length}>
              {board.columns[c].map((row) => (
                <Card key={row.item_id} row={row} me={me} />
              ))}
            </Column>
          ))}
          <Column title="Closed today" count={board.closed_today.length} closed>
            {board.closed_today.map((row) => (
              <Card key={row.item_id} row={row} me={me} footer={OUTCOME_LABELS[row.outcome]} />
            ))}
          </Column>
        </div>
      </div>

      <p className="max-w-[90ch] text-2xs leading-relaxed text-faint">
        <b className="font-semibold text-muted">The machine.</b> An item is raised <i>open</i>. A claim that
        passes the checks makes it <i>assigned</i> to its holder, who moves it <i>in progress</i> or{' '}
        <i>blocked</i>, and back. A claim refused at the application’s onboarding level makes it{' '}
        <i>escalated</i> to the answerable person and closes it <i>escalated out</i>. The holder resolves it,
        and it closes <i>done</i> when every fact its evidence plan names is on the record; until then it is{' '}
        <i>resolved · evidence owed</i>. A release or an expired lease returns it to <i>open</i>. The
        answerable person never changes.
      </p>
    </>
  );
}

function Column({
  title,
  count,
  closed = false,
  children,
}: {
  title: string;
  count: number;
  closed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex flex-col gap-2 rounded-md border border-rule p-2 ${closed ? 'bg-surface' : 'bg-surface-2'}`}
    >
      <header className="flex items-baseline justify-between px-1">
        <span className="eyebrow">{title}</span>
        <span className="font-mono text-2xs text-faint">{count}</span>
      </header>
      {children}
    </section>
  );
}

function Card({ row, me, footer }: { row: FrontierRow; me: string; footer?: string }) {
  const due = dueIn(row.due);
  return (
    <Link
      href={`/items/${row.item_id}`}
      className="flex flex-col gap-1 rounded border border-rule bg-surface p-2 text-xs hover:border-rule-strong"
    >
      <span className="font-medium text-ink">{row.title}</span>
      <span className="flex flex-wrap gap-x-1.5 text-2xs text-faint">
        <Mono>{row.item_id}</Mono>
        <span>
          {CLASS_LABELS[row.class]} · {row.severity.toUpperCase()}
        </span>
        {row.about.application ? <Mono>{row.about.application}</Mono> : null}
      </span>
      {row.acting ? (
        <span className="text-2xs">
          <Who id={row.acting} me={me} />
        </span>
      ) : null}
      <MarkList row={row} me={me} />
      <span className={`text-2xs ${due.overdue && !footer ? 'font-semibold text-critical' : 'text-faint'}`}>
        {footer ?? due.text}
      </span>
    </Link>
  );
}
