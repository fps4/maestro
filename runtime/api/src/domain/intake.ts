/**
 * What a pipeline puts on the bus, as this service reads it (maestro ADR-0027 §2, §3):
 *
 *   `maestro.build`  `{ application, digest, commit, version?, sbom? }` — it built an artifact
 *   `maestro.deploy` `{ application, environment, digest, commit }`  — it deployed one
 *
 * The EventBridge envelope's `id` is the delivery: a redelivery is answered with the first result.
 * Anything else is not this service's and is ignored with a reason, never an error to retry.
 */

import { z } from 'zod';
import { DIGEST } from './ids.js';

const token = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+=-]{0,255}$/, 'is a token');
const slug = z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/, 'is a slug');

export const buildDetail = z
  .object({
    application: slug,
    digest: z.string().regex(DIGEST, 'is sha256:<64 hex>'),
    commit: token,
    version: token.optional(),
    /** The SBOM's key in this service's SBOM store: `sbom/<application>/<digest>.cdx.json`. */
    sbom: token.optional(),
  })
  .strict();

export const deployDetail = z
  .object({
    application: slug,
    environment: slug,
    digest: z.string().regex(DIGEST, 'is sha256:<64 hex>'),
    commit: token,
  })
  .strict();

export type BuildDetail = z.infer<typeof buildDetail>;
export type DeployDetail = z.infer<typeof deployDetail>;

export type Intake =
  | { kind: 'build'; delivery: string; at: string; detail: BuildDetail }
  | { kind: 'deploy'; delivery: string; at: string; detail: DeployDetail }
  | { kind: 'ignored'; delivery?: string; reason: string };

/** An EventBridge event as a rule delivers it to a queue, or as the API receives it. */
export const eventBridgeEvent = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  source: z.string(),
  'detail-type': z.string().optional(),
  time: z.string(),
  detail: z.unknown(),
});

const iso = (t: string): string => {
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) throw new Error(`\`${t}\` is not a time`);
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
};

/** Translate one event. Malformed input is refused by zod; a source not ours is ignored. */
export function fromEventBridge(raw: unknown): Intake {
  const e = eventBridgeEvent.parse(raw);
  const detail = typeof e.detail === 'string' ? (JSON.parse(e.detail) as unknown) : e.detail;
  if (e.source === 'maestro.build') {
    return { kind: 'build', delivery: e.id, at: iso(e.time), detail: buildDetail.parse(detail) };
  }
  if (e.source === 'maestro.deploy') {
    return { kind: 'deploy', delivery: e.id, at: iso(e.time), detail: deployDetail.parse(detail) };
  }
  return { kind: 'ignored', delivery: e.id, reason: `source \`${e.source}\` is not this service's` };
}

/** An SQS record's body: the EventBridge event a rule sent. */
export function fromQueue(body: string): Intake {
  return fromEventBridge(JSON.parse(body) as unknown);
}

/**
 * A package URL without its version, qualifiers or subpath: what `carries(dependency)` is asked for.
 * `pkg:npm/%40scope/name@1.2.3?x=y` → `pkg:npm/%40scope/name`. A purl percent-encodes an `@` in its
 * namespace, so the first `@` is the version's.
 */
export function purlWithoutVersion(purl: string): string {
  return purl.split(/[?#]/)[0]!.split('@')[0]!;
}

export interface Component {
  purl: string;
  version: string;
}

/** Every component a CycloneDX document names with a purl, nested ones included, each once. */
export function componentsOf(sbom: unknown): Component[] {
  const seen = new Map<string, Component>();
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const c of list as Array<Record<string, unknown>>) {
      const purl = typeof c.purl === 'string' ? c.purl : undefined;
      if (purl?.startsWith('pkg:')) {
        const base = purlWithoutVersion(purl);
        const version =
          typeof c.version === 'string' && c.version
            ? c.version
            : (purl.split(/[?#]/)[0]!.split('@')[1] ?? 'unknown');
        seen.set(`${base}@${version}`, { purl: base, version });
      }
      walk(c.components);
    }
  };
  walk((sbom as { components?: unknown } | null)?.components);
  return [...seen.values()];
}
