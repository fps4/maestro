/**
 * Workspace isolation, as a type (ADR-0006, amended by ADR-0021).
 *
 * The rule, stated once:
 *
 * > A workspace-scoped handle is acquired once per request, and no query names a workspace.
 *
 * **This fails closed, and that is the argument.** A forgotten `WHERE tenant_id` returns every
 * tenant's rows. A forgotten handle has no prefix to query — it does not compile, and at worst it
 * errors. The handle's repositories build every key from the workspace's own layout, and the item
 * access under them refuses a key outside that prefix (`IsolationViolation`) before a request is
 * made. The failure mode of the mistake is what matters, not the elegance of the mechanism.
 *
 * The catalogue (ADR-0008) is the one workspace readable from another, and it gets a **different
 * type**. A `CatalogueHandle` exposes reads only, cannot be constructed for a tenant workspace, and
 * is not assignable to a `WorkspaceHandle` — so "read a standard" and "read a tenant's business
 * case" cannot be confused by a caller, however tired.
 *
 * Every access pattern a service has is a method here: a key, a partition, or an index (ADR-0021
 * §1). A new pattern is a new method with a key behind it, reviewed — never a scan.
 */

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Expr } from './expr.js';
import type { SpineEvent } from '@fps4/maestro-spine';
import type {
  Answer,
  Artifact,
  Decision,
  Draft,
  EvaluationResult,
  Question,
  Version,
  VersionState,
} from '../domain/types.js';
import { Conflict, Items, IsolationViolation, strip, type Item, type Transaction } from './items.js';
import { KINDS, workspaceKeys, type WorkspaceKeys } from './keys.js';
import { PK, GSI1_SK } from './table.js';

export { Conflict, IsolationViolation, Transaction } from './items.js';

/** One outbox row: the envelope plus the relay's bookkeeping. `workspace` is this service's id. */
export interface OutboxRow extends SpineEvent {
  workspace: string;
  delivered: boolean;
  delivered_at?: string;
  attempts: number;
}

export interface Membership {
  principal: string;
  roles: string[];
  /** Gates this principal is explicitly assigned to, for `resolver: assignment`. */
  gates?: string[];
  /**
   * For an agent: the human answerable for what it does here (ADR-0019 §2). Granted with the
   * membership, like the roles; an agent without one holds roles it cannot act in.
   */
  accountable?: string;
}

export interface StoredAcceptanceKey {
  standard: string;
  scope: string;
  project?: string;
}

/**
 * How events are projected into this workspace's items. A change to the projection — a new field
 * derived from an event, an item reshaped — bumps this, and a workspace whose `meta` item is behind
 * refuses to serve until it is rebuilt from the archive. Never an in-place migration (ADR-0020 §4).
 */
export const PROJECTION_VERSION = 2;

export interface ProjectionMeta {
  projection_version: number;
}

/**
 * The version without its text: what a list returns. Inline bodies make the wrong query
 * expensive, and this is the one operational discipline the choice demands (§8.2). Registers,
 * lineage, search results and the catalogue's shelf all go through here.
 */
export function withoutBody<T extends { body: { format: string; content: string } }>(
  record: T,
): Omit<T, 'body'> & { body: { format: string } } {
  const { body, ...rest } = record;
  return { ...rest, body: { format: body.format } };
}

const RETRIES = 3;

/** Reads and writes, bound to exactly one tenant workspace's key prefix. */
export interface WorkspaceHandle {
  readonly kind: 'tenant';
  readonly workspace: string;
  readonly artifacts: ArtifactRepository;
  readonly drafts: DraftRepository;
  readonly versions: VersionRepository;
  readonly decisions: DecisionRepository;
  readonly evaluations: EvaluationRepository;
  readonly memberships: MembershipRepository;
  readonly questions: QuestionRepository;
  readonly acceptances: AcceptanceRepository;
  readonly outbox: OutboxRepository;
  readonly counters: CounterRepository;
  readonly meta: MetaRepository;
  /**
   * One transaction over this workspace's items: `work` reads what it needs and stages its writes
   * on `tx`, each with the condition that makes its reads still true; the commit is all or nothing.
   * A counter that moved re-runs `work` — someone else recorded first — a few times before giving
   * up; a record that moved is a `Conflict` the caller turns into a refusal.
   *
   * On the handle rather than reached from a client, so a service can write a change and its
   * outbox event atomically without ever holding something that could address another workspace.
   */
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}

