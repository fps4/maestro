/**
 * What a token *means*, and the names of the cookies that carry it.
 *
 * Deliberately free of `next/headers`, so the middleware and client components can use it without
 * pulling in server-only code. Anything that reads or writes a cookie lives in `auth.ts`.
 */

export const TOKEN_COOKIE = 'specs_token';
export const REFRESH_COOKIE = 'specs_refresh';
export const WORKSPACE_COOKIE = 'specs_workspace';

export const AUTH_MODE = process.env.NEXT_PUBLIC_AUTH_MODE ?? 'dev';
export const IDENTITY_BASE_URL = process.env.NEXT_PUBLIC_IDENTITY_BASE_URL ?? '';
export const IDENTITY_CLIENT_ID = process.env.NEXT_PUBLIC_IDENTITY_CLIENT_ID ?? '';
export const DEFAULT_WORKSPACE = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE ?? 'aannemer-x';

/** The development token the api's dev verifier understands: `dev:<name>:<kind>:<roles>`. */
export const DEV_TOKEN = 'dev:dev-user:human:author,reviewer,workspace_admin,sponsor,owner';

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface TokenClaims {
  sub?: string;
  name?: string;
  roles?: string[];
  exp?: number;
}

/**
 * Read a JWT's claims without verifying it.
 *
 * Safe here and nowhere else: this is used to decide what to *show*, never what to allow. Every
 * authorisation decision is the api's, against a signature this code cannot check.
 */
export function readClaims(token: string | undefined): TokenClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) {
    // A development token, which carries its name in the second position.
    const [prefix, name, , roles] = token.split(':');
    if (prefix === 'dev') return { sub: name, name, roles: (roles ?? '').split(',').filter(Boolean) };
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as TokenClaims;
    return payload;
  } catch {
    return null;
  }
}

/** Whether a token is present and not about to expire. The margin is what stops a mid-action 401. */
export function tokenIsFresh(token: string | undefined, marginSeconds = 30): boolean {
  if (!token) return false;
  const claims = readClaims(token);
  if (!claims) return false;
  if (!claims.exp) return true; // a dev token has no expiry
  return claims.exp * 1000 > Date.now() + marginSeconds * 1000;
}

export function displayName(token: string | undefined): string {
  return readClaims(token)?.name ?? readClaims(token)?.sub ?? 'signed in';
}

export function initials(name: string): string {
  return name
    .split(/[\s.@-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
