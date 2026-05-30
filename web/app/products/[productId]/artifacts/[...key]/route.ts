// The workspace artefact route (US-0033): forwards the caller's identity to the read API's artefact
// endpoint server-side and 302s the browser to a freshly-minted, short-TTL presigned URL.
//
// Why a server route and not a direct browser link to the API: the browser must never hold the API
// URL or the caller identity (ADR-0015); identity is resolved server-side (the dev-stub cookie / env,
// ADR-0019) and sent on `X-Maestro-Identity`. Each request mints a fresh URL, so a link that expired
// between mint and click is re-minted simply by re-following this route (US-0033 AC #4/#7).

import { API_BASE } from '@/lib/api';
import { callerIdentity } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ productId: string; key: string[] }> },
): Promise<Response> {
  const { productId, key } = await params;
  const identity = await callerIdentity();
  if (!identity) {
    return new Response('unauthenticated', { status: 401 });
  }

  // Re-encode each path segment for the API URL (Next has already decoded the catch-all segments).
  const keyPath = key.map(encodeURIComponent).join('/');
  const url = `${API_BASE}/api/products/${encodeURIComponent(productId)}/artifacts/${keyPath}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'X-Maestro-Identity': identity },
      redirect: 'manual', // we want the 302's Location, not to follow it server-side
      cache: 'no-store',
    });
  } catch {
    // Store unreachable from the orchestrator's perspective is a 503 there; a network failure to the
    // orchestrator itself is the same class of "try again" for the user (US-0033 AC #7).
    return new Response('artefact store unreachable', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // The orchestrator answers 302 with the presigned URL in Location (it never proxies the bytes).
  if (res.status === 302 || res.status === 307) {
    const location = res.headers.get('location');
    if (location) {
      return new Response(null, {
        status: 307,
        headers: { Location: location, 'Cache-Control': 'no-store' },
      });
    }
  }

  // 404 (absent / not a participant — existence not disclosed), 503 (store down), or anything else:
  // pass the status through so the browser shows the failure; the panel stays a read-only index and
  // a retry is just re-clicking (a fresh URL is minted each time). Never serve a stale cached copy.
  return new Response(res.status === 404 ? 'not found' : 'artefact unavailable', {
    status: res.status === 404 ? 404 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