/** Reads only, bound to the catalogue workspace. Never constructible for a tenant. */
export interface CatalogueHandle {
  readonly kind: 'catalogue';
  readonly workspace: string;
  readonly versions: CatalogueVersions;
}

export type CatalogueVersions = Pick<
  VersionRepository,
  'get' | 'accepted' | 'inStates' | 'byStandard' | 'byStandardRef'
>;

interface Bound {
  items: Items;
  keys: WorkspaceKeys;
  workspace: string;
}

export class ArtifactRepository {
  constructor(private readonly b: Bound) {}

  private toItem(artifact: Artifact): Item {
    return { ...this.b.keys.artifact(artifact.id), kind: KINDS.artifact, ...artifact };
  }

  async get(id: string): Promise<Artifact | null> {
    const item = await this.b.items.get(this.b.keys.artifact(id));
    return item ? strip<Artifact>(item) : null;
  }

  async getMany(ids: string[]): Promise<Artifact[]> {
    if (ids.length === 0) return [];
    const items = await this.b.items.batchGet([...new Set(ids)].map((id) => this.b.keys.artifact(id)));
    return items.map((i) => strip<Artifact>(i));
  }

  /** Every lineage, most recently touched first. The register lists the workspace, so it reads it. */
  async list(): Promise<Artifact[]> {
    const items = await this.b.items.query(this.b.keys.artifacts);
    return items
      .map((i) => strip<Artifact>(i))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  }

  /**
   * Accepted ordinals for a set of artifacts, for resolving links in one round trip. The artifact
   * carries `accepted_ordinal`, written in the transaction that accepts a version, so it is the
   * one item to read — and, in `decide`, the one item to condition on.
   */
  async acceptedOrdinals(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const items = await this.b.items.batchGet<{ id: string; accepted_ordinal?: number }>(
      [...new Set(ids)].map((id) => this.b.keys.artifact(id)),
      ['id', 'accepted_ordinal'],
    );
    return new Map(items.filter((i) => i.accepted_ordinal).map((i) => [i.id, i.accepted_ordinal!]));
  }

  async insert(artifact: Artifact, tx?: Transaction): Promise<void> {
    const message = `Artifact \`${artifact.id}\` already exists.`;
    if (tx) tx.insert(this.toItem(artifact), message);
    else await this.b.items.insert(this.toItem(artifact), message);
  }

  /** Update fields; `expectLatest` conditions on the ordinal the caller read (a propose race). */
  async update(
    id: string,
    fields: Partial<Omit<Artifact, 'id' | 'workspace'>>,
    tx?: Transaction,
    options: { expectLatest?: number; onConflict?: string } = {},
  ): Promise<void> {
    const spec = {
      set: fields,
      ...(options.expectLatest !== undefined
        ? {
            condition: (e: Expr) => `${e.n('latest_ordinal')} = ${e.v(options.expectLatest)}`,
            onConflict: options.onConflict,
          }
        : {}),
    };
    if (tx) tx.update(this.b.keys.artifact(id), spec);
    else await this.b.items.update(this.b.keys.artifact(id), spec);
  }

  /** Assert, in a transaction, that an artifact's accepted ordinal is still what was read. */
  checkAccepted(tx: Transaction, id: string, ordinal: number | undefined): void {
    tx.check(
      this.b.keys.artifact(id),
      (e) =>
        ordinal === undefined
          ? `attribute_not_exists(${e.n('accepted_ordinal')})`
          : `${e.n('accepted_ordinal')} = ${e.v(ordinal)}`,
      `\`${id}\` was accepted or superseded while this decision was being recorded. Decide again.`,
    );
  }
}

/** The draft's expiry is the table's TTL: epoch seconds on the item, ISO on the record. */
function draftToItem(keys: WorkspaceKeys, draft: Draft): Item {
  const { expires_at, ...rest } = draft;
  return {
    ...keys.draft(draft.id),
    kind: KINDS.draft,
    ...(draft.artifact ? keys.draftByArtifact(draft.artifact, draft.id) : {}),
    ...rest,
    ...(expires_at ? { expires_at: Math.floor(Date.parse(expires_at) / 1000) } : {}),
  };
}

function draftFromItem(item: Record<string, unknown>): Draft {
  const record = strip<Draft & { expires_at?: number | string }>(item);
  if (typeof record.expires_at === 'number') {
    return { ...record, expires_at: new Date(record.expires_at * 1000).toISOString() };
  }
  return record as Draft;
}

