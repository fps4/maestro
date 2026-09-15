/**
 * The vocabulary above the primitives — the approved design in
 * `docs/design/ui/console-mock.html`, as components.
 *
 * Two rules carry most of this file.
 *
 * **State is form as well as colour.** A dashed outline means in flight, a filled chip means
 * decided, a strike means retracted. Remove the hue and the chips still read, which matters because
 * some readers cannot separate them and because a record printed to paper is still a record.
 *
 * **A draft and a version must never look like the same object.** Drafts carry dashed edges and
 * live controls; versions carry a solid rule, a monospace digest, and no edit affordance at all.
 * That is the draft/version split rendered rather than described.
 */

import Link from 'next/link';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ReactNode } from 'react';
import type { VersionState } from '@/lib/types';

export const cn = (...parts: Array<string | false | null | undefined>) => twMerge(clsx(parts));

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[0.92em]', className)}>{children}</span>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-xl font-semibold tracking-[-0.018em] text-balance">{children}</h1>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold">{children}</h2>;
}

export function Card({
  children,
  className,
  flat = false,
}: {
  children: ReactNode;
  className?: string;
  flat?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-md border border-rule p-4',
        flat ? 'bg-surface-2' : 'bg-surface',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A version: sealed. Solid rule, nothing to edit, because nothing about it can change. */
export function Sealed({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('border-l-[3px] border-rule-strong pl-3', className)}>{children}</div>;
}

/** A draft: open. Dashed, so the mutable/immutable line is carried by the frame, not by a label. */
export function OpenEdit({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('border-l-[3px] border-dashed border-rule-strong pl-3', className)}>{children}</div>
  );
}

const CHIP_BASE =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 py-px font-mono text-2xs uppercase tracking-[0.04em]';

const STATE_STYLES: Record<string, string> = {
  proposed: 'border-dashed border-accent text-accent-ink bg-surface',
  accepted: 'border-accent bg-accent-soft text-accent-ink font-semibold',
  draft: 'border-dashed border-rule-strong text-faint bg-surface',
  superseded: 'border-rule-strong text-faint bg-surface-2',
  rejected: 'border-critical bg-critical-soft text-critical',
  expired: 'border-warning bg-warning-soft text-warning',
  lapsed: 'border-warning bg-warning-soft text-warning',
  withdrawn: 'border-rule-strong text-faint line-through bg-surface',
  active: 'border-accent bg-accent-soft text-accent-ink font-semibold',
  overridden: 'border-critical bg-critical-soft text-critical',
  pin: 'border-accent bg-accent-soft text-accent-ink font-semibold',
  neutral: 'border-rule-strong text-muted bg-surface',
};

export function Chip({
  state = 'neutral',
  children,
  className,
}: {
  state?: VersionState | keyof typeof STATE_STYLES | string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(CHIP_BASE, STATE_STYLES[state] ?? STATE_STYLES.neutral, className)}>{children}</span>
  );
}

/**
 * Provenance, per field.
 *
 * A dotted underline for declared, a dashed amber one for extracted-and-unconfirmed. It travels
 * with the value onto the version, because *extracted-and-confirmed* and *declared* carry different
 * assurance weight and a reader is entitled to know which they are looking at.
 */
export function Provenance({ source, confirmed, by }: { source: string; confirmed?: boolean; by?: string }) {
  const label =
    source === 'extracted' ? (confirmed ? 'extracted · confirmed' : 'extracted · unconfirmed') : source;
  const style =
    source === 'extracted' && !confirmed
      ? 'text-warning border-warning border-dashed'
      : source === 'reconstructed'
        ? 'text-faint border-rule-strong border-double'
        : 'text-muted border-rule-strong border-dotted';
  return (
    <span className={cn('inline-block border-b font-mono text-[10px] uppercase tracking-[0.05em]', style)}>
      {label}
      {by ? ` · ${by}` : ''}
    </span>
  );
}

