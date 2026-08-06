/**
 * Token verification, and the mapping from a token to a local principal.
 *
 * **Authentication is `identity-service`'s** — credentials, federation, token issuance, JWKS.
 * **Authorisation is ours**, and narrow: who may author in a workspace, and who may decide at a
 * gate. That split is why nothing here interprets a role beyond passing it to a resolver the
 * workspace definition names.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Config } from '../config.js';
import type { PrincipalKind } from '../domain/types.js';

export interface VerifiedToken {
  issuer: string;
  subject: string;
  display_name: string;
  kind: PrincipalKind;
  roles: string[];
  /** Workspaces this token is admitted to, if the issuer scopes them. Empty means "ask membership". */
  workspaces: string[];
  raw: JWTPayload;
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
 * The development verifier: a stub principal, no cryptography.
 *
 * Refused in production by `loadConfig`, because "every caller is whoever they claim to be" is not
 * a degraded mode of authentication — it is the absence of it.
 */
export function devVerifier(): TokenVerifier {
  return {
    async verify(token: string): Promise<VerifiedToken> {
      // `dev:<name>:<kind>:<roles>` so a local session can be any principal without an IdP.
      const [prefix, name = 'dev-user', kind = 'human', roles = 'author,reviewer,workspace_admin'] =
        token.split(':');
      if (prefix !== 'dev')
        throw new Unauthenticated('Development tokens look like `dev:name:kind:role,role`.');
      return {
        issuer: 'dev',
        subject: name,
        display_name: name,
        kind: kind as PrincipalKind,
        roles: roles.split(',').filter(Boolean),
        workspaces: [],
        raw: { sub: name },
      };
    },
  };
}

/**
 * The real verifier.
 *
 * The JWKS is fetched in-network from `identity-service`; the issuer and audience stay the public
 * claim values, so the fetch URL is independent of them and neither has to be configured twice and
 * drift.
 */
export function jwksVerifier(config: Config): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(config.AUTH_JWKS_URL!));

  // Setting MCP_RESOURCE_URL both publishes the discovery document and accepts a token bound to
  // that resource (RFC 8707), so the URL is not configured twice.
  const audiences = [config.AUTH_AUDIENCE!, ...(config.MCP_RESOURCE_URL ? [config.MCP_RESOURCE_URL] : [])];

  return {
    async verify(token: string): Promise<VerifiedToken> {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, jwks, {
          issuer: config.AUTH_ISSUER!,
          audience: audiences,
        }));
      } catch (error) {
        throw new Unauthenticated(`Token rejected: ${(error as Error).message}`);
      }

      const sub = typeof payload.sub === 'string' ? payload.sub : null;
      if (!sub) throw new Unauthenticated('Token carries no subject.');

      return {
        issuer: config.AUTH_ISSUER!,
        subject: sub,
        display_name: claimString(payload, 'name') ?? claimString(payload, 'preferred_username') ?? sub,
        kind: principalKind(payload),
        roles: claimArray(payload, 'roles'),
        workspaces: claimArray(payload, 'workspaces'),
        raw: payload,
      };
    },
  };
}

/**
 * Whether the token belongs to a human, an agent, or a service.
 *
 * This is the single most consequential thing read from a token, because a principal of kind
 * `agent` can never be accountable for a decision. A client-credentials grant has no end user, so
 * it is never a human; an explicit `principal_kind` claim wins where the issuer sets one.
 */
function principalKind(payload: JWTPayload): PrincipalKind {
  const declared = claimString(payload, 'principal_kind');
  if (declared === 'human' || declared === 'agent' || declared === 'service') return declared;
  const grant = claimString(payload, 'gty') ?? claimString(payload, 'grant_type');
  if (grant === 'client_credentials') return 'service';
  return 'human';
}

function claimString(payload: JWTPayload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function claimArray(payload: JWTPayload, key: string): string[] {
  const value = payload[key];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return [];
}

export function createVerifier(config: Config): TokenVerifier {
  return config.AUTH_MODE === 'jwks' ? jwksVerifier(config) : devVerifier();
}