export class DraftRepository {
  constructor(private readonly b: Bound) {}

  async get(id: string): Promise<Draft | null> {
    const item = await this.b.items.get(this.b.keys.draft(id));
    return item ? draftFromItem(item) : null;
  }

  /** Every draft, most recently saved first, without its text. */
  async list(): Promise<Array<ReturnType<typeof withoutBody<Draft>>>> {
    const items = await this.b.items.query(this.b.keys.drafts);
    return items
      .map((i) => withoutBody(draftFromItem(i)))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  }

  /** The drafts open on any of these artifacts: the register's `open_draft` (gsi1, sparse). */
  async openOn(artifacts: string[]): Promise<Array<{ id: string; artifact: string }>> {
    if (artifacts.length === 0) return [];
    const wanted = new Set(artifacts);
    const items = await this.b.items.query<{ id: string; artifact: string }>(this.b.keys.draftsByArtifact, {
      index: 'gsi1',
      projection: ['id', 'artifact'],
    });
    return items.filter((i) => wanted.has(i.artifact));
  }

  async insert(draft: Draft, tx?: Transaction): Promise<void> {
    const message = `Draft \`${draft.id}\` already exists.`;
    if (tx) tx.insert(draftToItem(this.b.keys, draft), message);
    else await this.b.items.insert(draftToItem(this.b.keys, draft), message);
  }

  /**
   * Save, conditioned on the revision the caller read, so two concurrent saves cannot both win:
   * the loser's condition no longer matches and it gets `null` rather than overwriting silently.
   */
  async save(id: string, expectedRevision: number, fields: Partial<Draft>): Promise<Draft | null> {
    const { expires_at, ...rest } = fields;
    try {
      const updated = await this.b.items.update(this.b.keys.draft(id), {
        set: {
          ...rest,
          ...(expires_at ? { expires_at: Math.floor(Date.parse(expires_at) / 1000) } : {}),
        },
        condition: (e) => `${e.n('revision')} = ${e.v(expectedRevision)}`,
      });
      return draftFromItem(updated);
    } catch (error) {
      if (error instanceof Conflict) return null;
      throw error;
    }
  }

  /** Delete; in a transaction the draft must still exist — a draft consumed twice is a race lost. */
  async delete(id: string, tx?: Transaction): Promise<void> {
    if (tx) {
      tx.delete(this.b.keys.draft(id), {
        condition: (e) => `attribute_exists(${e.n(PK)})`,
        onConflict: `Draft \`${id}\` was already proposed or discarded.`,
      });
    } else {
      await this.b.items.delete(this.b.keys.draft(id));
    }
  }
}

function versionToItem(keys: WorkspaceKeys, version: Version): Item {
  const standard = (version.facets as { standard_id?: unknown }).standard_id;
  return {
    ...keys.version(version.artifact, version.ordinal),
    kind: KINDS.version,
    ...keys.versionByState(version.state, version.artifact, version.ordinal),
    ...(typeof standard === 'string' ? keys.versionByStandard(standard, version.ordinal) : {}),
    ...version,
  };
}

export class VersionRepository {
  constructor(private readonly b: Bound) {}

  async get(artifact: string, ordinal: number): Promise<Version | null> {
    const item = await this.b.items.get(this.b.keys.version(artifact, ordinal));
    return item ? strip<Version>(item) : null;
  }

  /** Several versions by reference, without their text. */
  async getMany(
    refs: Array<{ artifact: string; ordinal: number }>,
  ): Promise<Array<ReturnType<typeof withoutBody<Version>>>> {
    if (refs.length === 0) return [];
    const items = await this.b.items.batchGet(refs.map((r) => this.b.keys.version(r.artifact, r.ordinal)));
    return items.map((i) => withoutBody(strip<Version>(i)));
  }

  /** A lineage's versions, newest first, without their text. */
  async ofArtifact(artifact: string): Promise<Array<ReturnType<typeof withoutBody<Version>>>> {
    const items = await this.b.items.query(this.b.keys.versionsOf(artifact), { forward: false });
    return items.map((i) => withoutBody(strip<Version>(i)));
  }

  /** A lineage's versions in one state, oldest first, without their text. */
  async ofArtifactInState(
    artifact: string,
    state: VersionState,
  ): Promise<Array<ReturnType<typeof withoutBody<Version>>>> {
    const items = await this.b.items.query(this.b.keys.versionsOf(artifact), {
      filter: (e) => `${e.n('state')} = ${e.v(state)}`,
    });
    return items.map((i) => withoutBody(strip<Version>(i)));
  }

