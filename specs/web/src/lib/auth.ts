import 'server-only';

/**
 * Sign-in against identity-service, and the cookie handling around it.
 *
 * Server-only: it reads and writes cookies, which needs a request context.
 *
 * **The access token lives in an httpOnly cookie**, so page code and browser JavaScript can never
 * read it. That is also why the api is reached through a route handler rather than a rewrite: the
 * handler can turn the cookie into an `Authorization` header, and a rewrite cannot.
 *
 * NOTE, and it is a recorded deviation rather than an oversight (ADR-0011): architecture.md §7.1
 * specifies authorization code + PKCE, which is what gives transparent SSO. The password grant
 * below does not — a user already signed in for another Application still sees a login form here.
 * It ships first because it is proven on this estate; PKCE is the follow-up.
 */

import { cookies } from 'next/headers';
import {
  AUTH_MODE,
  DEV_TOKEN,
  IDENTITY_BASE_URL,
  IDENTITY_CLIENT_ID,
  REFRESH_COOKIE,
  TOKEN_COOKIE,
  WORKSPACE_COOKIE,
  DEFAULT_WORKSPACE,
  tokenIsFresh,
  type TokenSet,
} from './session';

export class SignInError extends Error {
  constructor(
    message: string,
    readonly reason: 'credentials' | 'unavailable' | 'not-configured',
  ) {
    super(message);
  }
}

/**
 * The current access token, if the request carries a usable one.
 *
 * Read-only, and that is load-bearing: a server component render may not write cookies, so it must
 * not refresh either. Renders rely on the middleware having refreshed first.
 */
export async function currentToken(): Promise<string | null> {
  if (AUTH_MODE === 'dev') return DEV_TOKEN;
  const store = await cookies();
  const token = store.get(TOKEN_COOKIE)?.value;
  return tokenIsFresh(token) ? token! : null;
}

export async function currentWorkspace(): Promise<string> {
  const store = await cookies();
  return store.get(WORKSPACE_COOKIE)?.value ?? DEFAULT_WORKSPACE;
}

export async function setWorkspace(workspace: string): Promise<void> {
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, workspace, { path: '/', sameSite: 'lax', httpOnly: false });
}

/** Only from a route handler or a server action — it writes cookies. */
export async function signIn(email: string, password: string): Promise<void> {
  if (AUTH_MODE === 'dev') {
    const store = await cookies();
    store.set(TOKEN_COOKIE, DEV_TOKEN, { path: '/', httpOnly: true, sameSite: 'lax' });
    return;
  }
  if (!IDENTITY_BASE_URL || !IDENTITY_CLIENT_ID) {
    throw new SignInError(
      'Sign-in is not configured for this deployment. Set NEXT_PUBLIC_IDENTITY_BASE_URL and NEXT_PUBLIC_IDENTITY_CLIENT_ID.',
      'not-configured',
    );
  }

  let response: Response;
  try {
    response = await fetch(`${IDENTITY_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: IDENTITY_CLIENT_ID,
        username: email,
        password,
        scope: 'openid profile offline_access',
      }),
      cache: 'no-store',
    });
  } catch {
    throw new SignInError('The identity service could not be reached. Try again in a moment.', 'unavailable');
  }

  if (!response.ok) {
    throw new SignInError('That email and password do not match an account.', 'credentials');
  }

  const tokens = (await response.json()) as TokenSet;
  await persist(tokens);
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
  store.delete(REFRESH_COOKIE);
}

async function persist(tokens: TokenSet): Promise<void> {
  const store = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  store.set(TOKEN_COOKIE, tokens.access_token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: tokens.expires_in ?? 3600,
  });
  if (tokens.refresh_token) {
    store.set(REFRESH_COOKIE, tokens.refresh_token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 60 * 60 * 24 * 14,
    });
  }
}

/**
 * Spend the refresh token.
 *
 * identity-service rotates refresh tokens, so a refresh whose result cannot be persisted revokes
 * the chain and kills the session. Only call this where cookies can be written.
 */
export async function refreshSession(): Promise<string | null> {
  if (AUTH_MODE === 'dev') return DEV_TOKEN;
  const store = await cookies();
  const refresh = store.get(REFRESH_COOKIE)?.value;
  if (!refresh || !IDENTITY_BASE_URL || !IDENTITY_CLIENT_ID) return null;

  try {
    const response = await fetch(`${IDENTITY_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: IDENTITY_CLIENT_ID,
        refresh_token: refresh,
      }),
      cache: 'no-store',
    });
    if (!response.ok) {
      await signOut();
      return null;
    }
    const tokens = (await response.json()) as TokenSet;
    await persist(tokens);
    return tokens.access_token;
  } catch {
    return null;
  }
}

/** The token, refreshed first if it has lapsed. Only from a route handler or a server action. */
export async function ensureToken(): Promise<string | null> {
  const current = await currentToken();
  if (current) return current;
  return refreshSession();
}
