import Link from 'next/link';
import { Card, KeyValue, Mono, Notice, PageTitle, SectionTitle } from '@/components/atoms';
import { Due, ItemStateChip, MarkList, WorkUnavailable, Who } from '@/components/work';
import { fetchBlocking, fetchItem, fetchMe } from '@/lib/work';
import {
  CLASS_LABELS,
  EVIDENCE_LABELS,
  aboutLabel,
  clockLabel,
  derivation,
  pullRequestUrl,
  utc,
} from '@/lib/work-labels';
import type { Blocking, Clock, EdgeRow, ItemView, WorkItem } from '@/lib/work-types';
import { Acts, LinkPullRequest } from './acts';

export const dynamic = 'force-dynamic';

/**
 * A work item (ux.md): the envelope; why it is with the reader (rule 8); the evidence plan — what
 * `done` requires, each a fact named to its event; its clocks, each shown with its derivation
 * (rule 4) and whether it was met; what it is about; what it waits on and what waits on it.
 *
 * Nothing here is typed in: a clock, a severity, the answerable person are resolved by the service
 * at raise, and the page shows them as derived.
 */
export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let view: ItemView;
  let blocking: Blocking;
  let me: string;
  try {
    [view, blocking, { principal: me }] = await Promise.all([fetchItem(id), fetchBlocking(id), fetchMe()]);
  } catch (error) {
    return (
      <>
        <PageTitle>{id}</PageTitle>
        <WorkUnavailable error={error} />
      </>
    );
  }
  const { item } = view;
  const closed = item.state === 'closed';
  const held = ['assigned', 'in_progress', 'blocked'].includes(item.state);
  const holder = held && item.assigned_to === me;
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-2 text-xs text-faint">
          <Link href="/owed" className="underline-offset-2 hover:underline">
            Owed
          </Link>
          <span>/</span>
          <Mono>{item.item_id}</Mono>
        </p>
        <PageTitle>{item.title}</PageTitle>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <ItemStateChip state={item.state} outcome={item.outcome} />
          <span>
            {CLASS_LABELS[item.class]}
            {item.remediation_class ? ` · ${item.remediation_class.replace(/_/g, ' ')}` : ''} ·{' '}
            {item.severity.toUpperCase()} · {aboutLabel(item.about)}
          </span>
          <MarkList row={view} me={me} />
        </div>
      </div>

      <WhyWithYou item={item} me={me} next={view.next_human_touchpoint} />

      {!closed ? (
        <Card>
          <SectionTitle>Act</SectionTitle>
          <Acts
            item={item.item_id}
            allowed={{
              claim: !held && item.state !== 'resolved',
              holder,
              state: item.state,
              closer: holder || item.accountable === me,
            }}
          />
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>What done requires</SectionTitle>
          <Evidence item={item} />
          {!closed &&
          !item.links?.pull_request &&
          item.evidence_plan.some((e) => e.kind === 'merged_change') ? (
            <LinkPullRequest item={item.item_id} />
          ) : null}
        </Card>

        <Card>
          <SectionTitle>Clocks</SectionTitle>
          <Clocks item={item} />
          <p className="text-2xs text-faint">
            Derived from policy, never typed: <Mono>{derivation(item)}</Mono>
          </p>
        </Card>

        <Card>
          <SectionTitle>About</SectionTitle>
          <About item={item} me={me} />
        </Card>

        <Card>
          <SectionTitle>Waits on, and waited on by</SectionTitle>
          <Edges blocking={blocking} item={item} me={me} />
        </Card>
      </div>
    </>
  );
}