  /** The accepted version of a lineage, with its text. There is at most one. */
  async accepted(artifact: string): Promise<Version | null> {
    const items = await this.b.items.query(this.b.keys.versionsOf(artifact), {
      filter: (e) => `${e.n('state')} = ${e.v('accepted')}`,
    });
    return items.length ? strip<Version>(items[0]!) : null;
  }

  /** Who proposed the first version — the lineage's creator. */
  async creator(artifact: string): Promise<string | undefined> {
    const items = await this.b.items.query<{ proposed_by: string }>(this.b.keys.versionsOf(artifact), {
      limit: 1,
      projection: ['proposed_by'],
    });
    return items[0]?.proposed_by;
  }

  /**
   * Every version of the workspace in any of these states, without its text (gsi1). Bounded by
   * the workspace: the catalogue's shelf, a lineage's incoming links.
   */
  async inStates(states: VersionState[]): Promise<Array<ReturnType<typeof withoutBody<Version>>>> {
    const out: Array<ReturnType<typeof withoutBody<Version>>> = [];
    for (const state of states) {
      const items = await this.b.items.query(this.b.keys.versionsByState, {
        index: 'gsi1',
        sk: { beginsWith: `${state}#` },
      });
      out.push(...items.map((i) => withoutBody(strip<Version>(i))));
    }
    return out;
  }

  /**
   * Every version of the workspace, with its text: the search (ADR-0021 §5). A filtered read of
   * the workspace's versions, paged; adequate for the MVP, and bounded by construction.
   */
  async all(): Promise<Version[]> {
    const items = await this.b.items.query(this.b.keys.versionsByState, { index: 'gsi1' });
    return items.map((i) => strip<Version>(i));
  }

  /** The versions carrying a standard's stable id, oldest first, without their text (gsi2). */
  async byStandard(standard: string): Promise<Array<ReturnType<typeof withoutBody<Version>>>> {
    const items = await this.b.items.query(this.b.keys.versionsByStandard, {
      index: 'gsi2',
      sk: { beginsWith: `${standard}#` },
    });
    return items.map((i) => withoutBody(strip<Version>(i)));
  }

  /** One standard at one ordinal, without its text (gsi2). */
  async byStandardRef(
    standard: string,
    ordinal: number,
  ): Promise<ReturnType<typeof withoutBody<Version>> | null> {
    const items = await this.b.items.query(this.b.keys.versionsByStandard, {
      index: 'gsi2',
      sk: { eq: this.b.keys.versionByStandard(standard, ordinal).gsi2sk },
    });
    return items.length ? withoutBody(strip<Version>(items[0]!)) : null;
  }

  /** The key `(artifact, ordinal)` is unique by construction: a second @n is refused. */
  async insert(version: Version, tx?: Transaction): Promise<void> {
    const message = `\`${version.artifact}@${version.ordinal}\` already exists. Propose again.`;
    if (tx) tx.insert(versionToItem(this.b.keys, version), message);
    else await this.b.items.insert(versionToItem(this.b.keys, version), message);
  }

  /**
   * Update a version's mutable fields — its state, its decided-at, its frozen links. A state change
   * moves the version on gsi1 too. `expectState` conditions on the state the caller read.
   */
  async update(
    artifact: string,
    ordinal: number,
    fields: Partial<Pick<Version, 'state' | 'decided_at' | 'materiality' | 'links' | 'redacted_at'>>,
    tx?: Transaction,
    options: { expectState?: VersionState; onConflict?: string } = {},
  ): Promise<boolean> {
    const set: Record<string, unknown> = { ...fields };
    if (fields.state) {
      set[GSI1_SK] = this.b.keys.versionByState(fields.state, artifact, ordinal).gsi1sk;
    }
    const spec = {
      set,
      condition: (e: Expr) =>
        options.expectState
          ? `attribute_exists(${e.n(PK)}) AND ${e.n('state')} = ${e.v(options.expectState)}`
          : `attribute_exists(${e.n(PK)})`,
      onConflict:
        options.onConflict ??
        (options.expectState
          ? `\`${artifact}@${ordinal}\` is no longer ${options.expectState}.`
          : `Version \`${artifact}@${ordinal}\` does not exist in this workspace.`),
    };
    if (tx) {
      tx.update(this.b.keys.version(artifact, ordinal), spec);
      return true;
    }
    try {
      await this.b.items.update(this.b.keys.version(artifact, ordinal), spec);
      return true;
    } catch (error) {
      if (error instanceof Conflict) return false;
      throw error;
    }
  }
}

