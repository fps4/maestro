import { Mono, PageTitle, Scroller, SectionTitle, Td, Th, Tile } from '@/components/atoms';
import { FilterGroup, FilterLink, FrontierTable, NothingOwed, WorkUnavailable } from '@/components/work';
import { consolePreferences, rememberChoice } from '@/lib/preferences';
import { fetchFrontier, fetchMe, fetchRates } from '@/lib/work';
import type { FrontierRow, Rates } from '@/lib/work-types';

export const dynamic = 'force-dynamic';

const WHO = {
  all: 'Everything',
  mine: 'Mine',
  agents: 'Held by agents',
  unclaimed: 'Unclaimed',
} as const;
type Who = keyof typeof WHO;

const WEEK = 7 * 86_400_000;

/**
 * Owed: the frontier (ux.md) — what is owed now across the workspace, soonest first. A ledger, not
 * a tree (rule 3), filtered by application and by mine · held by agents · unclaimed (rule 10).
 *
 * The tiles read before the list: breached, due this week, held by agents, and the escalated-out
 * rate per application — an outcome and a rate, the argument for the next onboarding level, never
 * styled as a failure (rule 9).
 */
export default async function OwedPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string; application?: string; set?: string }>;
}) {
  // A filter link carries `set`: a choice, remembered on the person's profile (ADR-0029). A URL with no
  // filters — the rail's — opens on the last choice; one with its filters in it shows what it says.
  const url = await searchParams;
  const chosen = url.set !== undefined || url.who !== undefined || url.application !== undefined;
  const params = chosen ? url : ((await consolePreferences()).owed ?? {});
  const who: Who = params.who && params.who in WHO ? (params.who as Who) : 'all';
  const application = params.application || undefined;
  if (url.set !== undefined) await rememberChoice('owed', { who, ...(application ? { application } : {}) });

  let all: FrontierRow[];
  let me: string;
  try {
    [all, { principal: me }] = await Promise.all([fetchFrontier(), fetchMe()]);
  } catch (error) {
    return (
      <>
        <PageTitle>Owed</PageTitle>
        <WorkUnavailable error={error} />
      </>
    );
  }

  const applications = [
    ...new Set(all.map((r) => r.about.application).filter((a): a is string => !!a)),
  ].sort();
  const mine = who === 'mine' ? await fetchFrontier({ for: 'me' }) : [];
  const rows = (who === 'mine' ? mine : all)
    .filter((r) => !application || r.about.application === application)
    .filter((r) => who !== 'agents' || isAgent(r.acting))
    .filter((r) => who !== 'unclaimed' || !r.acting);

  const rates = await Promise.all(
    (application ? [application] : applications).map((a) => fetchRates(a).catch((): Rates | null => null)),
  );

  const scope = all.filter((r) => !application || r.about.application === application);
  const now = Date.now();
  const breached = scope.filter((r) => r.marks?.breached?.length).length;
  const dueThisWeek = scope.filter((r) => Date.parse(r.due) - now < WEEK).length;
  const byAgents = scope.filter((r) => isAgent(r.acting)).length;

  return (
    <>
      <div className="flex flex-col gap-1">
        <PageTitle>Owed</PageTitle>
        <p className="text-sm text-muted">What is owed now in this workspace, soonest first.</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        <Tile value={breached} label="Breached" alert={breached > 0} />
        <Tile value={dueThisWeek} label="Due this week" />
        <Tile value={byAgents} label="Held by agents" />
      </div>

      <Filters who={who} application={application} applications={applications} />

      <FrontierTable
        rows={rows}
        me={me}
        empty={
          <NothingOwed title="Nothing owed here.">
            Nothing open matches these filters. An item closes on evidence or with a reason, and leaves this
            ledger when it does.
          </NothingOwed>
        }
      />
      <p className="text-2xs text-faint">
        {rows.length} {rows.length === 1 ? 'item' : 'items'} · a closed item leaves the ledger; its history
        stays on the item
      </p>

      <RatesTable rates={rates.filter((r): r is Rates => r !== null)} />
    </>
  );
}

const isAgent = (principal?: string): boolean => !!principal && !principal.startsWith('prn-h-');

function Filters({
  who,
  application,
  applications,
}: {
  who: Who;
  application?: string;
  applications: string[];
}) {
  const href = (w: Who, a?: string) => {
    const q = new URLSearchParams({ set: '1' });
    if (w !== 'all') q.set('who', w);
    if (a) q.set('application', a);
    return `/owed?${q}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
      <FilterGroup label="Who">
        {(Object.keys(WHO) as Who[]).map((w) => (
          <FilterLink key={w} href={href(w, application)} on={w === who}>
            {WHO[w]}
          </FilterLink>
        ))}
      </FilterGroup>
      {applications.length > 0 ? (
        <FilterGroup label="Application">
          <FilterLink href={href(who)} on={!application}>
            All
          </FilterLink>
          {applications.map((a) => (
            <FilterLink key={a} href={href(who, a)} on={a === application}>
              <Mono>{a}</Mono>
            </FilterLink>
          ))}
        </FilterGroup>
      ) : null}
    </div>
  );
}

/** Closures by outcome per application: `escalated_out` beside `done`, as a rate, not an alarm. */
function RatesTable({ rates }: { rates: Rates[] }) {
  if (rates.length === 0) return null;
  const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <SectionTitle>Escalated out, per application</SectionTitle>
        <p className="text-xs text-muted">
          What maestro handed back because the application’s onboarding level does not let it act — the
          argument for the next level, not a failure.
        </p>
      </div>
      <Scroller>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Application</Th>
              <Th right>Done</Th>
              <Th right>Escalated out</Th>
              <Th right>Other closures</Th>
              <Th right>Escalated-out rate</Th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => {
              const done = r.closed.done ?? 0;
              const out = r.closed.escalated_out ?? 0;
              const other = Object.values(r.closed).reduce((a, b) => a + b, 0) - done - out;
              return (
                <tr key={r.application}>
                  <Td>
                    <Mono>{r.application}</Mono>
                  </Td>
                  <Td right className="tabular">
                    {done}
                  </Td>
                  <Td right className="tabular">
                    {out}
                  </Td>
                  <Td right className="tabular">
                    {other}
                  </Td>
                  <Td right className="tabular font-semibold">
                    {pct(r.escalated_out_rate)}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Scroller>
    </section>
  );
}
