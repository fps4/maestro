import { describe, expect, it } from 'vitest';
import { displayName, initials, readClaims, tokenIsFresh } from './session';

/** A JWT with the given payload. The signature is not checked here and must never be. */
function jwt(payload: Record<string, unknown>): string {
  const encode = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`;
}

describe('readClaims', () => {
  it('reads a JWT payload', () => {
    expect(readClaims(jwt({ sub: 'abc', name: 'Jan Dekker' }))?.name).toBe('Jan Dekker');
  });

  it('reads a development token, which is not a JWT', () => {
    const claims = readClaims('dev:p-visser:human:author,reviewer');
    expect(claims?.sub).toBe('p-visser');
    expect(claims?.roles).toEqual(['author', 'reviewer']);
  });

  it('returns null for nonsense rather than throwing into a render', () => {
    expect(readClaims('not.a.token')).toBeNull();
    expect(readClaims(undefined)).toBeNull();
  });
});

describe('tokenIsFresh', () => {
  it('is false with no token', () => {
    expect(tokenIsFresh(undefined)).toBe(false);
  });

  it('is true well before expiry', () => {
    expect(tokenIsFresh(jwt({ sub: 'a', exp: Math.floor(Date.now() / 1000) + 600 }))).toBe(true);
  });

  it('is false after expiry', () => {
    expect(tokenIsFresh(jwt({ sub: 'a', exp: Math.floor(Date.now() / 1000) - 10 }))).toBe(false);
  });

  it('is false inside the margin, so a fetch cannot 401 mid-action', () => {
    // The margin is the whole point: a token valid for five more seconds is not usable for an
    // action that takes six.
    expect(tokenIsFresh(jwt({ sub: 'a', exp: Math.floor(Date.now() / 1000) + 5 }))).toBe(false);
  });

  it('treats a token with no expiry as fresh, which only a dev token has', () => {
    expect(tokenIsFresh(jwt({ sub: 'a' }))).toBe(true);
  });
});

describe('displayName and initials', () => {
  it('prefers the name claim, falling back to the subject', () => {
    expect(displayName(jwt({ sub: 'abc', name: 'Jan Dekker' }))).toBe('Jan Dekker');
    expect(displayName(jwt({ sub: 'abc' }))).toBe('abc');
  });

  it('builds two initials from a name', () => {
    expect(initials('Jan Dekker')).toBe('JD');
  });

  it('builds initials from an email without producing an empty badge', () => {
    expect(initials('j.dekker@aannemerx.nl')).toBe('JD');
  });

  it('copes with a single word', () => {
    expect(initials('sponsor')).toBe('S');
  });
});