export class DecisionRepository {
  constructor(private readonly b: Bound) {}

  /** The decisions taken on a lineage, newest first. */
  async ofArtifact(artifact: string): Promise<Decision[]> {
    const items = await this.b.items.query(this.b.keys.decisionsOf(artifact));
    return items
      .map((i) => strip<Decision>(i))
      .sort((a, b) => b.decided_at.localeCompare(a.decided_at) || b.id.localeCompare(a.id));
  }

  async insert(decision: Decision, tx?: Transaction): Promise<void> {
    const item: Item = {
      ...this.b.keys.decision(decision.artifact, decision.id),
      kind: KINDS.decision,
      ...decision,
    };
    const message = `Decision \`${decision.id}\` already exists.`;
    if (tx) tx.insert(item, message);
    else await this.b.items.insert(item, message);
  }
}

export class EvaluationRepository {
  constructor(private readonly b: Bound) {}

  async ofVersion(artifact: string, ordinal: number): Promise<EvaluationResult[]> {
    const items = await this.b.items.query(this.b.keys.evaluationsOf(artifact, ordinal));
    return items.map((i) => strip<EvaluationResult>(i));
  }

  /** One verdict per evaluator per version: a re-run replaces. */
  async put(record: EvaluationResult, tx?: Transaction): Promise<void> {
    const item: Item = {
      ...this.b.keys.evaluation(record.artifact, record.ordinal, record.evaluator),
      kind: KINDS.evaluation,
      ...record,
    };
    if (tx) tx.put(item);
    else await this.b.items.put(item);
  }
}

export class MembershipRepository {
  constructor(private readonly b: Bound) {}

  async get(principal: string): Promise<Membership | null> {
    const item = await this.b.items.get(this.b.keys.membership(principal));
    return item ? strip<Membership>(item) : null;
  }

  /** Grant, or re-grant: a membership is what the tenant's configuration says, whole. */
  async put(membership: Membership): Promise<void> {
    await this.b.items.put({
      ...this.b.keys.membership(membership.principal),
      kind: KINDS.membership,
      ...membership,
    });
  }
}

function questionToItem(keys: WorkspaceKeys, question: Question): Item {
  return {
    ...keys.question(question.id),
    kind: KINDS.question,
    ...keys.questionOf(question.artifact, question.ordinal, question.asked_at, question.id),
    ...question,
  };
}

export class QuestionRepository {
  constructor(private readonly b: Bound) {}

  async get(id: string): Promise<Question | null> {
    const item = await this.b.items.get(this.b.keys.question(id));
    return item ? strip<Question>(item) : null;
  }

  /** The questions on a version, in the order asked (gsi1). */
  async ofVersion(artifact: string, ordinal: number): Promise<Question[]> {
    const items = await this.b.items.query(this.b.keys.questionsOf(artifact, ordinal), { index: 'gsi1' });
    return items.map((i) => strip<Question>(i));
  }

  /** Open questions on a version — the number a gate may block on (gsi1, filtered). */
  async openCount(artifact: string, ordinal: number): Promise<number> {
    const items = await this.b.items.query(this.b.keys.questionsOf(artifact, ordinal), {
      index: 'gsi1',
      filter: (e) => `attribute_not_exists(${e.n('resolved_at')})`,
      projection: ['id'],
    });
    return items.length;
  }

  async insert(question: Question, tx?: Transaction): Promise<void> {
    const message = `Question \`${question.id}\` already exists.`;
    if (tx) tx.insert(questionToItem(this.b.keys, question), message);
    else await this.b.items.insert(questionToItem(this.b.keys, question), message);
  }

