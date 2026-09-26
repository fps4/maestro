/**
 * Session renewal and the auth gate, before render.
 *
 * Running here rather than in a layout matters: the middleware may write cookies, so it is the one
 * place a rotated refresh token can be persisted. A server component that refreshed without being
 * able to persist would spend the token, fail to save the new one, and revoke the chain — killing
 * the session it was trying to save.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_MODE, TOKEN_COOKIE, tokenIsFresh } from '@/lib/session';

/** Paths that must work without a session. Add here, not by loosening the matcher. */
const PUBLIC = ['/sign-in'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (AUTH_MODE === 'dev') return NextResponse.next();
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  if (tokenIsFresh(token)) return NextResponse.next();

  // Carry where they were going, so signing in returns them there rather than to the register.
  const signIn = new URL('/sign-in', request.url);
  if (pathname !== '/') signIn.searchParams.set('next', pathname + request.nextUrl.search);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Everything except Next's own assets and the api proxy, which authenticates per request and
  // returns 401 as JSON rather than redirecting a fetch into an HTML page.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
