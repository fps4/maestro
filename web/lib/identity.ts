// Identity resolution for the dev surface (ADR-0019 §dev-stub-path).
//
// Resolution order, server-side:
//   1. The `maestro_identity` cookie (set by the Identity switcher in the top nav)
//   2. The `MAESTRO_DEV_IDENTITY` env var (the legacy single-tenant dev path)
//
// Production runs behind Cloudflare Access + component-auth; the identity arrives on
// `X-Maestro-Identity` from the edge, and the M3 auth slice replaces this helper. Both the cookie
// path and the env-var path are gated by `MAESTRO_ENV !== 'production'` on the API side — they
// don't accidentally short-circuit a real auth header.
//
// SERVER-ONLY. Don't import from a `'use client'` module.

import { cookies } from 'next/headers';

export const IDENTITY_COOKIE = 'maestro_identity';

/** Resolve the caller identity for an outbound request to the orchestrator. */
export async function callerIdentity(): Promise<string | undefined> {
  const jar = await cookies();
  const fromCookie = jar.get(IDENTITY_COOKIE)?.value?.trim();
  if (fromCookie) return fromCookie;
  const fromEnv = process.env.MAESTRO_DEV_IDENTITY?.trim();
  return fromEnv || undefined;
}
