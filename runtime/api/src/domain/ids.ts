/**
 * Identifiers.
 *
 * A principal is identity-service's: its `prn` claim (`prn-h-…` a human, `prn-a-…` an agent,
 * `prn-w-…` a workload) is the only id of a person or an agent that reaches an item or an event.
 * This service mints none. An instance is named by its application and environment, and an
 * artifact by its digest: tags are never resolved (maestro ADR-0027).
 */

export type PrincipalKind = 'human' | 'agent' | 'workload';

export const PRINCIPAL_ID = /^prn-[haw]-[a-z0-9][a-z0-9._-]{0,62}$/;
/** A digest, as a pipeline computes it over what it built. */
export const DIGEST = /^sha256:[a-f0-9]{64}$/;
/** A configured workspace: a slug. The spine calls it `ws-<slug>`. */
export const WORKSPACE_SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;

export function isPrincipalId(value: unknown): value is string {
  return typeof value === 'string' && PRINCIPAL_ID.test(value);
}

/** The kind a principal id carries in its shape — identity-service mints the letter with the id. */
export function kindOf(id: string): PrincipalKind {
  if (!isPrincipalId(id)) throw new Error(`\`${id}\` is not a principal id (prn-h-…, prn-a-…, prn-w-…).`);
  const letter = id.charAt(4);
  return letter === 'h' ? 'human' : letter === 'a' ? 'agent' : 'workload';
}

/** An instance: one application in one environment, named so a person can say it aloud. */
export const instanceId = (application: string, environment: string): string =>
  `ins-${application}-${environment}`;

/** An artifact's subject id on the record: the application it was built for, and its digest. */
export const artifactSubject = (application: string, digest: string): string => `${application}@${digest}`;

/** Deterministic and lossless for a slug that does not already start with `ws-`. */
export const spineWorkspaceId = (id: string): string => (id.startsWith('ws-') ? id : `ws-${id}`);
