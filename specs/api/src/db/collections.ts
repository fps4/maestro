/**
 * Collection names and indexes.
 *
 * Every per-workspace database has the same shape, so this file is the schema in the sense that
 * matters: what exists, and what is indexed. MongoDB has no foreign keys and no check constraints
 * (§8.4), so what is here is what the database itself will enforce — and it is not much. The
 * compensating control is the record sink.
 */

import type { Db, IndexSpecification, CreateIndexesOptions } from 'mongodb';

export const ARTIFACTS = 'artifacts';
export const DRAFTS = 'drafts';
export const VERSIONS = 'versions';
export const DECISIONS = 'decisions';
export const EVALUATIONS = 'evaluations';
export const MEMBERSHIPS = 'memberships';
export const OUTBOX = 'outbox';
export const ACCEPTANCES = 'acceptances';
export const QUESTIONS = 'questions';
export const COUNTERS = 'counters';
/** One document, `projection`: which projection wrote this database (ADR-0020 §4). */
export const META = 'meta';

/**
 * How events are projected into this database. A change to the projection — a new field derived
 * from an event, a collection reshaped — bumps this, and a database whose `meta.projection_version`
 * is behind refuses to serve until it is rebuilt from the archive. Never an in-place migration.
 */
export const PROJECTION_VERSION = 1;

/** The collections the rebuilder writes — the record's projection. Memberships are grants, not record. */
export const RECORD_COLLECTIONS = [
  ARTIFACTS,
  DRAFTS,
  VERSIONS,
  DECISIONS,
  EVALUATIONS,
  QUESTIONS,
  OUTBOX,
  COUNTERS,
  ACCEPTANCES,
] as const;

/** Control database — never per workspace. */
export const WORKSPACES = 'workspaces';
export const DEFINITIONS = 'workspace_definitions';
export const PRINCIPALS = 'principals';

type IndexDef = { keys: IndexSpecification; options?: CreateIndexesOptions };

const WORKSPACE_INDEXES: Record<string, IndexDef[]> = {
  [ARTIFACTS]: [
    { keys: { id: 1 }, options: { unique: true } },
    { keys: { type: 1, phase: 1, updated_at: -1 } },
    { keys: { updated_at: -1 } },
  ],
  [DRAFTS]: [
    { keys: { id: 1 }, options: { unique: true } },
    { keys: { artifact: 1 } },
    { keys: { updated_at: -1 } },
    // Abandoned drafts expire and the expiry is recorded — silence is not an outcome — so the sweep
    // needs to find them cheaply rather than scanning.
    { keys: { expires_at: 1 } },
  ],
  [VERSIONS]: [
    { keys: { artifact: 1, ordinal: 1 }, options: { unique: true } },
    { keys: { artifact: 1, state: 1 } },
    { keys: { digest: 1 } },
    { keys: { state: 1, proposed_at: -1 } },
    // Search covers bodies and facets. The index lives in the workspace's own database, so search
    // cannot cross the boundary by construction.
    {
      keys: { title: 'text', 'body.content': 'text' },
      options: { name: 'version_text', weights: { title: 10, 'body.content': 1 } },
    },
  ],
  [DECISIONS]: [
    { keys: { id: 1 }, options: { unique: true } },
    { keys: { artifact: 1, ordinal: 1 } },
    { keys: { gate: 1, decided_at: -1 } },
  ],
  [EVALUATIONS]: [{ keys: { artifact: 1, ordinal: 1, evaluator: 1 } }, { keys: { subject_digest: 1 } }],
  [MEMBERSHIPS]: [{ keys: { principal: 1 }, options: { unique: true } }],
  [OUTBOX]: [
    // The relay reads pending events in the order they were written; ordering is the guarantee.
    { keys: { delivered: 1, seq: 1 } },
    { keys: { seq: 1 }, options: { unique: true } },
    { keys: { event_id: 1 }, options: { unique: true } },
  ],
  [ACCEPTANCES]: [{ keys: { standard: 1, scope: 1, project: 1 } }, { keys: { status: 1 } }],
  [QUESTIONS]: [
    { keys: { id: 1 }, options: { unique: true } },
    // "The open questions on this version" is the query every decision page runs.
    { keys: { artifact: 1, ordinal: 1, resolved_at: 1 } },
  ],
};

const CONTROL_INDEXES: Record<string, IndexDef[]> = {
  [WORKSPACES]: [{ keys: { id: 1 }, options: { unique: true } }],
  [DEFINITIONS]: [{ keys: { workspace: 1, definition_version: 1 }, options: { unique: true } }],
  [PRINCIPALS]: [
    { keys: { id: 1 }, options: { unique: true } },
    // The registry maps (issuer, subject) → principal id, and only the local id is ever written to
    // a record. This is the index that makes that mapping a lookup rather than a scan.
    { keys: { issuer: 1, subject: 1 }, options: { unique: true, sparse: true } },
  ],
};

export async function ensureWorkspaceIndexes(db: Db): Promise<void> {
  await applyIndexes(db, WORKSPACE_INDEXES);
}

export interface ProjectionMeta {
  _id: 'projection';
  projection_version: number;
}

export class ProjectionBehind extends Error {
  constructor(
    readonly workspace: string,
    readonly found: number,
  ) {
    super(
      `Workspace \`${workspace}\` was projected at version ${found}; this service projects at ${PROJECTION_VERSION}. ` +
        'Rebuild it from the archive (`npm run workspace:rebuild -- --workspace <id> --force`); nothing migrates in place.',
    );
    this.name = 'ProjectionBehind';
  }
}

/**
 * Stamp a database the running service created with the current projection version, and refuse
 * one written by an older projection (ADR-0020 §4). Called where indexes are ensured — once per
 * workspace per process.
 */
export async function ensureProjectionVersion(db: Db, workspace: string): Promise<void> {
  const meta = db.collection<ProjectionMeta>(META);
  const found = await meta.findOne({ _id: 'projection' });
  if (!found) {
    await meta.updateOne(
      { _id: 'projection' },
      { $setOnInsert: { projection_version: PROJECTION_VERSION } },
      { upsert: true },
    );
    return;
  }
  if (found.projection_version < PROJECTION_VERSION)
    throw new ProjectionBehind(workspace, found.projection_version);
}

export async function ensureControlIndexes(db: Db): Promise<void> {
  await applyIndexes(db, CONTROL_INDEXES);
}

async function applyIndexes(db: Db, spec: Record<string, IndexDef[]>): Promise<void> {
  for (const [name, indexes] of Object.entries(spec)) {
    const collection = db.collection(name);
    for (const index of indexes) {
      await collection.createIndex(index.keys, index.options ?? {});
    }
  }
}

/**
 * Projections that exclude the body, for every list query.
 *
 * Inline bodies make the wrong query expensive, and this is the one operational discipline the
 * choice demands (§8.2). Registers, search results and lineage all use this.
 */
export const WITHOUT_BODY = { 'body.content': 0 } as const;