/** Rule 8: why the item is in front of this person, and that the answerable person does not change. */
function WhyWithYou({ item, me, next }: { item: WorkItem; me: string; next: string }) {
  const held = ['assigned', 'in_progress', 'blocked'].includes(item.state);
  if (item.state === 'closed') {
    return (
      <Notice tone={item.outcome === 'done' ? 'ok' : 'neutral'} title={`Closed ${utc(item.closed_at!)}`}>
        {item.outcome === 'escalated_out'
          ? 'maestro was not allowed to act on this, and handed it back to the answerable person. '
          : ''}
        {item.reason ??
          (item.outcome !== 'done'
            ? ''
            : item.evidence_plan.length
              ? 'Every fact the evidence plan names is on the record.'
              : 'Resolved by its holder; it had no evidence plan.')}
      </Notice>
    );
  }
  const lines: string[] = [];
  const holds = held && item.assigned_to === me;
  const answers = item.accountable === me;
  if (holds && answers) lines.push('You hold it and answer for it: it is yours to move.');
  else if (holds) lines.push('You hold it: it is yours to move. Someone else answers for it.');
  else if (answers && held) lines.push('You answer for it while someone else acts on it.');
  else if (answers) lines.push('You answer for it, and nobody holds it.');
  if (item.chase?.to === me && item.accountable !== me && item.assigned_to !== me) {
    lines.push('A chase step reached you on it. The answerable person has not changed.');
  }
  if (lines.length === 0) return null;
  return (
    <Notice title="Why it is with you">
      {lines.join(' ')}{' '}
      {next !== me ? (
        <>
          The next person on it is <Who id={next} me={me} />.
        </>
      ) : null}
    </Notice>
  );
}