  /**
   * Append an answer. In a transaction the question must still be open and hold exactly the
   * answers the caller saw — the answer's id is minted from their count.
   */
  async answer(id: string, answer: Answer, expectedAnswers: number, tx?: Transaction): Promise<void> {
    const spec = {
      setRaw: (e: Expr): Array<[string, string]> => [
        ['answers', `list_append(${e.n('answers')}, ${e.v([answer])})`],
      ],
      ...(tx
        ? {
            condition: (e: Expr) =>
              `attribute_exists(${e.n(PK)}) AND attribute_not_exists(${e.n('resolved_at')}) AND size(${e.n('answers')}) = ${e.v(expectedAnswers)}`,
            onConflict: 'This question changed while you were answering. Reload and try again.',
          }
        : { condition: (e: Expr) => `attribute_exists(${e.n(PK)})` }),
    };
    if (tx) tx.update(this.b.keys.question(id), spec);
    else await this.b.items.update(this.b.keys.question(id), spec);
  }

  async resolve(id: string, at: string, by: string, tx?: Transaction): Promise<void> {
    const spec = {
      set: { resolved_at: at, resolved_by: by },
      condition: (e: Expr) =>
        tx
          ? `attribute_exists(${e.n(PK)}) AND attribute_not_exists(${e.n('resolved_at')})`
          : `attribute_exists(${e.n(PK)})`,
      onConflict: 'This question was closed while you were closing it.',
    };
    if (tx) tx.update(this.b.keys.question(id), spec);
    else await this.b.items.update(this.b.keys.question(id), spec);
  }
}

export interface StoredAcceptance extends StoredAcceptanceKey {
  status: 'active' | 'lapsed' | 'overridden';
}

export class AcceptanceRepository {
  constructor(private readonly b: Bound) {}

  async list<T extends StoredAcceptance>(): Promise<T[]> {
    const items = await this.b.items.query(this.b.keys.acceptances);
    return items.map((i) => strip<T>(i)).sort((a, b) => a.standard.localeCompare(b.standard));
  }

  async setStatus(
    key: StoredAcceptanceKey,
    status: StoredAcceptance['status'],
    lapsedAtOrdinal?: number,
  ): Promise<void> {
    await this.b.items.update(this.b.keys.acceptance(key.standard, key.scope, key.project), {
      set: { status, ...(lapsedAtOrdinal ? { lapsed_at_ordinal: lapsedAtOrdinal } : {}) },
      condition: (e) => `attribute_exists(${e.n(PK)})`,
    });
  }
}

function outboxToItem(keys: WorkspaceKeys, row: OutboxRow): Item {
  return {
    ...keys.outboxItem(row.seq),
    kind: KINDS.outbox,
    ...(row.delivered ? {} : keys.pending(row.seq)),
    ...row,
  };
}

export class OutboxRepository {
  constructor(private readonly b: Bound) {}

  /** Every row, in sequence. */
  async list(): Promise<OutboxRow[]> {
    const items = await this.b.items.query(this.b.keys.outbox);
    return items.map((i) => strip<OutboxRow>(i));
  }

  /** Undelivered rows, oldest first (the sparse `pending` index). */
  async pending(limit: number): Promise<OutboxRow[]> {
    const items = await this.b.items.query(this.b.keys.outbox, { index: 'pending', limit });
    return items.map((i) => strip<OutboxRow>(i));
  }

  /** `(workspace, seq)` is the key: the spine's rule, enforced by the put. */
  insert(row: OutboxRow, tx: Transaction): void {
    tx.insert(outboxToItem(this.b.keys, row), `Outbox seq ${row.seq} is already taken.`);
  }

  /** The rebuilder's restore: every row delivered, none pending. */
  async insertMany(rows: OutboxRow[]): Promise<void> {
    await this.b.items.batchWrite(rows.map((row) => outboxToItem(this.b.keys, row)));
  }

  /** Delivered: leave the pending index, count the attempt. Idempotent. */
  async ack(seq: number, at: string): Promise<void> {
    await this.b.items.update(this.b.keys.outboxItem(seq), {
      set: { delivered: true, delivered_at: at },
      remove: ['pending_pk', 'pending_sk'],
      add: { attempts: 1 },
      condition: (e) => `attribute_exists(${e.n(PK)})`,
      onConflict: `Outbox seq ${seq} does not exist.`,
    });
  }
}

export class CounterRepository {
  constructor(private readonly b: Bound) {}

  async get(name: string): Promise<number> {
    const item = await this.b.items.get<{ value: number }>(this.b.keys.counter(name), ['value']);
    return item?.value ?? 0;
  }

