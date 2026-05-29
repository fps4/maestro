'use client';

// Dev-only "switch user" affordance (ADR-0019 §dev-stub-path). Writes the participant identity to
// the `maestro_identity` cookie which the server-side API/write clients pick up via lib/identity.ts.
// Persisted in localStorage so the same identity sticks across page reloads.
//
// M3 replaces this with the authenticated edge (Cloudflare Access → component-auth → Google SSO).
// At that point the cookie path is rejected in production by the orchestrator's identity resolver.

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const COOKIE = 'maestro_identity';
const STORAGE = 'maestro:dev-identity';
const ALT_STORAGE = 'maestro:dev-identity:history';

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .map((c) => c.split('='))
    .find(([k]) => k === name)?.[1];
}

function setCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  // 30 days, top-level, SameSite=Lax so it travels with normal navigation.
  const maxAge = 60 * 60 * 24 * 30;
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

function clearCookie(name: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

export function IdentitySwitcher() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);

  // Hydrate from the cookie first (authoritative for the server fetches), falling back to
  // localStorage so a stale tab can still seed the input. Tracks history of switched identities
  // for the dropdown — handy when dogfooding multiple personas.
  useEffect(() => {
    const fromCookie = readCookie(COOKIE);
    const fromStorage = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE) : null;
    const active = fromCookie ? decodeURIComponent(fromCookie) : (fromStorage ?? '');
    setValue(active);
    try {
      const raw = window.localStorage.getItem(ALT_STORAGE);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      /* ignore corrupt history */
    }
  }, []);

  function save(identity: string) {
    const trimmed = identity.trim();
    if (!trimmed) {
      clearCookie(COOKIE);
      window.localStorage.removeItem(STORAGE);
    } else {
      setCookie(COOKIE, trimmed);
      window.localStorage.setItem(STORAGE, trimmed);
      const next = [trimmed, ...history.filter((h) => h !== trimmed)].slice(0, 5);
      setHistory(next);
      window.localStorage.setItem(ALT_STORAGE, JSON.stringify(next));
    }
    setOpen(false);
    // A full reload re-runs server components so the new identity reaches the read API.
    if (typeof window !== 'undefined') window.location.reload();
  }

  const label = value || 'no identity';

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="text-xs text-muted-foreground">as</span>
        <span className="ml-1 font-mono text-xs">{label}</span>
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-72 rounded-md border bg-background p-3 shadow-md"
        >
          <p className="text-xs text-muted-foreground">
            Dev identity (forwarded as <code>X-Maestro-Identity</code>).
          </p>
          <Input
            className="mt-2"
            type="email"
            placeholder="you@example.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save(value);
              if (e.key === 'Escape') setOpen(false);
            }}
            autoFocus
          />
          <div className="mt-2 flex justify-between">
            <Button type="button" size="sm" variant="ghost" onClick={() => save('')}>
              Clear
            </Button>
            <Button type="button" size="sm" onClick={() => save(value)}>
              Save & reload
            </Button>
          </div>
          {history.length > 0 && (
            <div className="mt-3 border-t pt-2">
              <p className="text-xs text-muted-foreground">Recent</p>
              <ul className="mt-1 space-y-0.5">
                {history.map((h) => (
                  <li key={h}>
                    <button
                      type="button"
                      className="w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-xs hover:bg-accent"
                      onClick={() => save(h)}
                    >
                      {h}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