export function Tile({ value, label, alert = false }: { value: ReactNode; label: string; alert?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-px rounded border p-3',
        alert ? 'border-warning bg-warning-soft' : 'border-rule bg-surface-2',
      )}
    >
      <b className={cn('text-2xl font-semibold tracking-[-0.02em] tabular', alert && 'text-warning')}>
        {value}
      </b>
      <span className={cn('text-xs', alert ? 'text-warning' : 'text-muted')}>{label}</span>
    </div>
  );
}

export function Notice({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: 'neutral' | 'warn' | 'hard' | 'ok';
  title?: ReactNode;
  children: ReactNode;
}) {
  const tones = {
    neutral: 'border-l-rule-strong bg-surface-2 text-ink',
    warn: 'border-l-warning bg-warning-soft text-warning',
    hard: 'border-l-critical bg-critical-soft text-critical',
    ok: 'border-l-accent bg-accent-soft text-accent-ink',
  } as const;
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-sm border border-rule-strong border-l-[3px] px-3 py-2.5 text-xs',
        tones[tone],
      )}
    >
      {title ? <b className="font-semibold">{title}</b> : null}
      <span>{children}</span>
    </div>
  );
}

/**
 * A body rendered server-side against a strict allow-list.
 *
 * The only place `dangerouslySetInnerHTML` is used, and only over html the api sanitised. Bodies
 * are written by humans and agents and read by other people in the same workspace; raw authored
 * content never reaches this element.
 */
export function Rendered({ html, className }: { html: string; className?: string }) {
  return (
    <article
      className={cn(
        'max-w-none rounded border border-rule-strong bg-surface px-4 py-3 text-sm leading-[1.65] [&_a]:underline [&_code]:font-mono [&_code]:text-xs [&_h2]:mb-1 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_p]:mb-2 [&_table]:w-full [&_td]:border-b [&_td]:border-rule [&_td]:py-1 [&_th]:border-b [&_th]:border-rule-strong [&_th]:py-1 [&_th]:text-left [&_ul]:mb-2 [&_ul]:list-disc',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function KeyValue({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto,1fr] items-baseline gap-x-3.5 gap-y-1 text-xs">
      {rows.map(([key, value], i) => (
        <div key={i} className="contents">
          <dt className="whitespace-nowrap font-mono text-2xs uppercase tracking-[0.05em] text-faint">
            {key}
          </dt>
          <dd className="m-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Button({
  children,
  href,
  variant = 'default',
  size = 'md',
  className,
  ...props
}: {
  children: ReactNode;
  href?: string;
  variant?: 'default' | 'primary' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = cn(
    'inline-flex items-center justify-center whitespace-nowrap rounded border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
    size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1.5 text-sm',
    variant === 'primary'
      ? 'border-accent bg-accent text-accent-on hover:bg-accent-ink hover:border-accent-ink'
      : variant === 'danger'
        ? 'border-critical bg-surface text-critical hover:bg-critical-soft'
        : 'border-rule-strong bg-surface text-ink hover:bg-surface-2',
    className,
  );
  if (href) {
    return (
      <Link href={href} className={styles}>
        {children}
      </Link>
    );
  }
  return (
    <button className={styles} {...props}>
      {children}
    </button>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-md border border-dashed border-rule-strong bg-surface-2 px-4 py-6">
      <b className="text-sm font-semibold">{title}</b>
      {children ? <span className="max-w-[60ch] text-xs text-muted">{children}</span> : null}
    </div>
  );
}

/** Wide content scrolls inside its own container, so the page body never scrolls sideways. */
export function Scroller({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-rule-strong pb-1.5 pr-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint',
        right ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  right,
  className,
}: {
  children: ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        'border-b border-rule py-2 pr-2.5 align-baseline',
        right && 'pr-3.5 text-right',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function relativeDate(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} d ago`;
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function shortDigest(digest: string): string {
  const [algo, hex] = digest.split(':');
  if (!hex || hex.length < 12) return digest;
  return `${algo}:${hex.slice(0, 6)}…${hex.slice(-4)}`;
}