function Evidence({ item }: { item: WorkItem }) {
  if (item.evidence_plan.length === 0) {
    return <p className="text-xs text-muted">No evidence plan: it closes when its holder resolves it.</p>;
  }
  return (
    <ol className="flex flex-col gap-1.5 text-sm">
      {item.evidence_plan.map((e, i) => (
        <li key={i} className="flex items-baseline justify-between gap-3 border-b border-rule pb-1.5">
          <span className="flex flex-col">
            <span>{EVIDENCE_LABELS[e.kind]}</span>
            {e.satisfied_by ? <Mono className="text-2xs text-faint">{e.satisfied_by}</Mono> : null}
          </span>
          {e.satisfied_at ? (
            <span className="whitespace-nowrap text-xs text-accent-ink">met {utc(e.satisfied_at)}</span>
          ) : (
            <span className="whitespace-nowrap text-xs text-faint">waiting</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Clocks({ item }: { item: WorkItem }) {
  const met = (clock: Clock): string | null =>
    clock === 'respond_by'
      ? item.responded_at && (!item.respond_by || item.responded_at <= item.respond_by)
        ? `met ${utc(item.responded_at)}`
        : null
      : item.state === 'resolved' || item.outcome === 'done'
        ? 'met'
        : null;
  const rows: Array<[React.ReactNode, React.ReactNode]> = [];
  for (const clock of ['respond_by', 'resolve_by'] as const) {
    const at = item[clock];
    if (!at) continue;
    const breached = item.breached?.includes(clock);
    rows.push([
      clockLabel(clock),
      <span key={clock} className="flex flex-wrap items-baseline gap-2">
        <Mono>{utc(at)}</Mono>
        {breached ? (
          <b className="text-critical">breached</b>
        ) : (
          <span className="text-faint">{met(clock) ?? ''}</span>
        )}
      </span>,
    ]);
  }
  rows.push(['review by', <Mono key="review">{utc(item.review_by)}</Mono>]);
  if (item.lease_expires_at && ['assigned', 'in_progress', 'blocked'].includes(item.state)) {
    rows.push(['lease', <Due key="lease" iso={item.lease_expires_at} inline />]);
  }
  if (item.chase) {
    rows.push([
      'ladder',
      <span key="ladder">
        {item.chase.ladder}: {item.chase.next} of {item.chase.steps.length} steps fired, then the breach
      </span>,
    ]);
  }
  return <KeyValue rows={rows} />;
}

function About({ item, me }: { item: WorkItem; me: string }) {
  const pr = item.links?.pull_request;
  const rows: Array<[React.ReactNode, React.ReactNode]> = [
    ['answerable', <Who key="a" id={item.accountable} me={me} />],
    ['acting', item.assigned_to ? <Who key="h" id={item.assigned_to} me={me} /> : 'nobody'],
    ['seat', <Mono key="s">{item.seat}</Mono>],
    ['oversight', <Mono key="o">{item.oversight_level}</Mono>],
    ['consequence', <Mono key="c">{item.consequence_class}</Mono>],
  ];
  if (item.about.application) rows.push(['application', <Mono key="app">{aboutLabel(item.about)}</Mono>]);
  if (item.tier) rows.push(['tier', <Mono key="t">{item.tier}</Mono>]);
  if (item.onboarding_level)
    rows.push(['onboarding', <Mono key="n">{item.onboarding_level.toUpperCase()}</Mono>]);
  if (item.reversible !== undefined) rows.push(['reversible', item.reversible ? 'yes' : 'no']);
  rows.push([
    'raised',
    <span key="r">
      {utc(item.opened_at)} by {item.raised_by}
      {item.raised_cause ? ` · ${item.raised_cause}` : ''} · <Who id={item.raised_by_principal} me={me} />
    </span>,
  ]);
  if (item.fingerprint) {
    rows.push([
      'signal',
      <span key="f">
        <Mono>{item.fingerprint}</Mono>
        {item.signals ? ` · ${item.signals} more attached` : ''}
      </span>,
    ]);
  }
  if (item.fold) rows.push(['folded into', <Mono key="fold">{item.fold}</Mono>]);
  if (pr) {
    const url = pullRequestUrl(pr);
    rows.push([
      'pull request',
      url ? (
        <a key="pr" href={url} className="font-mono underline underline-offset-2">
          {pr}
        </a>
      ) : (
        <Mono key="pr">{pr}</Mono>
      ),
    ]);
  }
  if (item.links?.artifact) {
    rows.push([
      'artifact',
      <Link
        key="art"
        href={`/artifacts/${item.links.artifact}`}
        className="font-mono underline underline-offset-2"
      >
        {item.links.artifact}
      </Link>,
    ]);
  }
  return <KeyValue rows={rows} />;
}

function Edges({ blocking, item, me }: { blocking: Blocking; item: WorkItem; me: string }) {
  const nothing =
    blocking.blocked_by.length === 0 && blocking.blocks.length === 0 && !item.parent && !item.milestone;
  if (nothing)
    return <p className="text-xs text-muted">Nothing open waits on it, and it waits on nothing.</p>;
  return (
    <div className="flex flex-col gap-3 text-sm">
      {item.parent ? <ItemRef label="Part of" id={item.parent} /> : null}
      {item.milestone ? <ItemRef label="Milestone" id={item.milestone} /> : null}
      <EdgeList label="Waits on" rows={blocking.blocked_by} me={me} />
      <EdgeList label="Waited on by" rows={blocking.blocks} me={me} />
    </div>
  );
}

function ItemRef({ label, id }: { label: string; id: string }) {
  return (
    <p className="text-xs">
      <span className="eyebrow pr-2">{label}</span>
      <Link href={`/items/${id}`} className="font-mono underline underline-offset-2">
        {id}
      </Link>
    </p>
  );
}

function EdgeList({ label, rows, me }: { label: string; rows: EdgeRow[]; me: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      {rows.map((r) => (
        <Link
          key={r.item_id}
          href={`/items/${r.item_id}`}
          className="flex items-baseline justify-between gap-3 border-b border-rule pb-1 hover:bg-surface-2"
        >
          <span>
            {r.title} <Mono className="text-2xs text-faint">{r.item_id}</Mono>
          </span>
          <span className="text-2xs text-faint">
            <Who id={r.accountable} me={me} /> · {utc(r.due)}
          </span>
        </Link>
      ))}
    </div>
  );
}
