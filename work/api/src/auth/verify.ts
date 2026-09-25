/**
 * Token verification: a bearer token → the principal it names.
 *
 * **Authentication is identity-service's**; this service reads the `prn` claim its tokens carry
 * (identity-service ADR-0022) and mints no principal ids of its own, so the person who decides in
 * specs-service and the person who owes an item here are the same id. **Authorisation is ours**:
 * the workspace's membership, and authority at claim.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Config } from '../config.js';
import { isPrincipalId, kindOf, type PrincipalKind } from '../domain/ids.js';

export interface VerifiedToken {
  /** identity-service's principal id — the only id of a person or an agent this service records. */
  principal: string;
  kind: PrincipalKind;
  /** Roles the issuer asserts for this service; unioned with the workspace's membership. */
  roles: string[];
}

export class Unauthenticated extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Unauthenticated';
  }
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

/**
 * The development verifier: `dev:<prn>[:role,role]`, no cryptography. Refused in production by
 * `loadConfig` — "every caller is whoever they claim to be" is the absence of authentication.
 */
export function devVerifier(): TokenVerifier {
  return {
    async verify(token: string): Promise<VerifiedToken> {
      const [prefix, principal = '', roles = ''] = token.split(':');
      if (prefix !== 'dev' || !isPrincipalId(principal)) {
        throw new Unauthenticated('Development tokens look like `dev:<prn-h-…>[:role,role]`.');
      }
      return { principal, kind: kindOf(principal), roles: roles.split(',').filter(Boolean) };
    },
  };
}

/**
 * The real verifier. The token must carry a `prn`; where it also says `principal_kind`, the two
 * must agree — a token that calls an agent's id a human is refused, not believed.
 */
export function jwksVerifier(config: Config): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(config.AUTH_JWKS_URL!));
  const audiences = [config.AUTH_AUDIENCE!, ...(config.MCP_RESOURCE_URL ? [config.MCP_RESOURCE_URL] : [])];

  return {
    async verify(token: string): Promise<VerifiedToken> {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, jwks, { issuer: config.AUTH_ISSUER!, audience: audiences }));
      } catch (error) {
        throw new Unauthenticated(`Token rejected: ${(error as Error).message}`);
      }
      return fromClaims(payload);
    },
  };
}

/** The claims this service reads, checked. Exported for the tests. */
export function fromClaims(payload: JWTPayload): VerifiedToken {
  const prn = payload.prn;
  if (!isPrincipalId(prn)) {
    throw new Unauthenticated(
      'The token carries no maestro principal id (`prn`). identity-service mints one for every principal; register this client with the record wired.',
    );
  }
  const kind = kindOf(prn);
  const declared = typeof payload.principal_kind === 'string' ? payload.principal_kind : undefined;
  const declaredKind = declared === 'service' ? 'workload' : declared;
  if (declaredKind !== undefined && declaredKind !== kind) {
    throw new Unauthenticated(
      `The token says \`${declared}\` for \`${prn}\`, which is ${article(kind)} ${kind}.`,
    );
  }
  return { principal: prn, kind, roles: claimArray(payload, 'roles') };
}

function claimArray(payload: JWTPayload, key: string): string[] {
  const value = payload[key];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return [];
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

export function createVerifier(config: Config): TokenVerifier {
  return config.AUTH_MODE === 'jwks' ? jwksVerifier(config) : devVerifier();
}
