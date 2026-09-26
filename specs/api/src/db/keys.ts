/**
 * The key layout (ADR-0021): where every kind of item lives in the table.
 *
 * A workspace's items share the prefix `ws#<workspace>#`, and the handle that serves a workspace
 * refuses any other prefix — isolation by key, as it was by database (ADR-0006, amended). Control
 * items — workspaces, definitions, principals — live under `ctl#`. Every item carries `kind`.
 *
 * Ordinals and sequence numbers are zero-padded so a string sort is a numeric sort; the widths are
 * generous rather than tight because a key is forever.
 */

/** A version's ordinal, a definition version. */
export const ORDINAL_WIDTH = 10;
/** A workspace's outbox sequence. */
export const SEQ_WIDTH = 12;

export const padOrdinal = (n: number): string => String(n).padStart(ORDINAL_WIDTH, '0');
export const padSeq = (n: number): string => String(n).padStart(SEQ_WIDTH, '0');

export const CONTROL_PREFIX = 'ctl#';
export const workspacePrefix = (workspace: string): string => `ws#${workspace}#`;

/** The item kinds — the `kind` attribute — the record's projection is made of (ADR-0020). */
export const KINDS = {
  artifact: 'artifact',
  draft: 'draft',
  version: 'version',
  decision: 'decision',
  evaluation: 'evaluation',
  membership: 'membership',
  question: 'question',
  acceptance: 'acceptance',
  outbox: 'outbox',
  counter: 'counter',
  meta: 'meta',
  workspace: 'workspace',
  workspace_definition: 'workspace_definition',
  principal: 'principal',
  /** A uniqueness item: exists so that a conditional put can refuse a duplicate (ADR-0021 §3). */
  unique: 'unique',
} as const;
export type Kind = (typeof KINDS)[keyof typeof KINDS];

/** The kinds the rebuilder writes — the record's projection. Memberships are grants, not record. */
export const RECORD_KINDS: readonly Kind[] = [
  KINDS.artifact,
  KINDS.draft,
  KINDS.version,
  KINDS.decision,
  KINDS.evaluation,
  KINDS.question,
  KINDS.outbox,
  KINDS.counter,
  KINDS.acceptance,
];

export interface Key {
  pk: string;
  sk: string;
}

/** The workspace half of the layout. Every function here returns a key under the workspace's prefix. */
export function workspaceKeys(workspace: string) {
  const p = workspacePrefix(workspace);
  return {
    prefix: p,

    artifacts: `${p}artifact`,
    artifact: (id: string): Key => ({ pk: `${p}artifact`, sk: id }),

    drafts: `${p}draft`,
    draft: (id: string): Key => ({ pk: `${p}draft`, sk: id }),
    /** gsi1: the drafts open on an artifact, for the register. Sparse — a new lineage's draft has none. */
    draftsByArtifact: `${p}draft#artifact`,
    draftByArtifact: (artifact: string, id: string) => ({
      gsi1pk: `${p}draft#artifact`,
      gsi1sk: `${artifact}#${id}`,
    }),

    versionsOf: (artifact: string): string => `${p}version#${artifact}`,
    version: (artifact: string, ordinal: number): Key => ({
      pk: `${p}version#${artifact}`,
      sk: padOrdinal(ordinal),
    }),
    /** gsi1: every version of the workspace, by state — the catalogue's shelf, lineage, search. */
    versionsByState: `${p}version`,
    versionByState: (state: string, artifact: string, ordinal: number) => ({
      gsi1pk: `${p}version`,
      gsi1sk: `${state}#${artifact}#${padOrdinal(ordinal)}`,
    }),
    /** gsi2: versions carrying `facets.standard_id`, by that id — a catalogue reference resolves here. */
    versionsByStandard: `${p}version#standard`,
    versionByStandard: (standard: string, ordinal: number) => ({
      gsi2pk: `${p}version#standard`,
      gsi2sk: `${standard}#${padOrdinal(ordinal)}`,
    }),

    decisionsOf: (artifact: string): string => `${p}decision#${artifact}`,
    decision: (artifact: string, id: string): Key => ({ pk: `${p}decision#${artifact}`, sk: id }),

    evaluationsOf: (artifact: string, ordinal: number): string =>
      `${p}evaluation#${artifact}#${padOrdinal(ordinal)}`,
    evaluation: (artifact: string, ordinal: number, evaluator: string): Key => ({
      pk: `${p}evaluation#${artifact}#${padOrdinal(ordinal)}`,
      sk: evaluator,
    }),

    memberships: `${p}membership`,
    membership: (principal: string): Key => ({ pk: `${p}membership`, sk: principal }),

    questions: `${p}question`,
    question: (id: string): Key => ({ pk: `${p}question`, sk: id }),
    /** gsi1: the questions on a version, in the order they were asked. */
    questionsOf: (artifact: string, ordinal: number): string =>
      `${p}question#${artifact}#${padOrdinal(ordinal)}`,
    questionOf: (artifact: string, ordinal: number, askedAt: string, id: string) => ({
      gsi1pk: `${p}question#${artifact}#${padOrdinal(ordinal)}`,
      gsi1sk: `${askedAt}#${id}`,
    }),

    acceptances: `${p}acceptance`,
    acceptance: (standard: string, scope: string, project?: string): Key => ({
      pk: `${p}acceptance`,
      sk: `${standard}#${scope}#${project ?? ''}`,
    }),

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
  /**
   * The registry's mapping `(issuer, subject) → principal`, as a uniqueness item written in the
   * transaction that mints the principal. JSON, because a subject is an opaque string that may
   * contain any separator.
   */
  principalBySubject: (issuer: string, subject: string): Key => ({
    pk: `${CONTROL_PREFIX}principals#by-subject`,
    sk: JSON.stringify([issuer, subject]),
  }),
};
