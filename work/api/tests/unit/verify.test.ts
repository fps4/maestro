import { describe, expect, it } from 'vitest';
import { devVerifier, fromClaims, Unauthenticated } from '../../src/auth/verify.js';

describe('reading a token', () => {
  it("takes identity-service's prn as the principal, and its kind from the id", () => {
    expect(fromClaims({ prn: 'prn-a-bump-1', principal_kind: 'agent', roles: ['operations'] })).toEqual({
      principal: 'prn-a-bump-1',
      kind: 'agent',
      roles: ['operations'],
    });
    expect(fromClaims({ prn: 'prn-w-intake', principal_kind: 'service' }).kind).toBe('workload');
  });

  it('refuses a token with no prn', () => {
    expect(() => fromClaims({ sub: '4c1e' })).toThrow(Unauthenticated);
  });

  it('refuses a token whose declared kind contradicts the id', () => {
    expect(() => fromClaims({ prn: 'prn-a-bump-1', principal_kind: 'human' })).toThrow(/is an agent/);
  });

  it('reads a development token', async () => {
    expect(await devVerifier().verify('dev:prn-h-jdekker:operations,owner')).toEqual({
      principal: 'prn-h-jdekker',
      kind: 'human',
      roles: ['operations', 'owner'],
    });
    await expect(devVerifier().verify('dev:jdekker')).rejects.toThrow(Unauthenticated);
  });
});
