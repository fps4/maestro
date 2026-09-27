/**
 * The key layout (maestro ADR-0027 §1): where every kind of item lives in the table.
 *
 * A workspace's items share the prefix `ws#<workspace>#`, and the handle that serves a workspace
 * refuses any other prefix — isolation by key (maestro ADR-0018). Control items — workspaces,
 * definitions, principals — live under `ctl#`. Every item carries `kind`.
 *
 * The ledger is a partition per application, an artifact per digest; `gsi1` lists what was built,
 * by when. An instance is a partition: its head at `sk = head`, its deploys beside it; `gsi1` puts
 * the head in the estate. The components an SBOM names are a partition per package, so
 * `carries(dependency)` is one query.
 *
 * Numbers in keys are zero-padded so a string sort is a numeric sort; timestamps are ISO 8601 UTC,
 * which sorts as time. The widths are generous because a key is forever.
 */

/** A workspace's outbox sequence, and an instance's deploys. */
export const SEQ_WIDTH = 12;
/** A definition version. */
export const ORDINAL_WIDTH = 10;

export const padSeq = (n: number): string => String(n).padStart(SEQ_WIDTH, '0');
export const padOrdinal = (n: number): string => String(n).padStart(ORDINAL_WIDTH, '0');

export const CONTROL_PREFIX = 'ctl#';
export const workspacePrefix = (workspace: string): string => `ws#${workspace}#`;

/** The item kinds — the `kind` attribute. */
export const KINDS = {
  artifact: 'artifact',
  instance: 'instance',
  deploy: 'deploy',
  application: 'application',
  component: 'component',
  delivery: 'delivery',
  membership: 'membership',
  outbox: 'outbox',
  counter: 'counter',
  meta: 'meta',
  workspace: 'workspace',
  workspace_definition: 'workspace_definition',
  principal: 'principal',
} as const;
export type Kind = (typeof KINDS)[keyof typeof KINDS];

/**
 * The kinds that are a projection of the record — what a rebuild from the archive writes back.
 * Deliveries are an idempotency cache with a TTL; memberships are grants.
 */
export const RECORD_KINDS: readonly Kind[] = [
  KINDS.artifact,
  KINDS.instance,
  KINDS.deploy,
  KINDS.application,
  KINDS.component,
  KINDS.outbox,
  KINDS.counter,
];

export interface Key {
  pk: string;
  sk: string;
}

export const HEAD = 'head';

/** The workspace half of the layout. Every function here returns a key under the workspace's prefix. */
export function workspaceKeys(workspace: string) {
  const p = workspacePrefix(workspace);
  return {
    prefix: p,

    /** The ledger: an application's artifacts, by digest. */
    ledger: (application: string): string => `${p}artifact#${application}`,
    artifact: (application: string, digest: string): Key => ({
      pk: `${p}artifact#${application}`,
      sk: digest,
    }),
    /** gsi1: what was built, by when. */
    built: `${p}built`,
    builtKey: (recordedAt: string, application: string, digest: string) => ({
      gsi1pk: `${p}built`,
      gsi1sk: `${recordedAt}#${application}#${digest}`,
    }),

    /** The register: an instance's partition, its head and its deploys. */
    instancePartition: (application: string, environment: string): string =>
      `${p}instance#${application}#${environment}`,
    instance: (application: string, environment: string): Key => ({
      pk: `${p}instance#${application}#${environment}`,
      sk: HEAD,
    }),
    deploy: (application: string, environment: string, revision: number): Key => ({
      pk: `${p}instance#${application}#${environment}`,
      sk: `deploy#${padSeq(revision)}`,
    }),
    /** gsi1: the estate — every instance, by application and environment. */
    estate: `${p}estate`,
    estateKey: (application: string, environment: string) => ({
      gsi1pk: `${p}estate`,
      gsi1sk: `${application}#${environment}`,
    }),

    /** An application's level and tier, as a person last set them. */
    applications: `${p}application`,
    application: (application: string): Key => ({ pk: `${p}application`, sk: application }),

    /** The components SBOMs name, by package: `carries(dependency)` reads one partition. */
    carries: (purl: string): string => `${p}carries#${purl}`,
    component: (purl: string, application: string, digest: string, version: string): Key => ({
      pk: `${p}carries#${purl}`,
      sk: `${application}#${digest}#${version}`,
    }),

    delivery: (source: string, id: string): Key => ({ pk: `${p}delivery`, sk: `${source}#${id}` }),

    memberships: `${p}membership`,
    membership: (principal: string): Key => ({ pk: `${p}membership`, sk: principal }),

    outbox: `${p}outbox`,
    outboxItem: (seq: number): Key => ({ pk: `${p}outbox`, sk: padSeq(seq) }),
    /** The sparse index: set while undelivered, removed by the ack. */
    pending: (seq: number) => ({ pending_pk: `${p}outbox`, pending_sk: padSeq(seq) }),

    counters: `${p}counter`,
    counter: (name: string): Key => ({ pk: `${p}counter`, sk: name }),

    meta: (): Key => ({ pk: `${p}meta`, sk: 'projection' }),
  };
}

export type WorkspaceKeys = ReturnType<typeof workspaceKeys>;

/** The control half: never per workspace. */
export const controlKeys = {
  prefix: CONTROL_PREFIX,

  workspaces: `${CONTROL_PREFIX}workspaces`,
  workspace: (id: string): Key => ({ pk: `${CONTROL_PREFIX}workspaces`, sk: id }),

  definitions: `${CONTROL_PREFIX}workspace_definitions`,
  definition: (workspace: string, version: number): Key => ({
    pk: `${CONTROL_PREFIX}workspace_definitions`,
    sk: `${workspace}#${padOrdinal(version)}`,
  }),

  principals: `${CONTROL_PREFIX}principals`,
  principal: (id: string): Key => ({ pk: `${CONTROL_PREFIX}principals`, sk: id }),
};
