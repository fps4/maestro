/**
 * The verifier reads the principal id from the token (ADR-0022).
 *
 * identity-service mints the maestro principal id and signs it into every token as `prn`; this
 * service writes that id on the record and mints none of its own. A token without one is refused,
 * the kind is the id's letter, and a `principal_kind` claim that contradicts it is refused.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devVerifier, jwksVerifier, Unauthenticated, type TokenVerifier } from '../../src/auth/verify.js';
import { loadConfig } from '../../src/config.js';
import { kindOfPrincipalId } from '../../src/domain/ids.js';

const ISSUER = 'https://id.example';
let server: Server;
let verifier: TokenVerifier;
let sign: (claims: JWTPayload) => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  verifier = jwksVerifier(
    loadConfig({
      NODE_ENV: 'test',
      TABLE_NAME: 'unused',
      AUTH_MODE: 'jwks',
      AUTH_JWKS_URL: `http://127.0.0.1:${port}/.well-known/jwks.json`,
      AUTH_ISSUER: ISSUER,
      AUTH_AUDIENCE: 'maestro',
    } as NodeJS.ProcessEnv),
  );
  sign = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience('maestro')
      .setSubject('6d537ed4-user')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('the jwks verifier', () => {
  it('names the principal by the token’s prn, and takes the kind from its letter', async () => {
    const verified = await verifier.verify(
      await sign({ prn: 'prn-h-pd6heq64abcd', principal_kind: 'human' }),
    );
    expect(verified.prn).toBe('prn-h-pd6heq64abcd');
    expect(verified.kind).toBe('human');
    expect(verified.subject).toBe('6d537ed4-user');
  });

  it('reads a workload as our service, an agent as an agent', async () => {
    expect(
      (await verifier.verify(await sign({ prn: 'prn-w-pipeline0001', principal_kind: 'workload' }))).kind,
    ).toBe('service');
    expect(
      (await verifier.verify(await sign({ prn: 'prn-a-drafter00001', principal_kind: 'agent' }))).kind,
    ).toBe('agent');
  });

  it('refuses a token without a prn: no second id for the same person', async () => {
    await expect(verifier.verify(await sign({ principal_kind: 'human' }))).rejects.toThrow(/no `prn` claim/);
  });

  it('refuses a prn that is not a principal id, or a principal_kind that contradicts it', async () => {
    await expect(verifier.verify(await sign({ prn: 'usr-1' }))).rejects.toBeInstanceOf(Unauthenticated);
    await expect(
      verifier.verify(await sign({ prn: 'prn-a-drafter00001', principal_kind: 'human' })),
    ).rejects.toThrow(/principal_kind/);
  });
});

describe('the development verifier', () => {
  it('carries a prn when the token names one, and none when it does not', async () => {
    expect((await devVerifier().verify('dev:ann:human:author:prn-h-ann000000001')).prn).toBe(
      'prn-h-ann000000001',
    );
    expect((await devVerifier().verify('dev:ann:human:author')).prn).toBeUndefined();
    await expect(devVerifier().verify('dev:ann:human:author:prn-a-ann000000001')).rejects.toBeInstanceOf(
      Unauthenticated,
    );
  });
});

describe('kindOfPrincipalId', () => {
  it('reads the letter, and nothing that is not a principal id', () => {
    expect(kindOfPrincipalId('prn-h-abc')).toBe('human');
    expect(kindOfPrincipalId('prn-a-abc')).toBe('agent');
    expect(kindOfPrincipalId('prn-w-abc')).toBe('service');
    expect(kindOfPrincipalId('prn-x-abc')).toBeUndefined();
    expect(kindOfPrincipalId('prn-H-ABC')).toBeUndefined();
  });
});
