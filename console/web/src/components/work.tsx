/**
 * work-service's vocabulary as components: a row of the frontier, an item's state, who acts, and why
 * a row stands where it stands. The frontier is a ledger (ux.md rule 3); a row carries its due time
 * with the time left beside it, and its marks as words, never as colour alone (rule 7).
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chip, Empty, Mono, Notice, Scroller, Td, Th, cn } from './atoms';
import {
  CLASS_LABELS,
  ITEM_STATE_LABELS,
  OUTCOME_LABELS,
  aboutLabel,
  dueIn,
  markSentences,
  principalLabel,
  utc,
} from '@/lib/work-labels';
import type { FrontierRow, ItemState, Outcome } from '@/lib/work-types';
import { WorkError } from '@/lib/work';

const STATE_CHIP: Record<ItemState, string> = {
  open: 'draft',
  assigned: 'proposed',
  in_progress: 'proposed',
  blocked: 'expired',
  resolved: 'active',
  escalated: 'expired',
  closed: 'superseded',
};

export function ItemStateChip({ state, outcome }: { state: ItemState; outcome?: Outcome }) {
  if (state === 'closed' && outcome) {
    return <Chip state={outcome === 'done' ? 'accepted' : 'superseded'}>{OUTCOME_LABELS[outcome]}</Chip>;
  }
  return <Chip state={STATE_CHIP[state]}>{ITEM_STATE_LABELS[state]}</Chip>;
}

/** A principal: "you", an agent (dashed, rule 7: its contribution is not a person's), or an id. */
export function Who({ id, me }: { id?: string; me?: string }) {
  const { text, agent } = principalLabel(id, me);
  if (text === 'you' || text === 'nobody') return <span className="text-sm">{text}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {agent ? (
        <span className="rounded-sm border border-dashed border-rule-strong px-1 font-mono text-[10px] uppercase text-faint">
          agent
        </span>
      ) : null}
      <Mono className="text-xs">{text}</Mono>
    </span>
  );
}

export function MarkList({ row, me }: { row: Pick<FrontierRow, 'marks'>; me?: string }) {
  const sentences = markSentences(row.marks, me);
  if (sentences.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {sentences.map((s) => (
        <Chip key={s} state={s.startsWith('breached') ? 'rejected' : 'lapsed'} className="normal-case">
          {s}
        </Chip>
      ))}
    </span>
  );
}

export function Due({ iso, inline = false }: { iso: string; inline?: boolean }) {
  const { text, overdue } = dueIn(iso);
  return (
    <span className={inline ? 'flex flex-wrap items-baseline gap-2' : 'flex flex-col items-end'}>
      <Mono className="text-xs">{utc(iso)}</Mono>
      <span className={cn('text-2xs', overdue ? 'font-semibold text-critical' : 'text-faint')}>{text}</span>
    </span>
  );
}

/** Owed, the frontier's columns (ux.md): class · about · answerable · acting · due · next human touchpoint. */
export function FrontierTable({ rows, me, empty }: { rows: FrontierRow[]; me?: string; empty: ReactNode }) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <Scroller>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <Th>Item</Th>
            <Th>About</Th>
            <Th>State</Th>
            <Th>Answerable</Th>
            <Th>Acting</Th>
            <Th>Next person</Th>
            <Th right>Due</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.item_id} className="hover:bg-surface-2">
              <Td>
                <Link
                  href={`/items/${row.item_id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {row.title}
                </Link>
                <span className="flex flex-wrap items-center gap-1.5 pt-0.5 text-2xs text-faint">
                  <Mono>{row.item_id}</Mono>
                  <span>
                    {CLASS_LABELS[row.class]} · {row.severity.toUpperCase()}
                  </span>
                </span>
                <span className="block pt-1">
                  <MarkList row={row} me={me} />
                </span>
              </Td>
              <Td className="text-sm text-muted">{aboutLabel(row.about)}</Td>
              <Td>
                <ItemStateChip state={row.state} />
              </Td>
              <Td>
                <Who id={row.accountable} me={me} />
              </Td>
              <Td>
                {row.acting ? (
                  <Who id={row.acting} me={me} />
                ) : (
                  <span className="text-2xs text-faint">unclaimed</span>
                )}
              </Td>
              <Td>
                <Who id={row.next_human_touchpoint} me={me} />
              </Td>
              <Td right>
                <Due iso={row.due} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  );
}

/** What a page shows when the service it reads cannot answer: the reason, not a crash. */
export function WorkUnavailable({
  error,
  title = 'Work items are not available',
}: {
  error: unknown;
  title?: string;
}) {
  const message = error instanceof WorkError ? error.message : 'The service could not be read.';
  return (
    <Notice tone="warn" title={title}>
      {message}
    </Notice>
  );
}

export function NothingOwed({ title, children }: { title: string; children?: ReactNode }) {
  return <Empty title={title}>{children}</Empty>;
}

/** A ledger's filters are links, so a filtered view is a URL a person can keep or send. */
export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="eyebrow pr-1">{label}</span>
      {children}
    </div>
  );
}

export function FilterLink({ href, on, children }: { href: string; on: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? 'page' : undefined}
      className={cn(
        'rounded-sm border px-2 py-0.5',
        on
          ? 'border-rule-strong bg-surface-2 font-semibold text-ink'
          : 'border-transparent text-muted hover:text-ink',
      )}
    >
      {children}
    </Link>
  );
}
