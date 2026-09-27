import 'server-only';

/**
 * The person's preferences, on their profile in identity-service (ADR-0029): one document per person
 * for this application, read and written with their own token from the console's server.
 *
 * A preference decides what a person sees first, never what they may see or do. So everything here
 * fails soft: a profile that cannot be read is the console's defaults, and one that cannot be written
 * is a choice not remembered.
 */

import { currentToken } from './auth';
import { AUTH_MODE, IDENTITY_BASE_URL } from './session';

/** The document's shape is the console's; identity-service stores it without reading it. */
export interface ConsolePreferences {
  owed?: { who?: string; application?: string };
  board?: { application?: string };
}

const URL_OF = () => `${IDENTITY_BASE_URL}/v1/me/preferences/maestro`;
const enabled = () => AUTH_MODE !== 'dev' && IDENTITY_BASE_URL !== '';

async function read(token: string): Promise<Record<string, unknown>> {
  const response = await fetch(URL_OF(), {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

export async function consolePreferences(): Promise<ConsolePreferences> {
  const token = enabled() ? await currentToken() : null;
  if (!token) return {};
  try {
    return ((await read(token)).console as ConsolePreferences | undefined) ?? {};
  } catch {
    return {};
  }
}

/** Remember one page's choice, keeping the rest of the document as it is. */
export async function rememberChoice<K extends keyof ConsolePreferences>(
  page: K,
  choice: NonNullable<ConsolePreferences[K]>,
): Promise<void> {
  const token = enabled() ? await currentToken() : null;
  if (!token) return;
  try {
    const document = await read(token);
    const mine = { ...((document.console as ConsolePreferences | undefined) ?? {}), [page]: choice };
    await fetch(URL_OF(), {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...document, console: mine }),
      cache: 'no-store',
    });
  } catch {
    /* a choice not remembered; the next one tries again */
  }
}
