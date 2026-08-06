import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { currentToken, currentWorkspace, signOut } from '@/lib/auth';
import { displayName, initials } from '@/lib/session';
import { fetchDefinition } from '@/lib/api';

/**
 * The authenticated shell: rail, top bar, content.
 *
 * **The `(app)` / `(auth)` split is the auth gate, not a folder preference.** Route groups do not
 * appear in the URL, so this is free structurally, and it buys the one guarantee CSS cannot: the
 * rail and header exist only inside this layout, which awaits a session before returning anything.
 * A visitor without one never receives markup containing them.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const token = await currentToken();
  if (!token) redirect('/sign-in');

  const workspace = await currentWorkspace();
  const name = displayName(token);

  // The definition is what the rail describes, so a workspace whose definition cannot be read is
  // not a workspace this console can render. Say so rather than showing an empty shell.
  let title = workspace;
  let definitionVersion: number | null = null;
  let kind: string = 'tenant';
  try {
    const { record } = await fetchDefinition();
    title = record.title ?? record.id;
    definitionVersion = record.definition_version;
    kind = record.kind;
  } catch {
    /* rendered below as an unknown definition rather than as a crash */
  }

  async function leave() {
    'use server';
    await signOut();
    redirect('/sign-in');
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[216px,1fr]">
      <aside className="flex flex-col gap-5 border-b border-rule bg-surface-2 p-4 md:border-b-0 md:border-r">
        <div className="px-2 pt-0.5 font-mono text-sm font-semibold tracking-[-0.01em]">
          mstr<span className="text-faint">-</span>specs
        </div>

        <div className="mx-1 flex flex-col gap-px rounded border border-rule bg-surface px-2.5 py-2">
          <b className="font-mono text-xs font-medium">{workspace}</b>
          <em className="text-2xs not-italic text-faint">
            {title}
            {definitionVersion ? ` · definition v${definitionVersion}` : ' · definition unknown'}
          </em>
        </div>

        <RailGroup label="Workspace">
          <RailLink href="/">Register</RailLink>
          <RailLink href="/catalogue">Catalogue</RailLink>
          <RailLink href="/standards">Standards &amp; binding</RailLink>
          <RailLink href="/search">Search</RailLink>
          <RailLink href="/definition">Definition</RailLink>
        </RailGroup>

        <div className="mt-auto flex flex-col gap-0.5 px-2 text-2xs text-faint">
          <b className="font-mono text-2xs font-medium text-muted">
            {kind === 'catalogue' ? 'catalogue' : 'projection'}
          </b>
          <span>
            {kind === 'catalogue'
              ? 'Standards here are read by every workspace.'
              : 'Every state change is emitted to the record sink.'}
          </span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-rule bg-surface px-5 py-2.5">
          <div className="font-mono text-xs text-faint">{workspace}</div>
          <div className="flex items-center gap-2.5 whitespace-nowrap text-xs text-muted">
            <span>{name}</span>
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full border border-rule bg-accent-soft font-mono text-[10px] font-semibold text-accent-ink">
              {initials(name)}
            </span>
            <form action={leave}>
              <button
                type="submit"
                className="text-xs text-faint underline-offset-2 hover:text-ink hover:underline"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        <main className="flex flex-col gap-5 overflow-x-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

function RailGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="eyebrow px-2">{label}</p>
      <nav className="flex flex-col gap-px">{children}</nav>
    </div>
  );
}

function RailLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-sm border-l-2 border-transparent px-2.5 py-1 text-sm text-muted hover:bg-surface hover:text-ink"
    >
      {children}
    </Link>
  );
}
