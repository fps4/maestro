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
import { kindOfPrincipalId } from '../domain/ids.js';
import type { PrincipalKind } from '../domain/types.js';

export interface VerifiedToken {
  issuer: string;
  subject: string;
  /**
   * The maestro principal id identity-service minted for this person or credential — its `prn`
   * claim (identity-service ADR-0022). The id this service writes on every record (ADR-0022 here).
   * Always present on a verified `jwks` token; a development token may leave it out, and then the
   * principal is minted here on first sight as before.
   */
  prn?: string;
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
      // `dev:<name>:<kind>:<roles>[:<prn>]` so a local session can be any principal without an IdP;
      // the optional fifth part stands in for identity-service's `prn` claim.
      const [prefix, name = 'dev-user', kind = 'human', roles = 'author,reviewer,workspace_admin', prn] =
        token.split(':');
      if (prefix !== 'dev')
        throw new Unauthenticated('Development tokens look like `dev:name:kind:role,role[:prn-h-…]`.');
      if (prn !== undefined && kindOfPrincipalId(prn) !== kind)
        throw new Unauthenticated(`\`${prn}\` is not a ${kind}'s principal id.`);
      return {
        issuer: 'dev',
        subject: name,
        ...(prn !== undefined ? { prn } : {}),
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
      const { prn, kind } = principalOf(payload);

      return {
        issuer: config.AUTH_ISSUER!,
        subject: sub,
        prn,
        display_name: claimString(payload, 'name') ?? claimString(payload, 'preferred_username') ?? sub,
        kind,
        roles: claimArray(payload, 'roles'),
        workspaces: claimArray(payload, 'workspaces'),
        raw: payload,
      };
    },
  };
}

/**
 * The principal a verified token names: its `prn`, and the kind that id carries.
 *
 * identity-service mints the id and puts it in every token it signs while its record is wired
 * (its ADR-0022); this service no longer mints one for a verified token (ADR-0022 here), so a token
 * without it is refused rather than given a second id for the same person. The id's letter is the
 * kind; a `principal_kind` claim that says otherwise is a token that contradicts itself.
 */
function principalOf(payload: JWTPayload): { prn: string; kind: PrincipalKind } {
  const prn = claimString(payload, 'prn');
  if (!prn) {
    throw new Unauthenticated(
      'Token carries no `prn` claim. identity-service puts the maestro principal id in every token while its record is wired (its ADR-0022); this service names people by it and mints none of its own.',
    );
  }
  const kind = kindOfPrincipalId(prn);
  if (!kind) throw new Unauthenticated(`Token's \`prn\` (\`${prn}\`) is not a maestro principal id.`);
  const declared = principalKind(payload);
  if (claimString(payload, 'principal_kind') !== undefined && declared !== kind) {
    throw new Unauthenticated(
      `Token's \`prn\` (\`${prn}\`) names ${article(kind)} ${kind}, and its \`principal_kind\` says ${declared}.`,
    );
  }
  return { prn, kind };
}

const article = (word: string): string => (/^[aeiou]/.test(word) ? 'an' : 'a');

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
  // identity-service's word for a machine that acts for itself; ours is `service`.
  if (declared === 'workload') return 'service';
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
