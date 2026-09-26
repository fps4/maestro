/**
 * The browser's route to the api.
 *
 * A route handler rather than a Next rewrite, and that is the whole point: this can turn the
 * httpOnly session cookie into an `Authorization` header, and a rewrite cannot. The token therefore
 * never reaches the browser, and no client component can read or leak it.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { ensureToken } from '@/lib/auth';

const BASE = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8020';

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  // `ensureToken` may refresh, which writes cookies — legal here, and the reason the browser's
  // calls go through a handler rather than being issued against the api directly.
  const token = await ensureToken();
  if (!token) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'Your session has ended. Sign in again to continue.' },
      { status: 401 },
    );
  }

  const url = new URL(`${BASE}/${path.join('/')}`);
  url.search = request.nextUrl.search;

  const headers = new Headers();
  headers.set('authorization', `Bearer ${token}`);
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();

  let response: Response;
  try {
    response = await fetch(url, { method: request.method, headers, body, cache: 'no-store' });
  } catch {
    return NextResponse.json(
      {
        error: 'unavailable',
        message: 'The service is not reachable right now. Your draft is not lost — try again.',
      },
      { status: 502 },
    );
  }

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function POST(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function PATCH(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function PUT(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}
export async function DELETE(request: NextRequest, context: Context) {
  return proxy(request, (await context.params).path);
}