  /**
   * Move a counter from the value that was read, in a transaction: the condition is what makes
   * `seq` a property of the stream (ADR-0021 §2). A counter that moved re-runs the caller.
   */
  bump(name: string, expected: number, by: number, tx: Transaction): void {
    tx.update(this.b.keys.counter(name), {
      set: { kind: KINDS.counter, value: expected + by },
      condition: (e) =>
        expected === 0 ? `attribute_not_exists(${e.n(PK)})` : `${e.n('value')} = ${e.v(expected)}`,
      onConflict: `The workspace's \`${name}\` counter moved: another act was recorded first.`,
      retry: true,
    });
  }

  /** The rebuilder's restore. */
  async putMany(values: Array<{ name: string; value: number }>): Promise<void> {
    await this.b.items.batchWrite(
      values.map(({ name, value }) => ({ ...this.b.keys.counter(name), kind: KINDS.counter, value })),
    );
  }
}

export class MetaRepository {
  constructor(private readonly b: Bound) {}

  async get(): Promise<ProjectionMeta | null> {
    const item = await this.b.items.get(this.b.keys.meta());
    return item ? strip<ProjectionMeta>(item) : null;
  }

  async put(meta: ProjectionMeta): Promise<void> {
    await this.b.items.put({ ...this.b.keys.meta(), kind: KINDS.meta, ...meta });
  }

  /** Stamp a workspace nothing has stamped; leave an existing stamp alone. */
  async putIfAbsent(meta: ProjectionMeta): Promise<void> {
    try {
      await this.b.items.insert({ ...this.b.keys.meta(), kind: KINDS.meta, ...meta }, 'stamped');
    } catch (error) {
      if (!(error instanceof Conflict)) throw error;
    }
  }
}

/**
 * A writable handle, bound to exactly one workspace.
 *
 * The catalogue is *authored* through one of these too — writing a standard is ordinary authoring,
 * through the same drafts, versions and gates as anything else. What stops a tenant session
 * reaching the catalogue this way is not the handle's type but membership: a handle is only ever
 * acquired for a workspace the caller belongs to, and that check lives in the auth layer where the
 * caller is known. Putting it here as well would give two answers to one question.
 */
export function workspaceHandle(
  doc: DynamoDBDocumentClient,
  table: string,
  workspace: string,
): WorkspaceHandle {
  const keys = workspaceKeys(workspace);
  const items = new Items(doc, table, keys.prefix);
  const b: Bound = { items, keys, workspace };
  return {
    kind: 'tenant',
    workspace,
    artifacts: new ArtifactRepository(b),
    drafts: new DraftRepository(b),
    versions: new VersionRepository(b),
    decisions: new DecisionRepository(b),
    evaluations: new EvaluationRepository(b),
    memberships: new MembershipRepository(b),
    questions: new QuestionRepository(b),
    acceptances: new AcceptanceRepository(b),
    outbox: new OutboxRepository(b),
    counters: new CounterRepository(b),
    meta: new MetaRepository(b),
    async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
      for (let attempt = 1; ; attempt += 1) {
        const tx = items.transaction();
        const result = await work(tx);
        try {
          await tx.commit();
          return result;
        } catch (error) {
          if (error instanceof Conflict && error.retry && attempt < RETRIES) continue;
          throw error;
        }
      }
    },
  };
}

export function catalogueHandle(
  doc: DynamoDBDocumentClient,
  table: string,
  workspace: string,
  kind: 'tenant' | 'catalogue',
): CatalogueHandle {
  // A CatalogueHandle over a tenant's prefix would be a read across the confidentiality boundary
  // wearing the one type that is allowed to cross it. This is the check that makes the type mean
  // what it says, and the adversarial test in tests/integration/isolation.test.ts drives it.
  if (kind !== 'catalogue') {
    throw new IsolationViolation(
      `\`${workspace}\` is a tenant workspace and cannot be reached through a CatalogueHandle. Only the catalogue is readable across workspaces.`,
    );
  }
  const keys = workspaceKeys(workspace);
  const versions = new VersionRepository({ items: new Items(doc, table, keys.prefix), keys, workspace });
  // A *projection* of the repository, not a cast of it. A cast is a promise to the compiler that
  // the next person can break with one `as`; this hands out an object that has no write method to
  // reach. The boundary this guards is the one place a read is allowed to cross a workspace.
  return {
    kind: 'catalogue',
    workspace,
    versions: {
      get: versions.get.bind(versions),
      accepted: versions.accepted.bind(versions),
      inStates: versions.inStates.bind(versions),
      byStandard: versions.byStandard.bind(versions),
      byStandardRef: versions.byStandardRef.bind(versions),
    },
  };
}
