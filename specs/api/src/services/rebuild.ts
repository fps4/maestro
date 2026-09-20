/**
 * The rebuilder (ADR-0020 §4): a workspace's items, from the archive and the payloads alone.
 *
 * This is what makes "the archive is the record and this table a projection" (architecture §5)
 * a fact rather than a sentence — maestro's M1 gate. Verify first: an archive the spine's verifier
 * does not pass is not rebuilt from. Then replay every event in `seq` order into an empty prefix,
 * fetching each payload by reference and checking it against the digest the event carries before
 * anything is read from it. What comes out reads identically to what was dropped.
 *
 * Not rebuilt, and why (ADR-0020 §5): memberships are grants, re-applied from the tenant's
 * configuration; drafts are not record, except the one a `request_changes` reopened, recreated as
 * it was at reopen; acceptances are derived, and `refresh` runs after replay; attachment blobs
 * were never in the table.
 */

import {
  parseEventLine,
  readDay,
  verifyRange,
  type ArchiveStore,
  type SpineEvent,
} from '@fps4/maestro-spine';
import type { Store } from '../db/client.js';
import { PROJECTION_VERSION, type OutboxRow, type WorkspaceHandle } from '../db/handle.js';
import { parseVersionRef, spineWorkspaceId } from '../domain/ids.js';
import { phaseAfterPropose } from '../domain/lifecycle.js';
import type {
  Answer,
  Decision,
  Draft,
  EvaluationResult,
  Link,
  Question,
  Version,
  VersionState,
} from '../domain/types.js';
import {
  initialPhase,
  parseWorkspaceDefinition,
  type WorkspaceDefinition,
} from '../domain/workspace-definition.js';
import { readPayload, type PayloadRef, type PayloadStore } from '../record/payload-store.js';
import type { VersionPayload } from './artifacts.js';
import { AcceptanceService, CatalogueReader } from './catalogue.js';
import type { DecisionPayload } from './decisions.js';
import type { EvaluationPayload } from './evaluate.js';
import type { TextPayload } from './questions.js';

export class RebuildRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RebuildRefused';
  }
}

export interface RebuildInput {
  workspace: string;
  archive: ArchiveStore;
  payloads: PayloadStore;
  /** Drop a populated target first. Without it a populated target is refused. */
  force?: boolean;
  now?: () => string;
}

export interface RebuildReport {
  workspace: string;
  events: number;
  versions: number;
  artifacts: number;
  decisions: number;
  evaluations: number;
  questions: number;
  drafts_reopened: number;
  acceptances: { checked: number; lapsed: string[] };
}

const OUTBOX_BATCH = 500;

export class RebuildService {
  constructor(private readonly store: Store) {}

  async rebuild(input: RebuildInput): Promise<RebuildReport> {
    const now = input.now ?? (() => new Date().toISOString());
    const ws = spineWorkspaceId(input.workspace);

    // 1. Verify first. The spine's own verifier over the configured store, with nothing trusted.
    const verdict = await verifyRange(input.archive, ws);
    if (!verdict.ok) {
      throw new RebuildRefused(
        `The archive for \`${ws}\` does not verify at ${verdict.period || '(no period)'}` +
          `${verdict.seq === null ? '' : `, seq ${verdict.seq}`}: ${verdict.reason}. ` +
          'A workspace is not rebuilt from an unverified archive.',
      );
    }

    // 2. Empty target. The control items — definitions, principals — are not touched.
    if (input.force) await this.store.dropWorkspace(input.workspace);
    const populated = await this.store.populatedRecordKinds(input.workspace);
    if (populated.length > 0) {
      throw new RebuildRefused(
        `Workspace \`${input.workspace}\` is not empty (it holds ${populated.join(', ')} items). ` +
          'Pass --force to drop it and rebuild from the archive.',
      );
    }
    const handle = await this.store.handle(input.workspace);

    // 3. Replay, in seq order, every day the archive holds.
    const projector = new Projector(this.store, handle, input.workspace, input.payloads);
    const rows: OutboxRow[] = [];
    const subjects = new Map<string, number>();
    let expected = 1;
    let last = 0;
    const deliveredAt = now();
    for (const day of await input.archive.listDays(ws)) {
      for (const line of await readDay(input.archive, ws, day)) {
        const event = parseEventLine(line);
        if (event.seq !== expected) {
          throw new RebuildRefused(
            `The archive for \`${ws}\` skips from seq ${expected - 1} to ${event.seq}.`,
          );
        }
        await projector.apply(event);
        subjects.set(event.subject_id, event.subject_seq);
        rows.push({
          ...event,
          workspace: input.workspace,
          delivered: true,
          delivered_at: deliveredAt,
          attempts: 1,
        });
        if (rows.length >= OUTBOX_BATCH) await handle.outbox.insertMany(rows.splice(0));
        last = event.seq;
        expected += 1;
      }
    }
    if (rows.length > 0) await handle.outbox.insertMany(rows);

    // The counters the emitting transaction would have left: the workspace's seq, each subject's.
    if (last > 0) {
      await handle.counters.putMany([
        { name: 'outbox', value: last },
        ...[...subjects].map(([subject, seq]) => ({ name: `subject#${subject}`, value: seq })),
      ]);
    }

    await handle.meta.put({ projection_version: PROJECTION_VERSION });

    // 4. What is derived: acceptances are recomputed against the catalogue.
    const acceptances = await new AcceptanceService(
      handle,
      new CatalogueReader(await this.store.catalogue()),
    ).refresh();

    return { workspace: input.workspace, events: last, ...projector.counts, acceptances };
  }
}

/**
 * The projection: one event at a time, in order, into the items the services write. Each branch
 * mirrors the transaction that emitted the event; a divergence between the two is the defect the
 * rebuild test exists to catch.
 */
class Projector {
  readonly counts = {
    versions: 0,
    artifacts: 0,
    decisions: 0,
    evaluations: 0,
    questions: 0,
    drafts_reopened: 0,
  };
  private readonly definitions = new Map<number, WorkspaceDefinition>();

  constructor(
    private readonly store: Store,
    private readonly handle: WorkspaceHandle,
    private readonly workspace: string,
    private readonly payloads: PayloadStore,
  ) {}

  private refuse(event: SpineEvent, why: string): never {
    throw new RebuildRefused(`Cannot project seq ${event.seq} (${event.type}, ${event.subject_id}): ${why}`);
  }

  private subject(event: SpineEvent): { artifact: string; ordinal: number } {
    if (event.subject_type !== 'version')
      this.refuse(event, `subject type \`${event.subject_type}\` is not projected`);
    const parsed = parseVersionRef(event.subject_id);
    if (!parsed) this.refuse(event, 'the subject is not a version reference');
    return parsed;
  }

  /** The payload the event names, checked against its digest before anything reads it. */
  private async payload<T>(event: SpineEvent): Promise<T> {
    if (!event.payload_ref || !event.payload_digest) this.refuse(event, 'the event names no payload');
    const ref: PayloadRef = { ref: event.payload_ref, digest: event.payload_digest };
    try {
      return await readPayload<T>(this.payloads, ref);
    } catch (error) {
      this.refuse(event, (error as Error).message);
    }
  }

  /** The definition the event was written under, from the control items. */
  private async definition(event: SpineEvent, version: number): Promise<WorkspaceDefinition> {
    const cached = this.definitions.get(version);
    if (cached) return cached;
    const stored = await this.store.control.definitions.get(this.workspace, version);
    if (!stored) this.refuse(event, `definition version ${version} is not stored for this workspace`);
    const definition = parseWorkspaceDefinition(stored.definition);
    this.definitions.set(version, definition);
    return definition;
  }

  private async version(event: SpineEvent): Promise<Version> {
    const subject = this.subject(event);
    const version = await this.handle.versions.get(subject.artifact, subject.ordinal);
    if (!version) this.refuse(event, 'its version was never proposed on this record');
    return version;
  }

  async apply(event: SpineEvent): Promise<void> {
    switch (event.type) {
      case 'VersionProposed':
        return this.versionProposed(event);
      case 'DecisionRecorded':
        return this.decisionRecorded(event);
      case 'VersionSuperseded':
        return this.versionState(event, 'superseded', {});
      case 'VersionWithdrawn':
        // The reason, when given, is a payload; the projection needs nothing from it, but every
        // payload an event names is fetched and checked — a rebuild that skips one is not a proof.
        if (event.payload_ref) await this.payload<{ reason: string }>(event);
        return this.versionState(event, 'withdrawn', { decided_at: event.occurred_at });
      case 'LinkPinned':
        return this.linkPinned(event);
      case 'EvaluationRecorded':
        return this.evaluationRecorded(event);
      case 'QuestionRaised':
        return this.questionRaised(event);
      case 'QuestionAnswered':
        return this.questionAnswered(event);
      case 'QuestionResolved':
        return this.questionResolved(event);
      case 'DecisionRefused':
        // A refusal changed no state; it is restored to the outbox and nowhere else.
        return;
      default:
        this.refuse(event, `type \`${event.type}\` is not one this projection knows`);
    }
  }

  private async versionProposed(event: SpineEvent): Promise<void> {
    const subject = this.subject(event);
    const payload = await this.payload<VersionPayload>(event);
    const body = event.body as { type: string; digest: string; definition_version: number };
    if (payload.artifact !== subject.artifact || payload.ordinal !== subject.ordinal) {
      this.refuse(event, `the payload describes ${payload.artifact}@${payload.ordinal}, not the subject`);
    }
    if (payload.digest !== body.digest || payload.type !== body.type) {
      this.refuse(event, 'the payload disagrees with the body on the version’s digest or type');
    }
    const definition = await this.definition(event, body.definition_version);

    const version: Version = { workspace: this.workspace, ...payload, state: 'proposed' };
    await this.handle.versions.insert(version);
    this.counts.versions += 1;

    const artifact = await this.handle.artifacts.get(subject.artifact);
    if (artifact) {
      await this.handle.artifacts.update(subject.artifact, {
        latest_ordinal: subject.ordinal,
        phase: phaseAfterPropose(definition, artifact.phase) ?? artifact.phase,
        title: version.title,
        updated_at: event.occurred_at,
      });
    } else {
      await this.handle.artifacts.insert({
        id: subject.artifact,
        workspace: this.workspace,
        type: version.type,
        title: version.title,
        phase: initialPhase(definition),
        latest_ordinal: subject.ordinal,
        created_at: event.occurred_at,
        updated_at: event.occurred_at,
      });
      this.counts.artifacts += 1;
    }
  }

  private async decisionRecorded(event: SpineEvent): Promise<void> {
    const subject = this.subject(event);
    const version = await this.version(event);
    const payload = await this.payload<DecisionPayload>(event);
    const body = event.body as {
      decision: string;
      gate: string;
      outcome: string;
      state: VersionState;
      subject_digest: string;
      attribution: Decision['attribution'];
      materiality?: Version['materiality'];
      phase?: string;
      reopened_draft?: string;
    };

    const decision: Decision = {
      id: body.decision,
      workspace: this.workspace,
      gate: body.gate,
      artifact: subject.artifact,
      ordinal: subject.ordinal,
      subject_digest: body.subject_digest,
      outcome: body.outcome,
      ...(payload.reasoning !== undefined ? { reasoning: payload.reasoning } : {}),
      attribution: body.attribution,
      evaluations: payload.evaluations,
      decided_by: event.acting,
      decided_at: event.occurred_at,
    };
    await this.handle.decisions.insert(decision);
    this.counts.decisions += 1;

    await this.handle.versions.update(subject.artifact, subject.ordinal, {
      state: body.state,
      decided_at: event.occurred_at,
      ...(body.materiality ? { materiality: body.materiality } : {}),
    });
    await this.handle.artifacts.update(subject.artifact, {
      ...(body.phase ? { phase: body.phase } : {}),
      ...(body.state === 'accepted' ? { accepted_ordinal: subject.ordinal } : {}),
      updated_at: event.occurred_at,
    });

    // A reopened draft, as it was at reopen (ADR-0020 §5): the refused version, editable again.
    if (body.reopened_draft) {
      const draft: Draft = {
        id: body.reopened_draft,
        workspace: this.workspace,
        artifact: subject.artifact,
        type: version.type,
        title: version.title,
        revision: 1,
        facets: version.facets,
        provenance: version.provenance,
        body: version.body,
        attachments: version.attachments,
        links: version.links,
        ...(version.catalogue_refs ? { catalogue_refs: version.catalogue_refs } : {}),
        ...(version.classification ? { classification: version.classification } : {}),
        ...(version.effective ? { effective: version.effective } : {}),
        contributors: version.contributors,
        based_on: version.ordinal,
        reopened_from_decision: decision.id,
        created_at: event.occurred_at,
        updated_at: event.occurred_at,
      };
      await this.handle.drafts.insert(draft);
      this.counts.drafts_reopened += 1;
    }
  }

  private async versionState(
    event: SpineEvent,
    state: VersionState,
    more: Partial<Pick<Version, 'decided_at'>>,
  ): Promise<void> {
    const subject = this.subject(event);
    const updated = await this.handle.versions.update(subject.artifact, subject.ordinal, { state, ...more });
    if (!updated) this.refuse(event, 'its version was never proposed on this record');
  }

  private async linkPinned(event: SpineEvent): Promise<void> {
    const subject = this.subject(event);
    const version = await this.version(event);
    const body = event.body as { links: Array<{ type: string; target: string; pinned_to: number }> };
    const links: Link[] = version.links.map((link) => {
      const pin = body.links.find((p) => p.type === link.type && p.target === link.target);
      return pin && link.pinned_to == null ? { ...link, pinned_to: pin.pinned_to } : link;
    });
    await this.handle.versions.update(subject.artifact, subject.ordinal, { links });
  }

  private async evaluationRecorded(event: SpineEvent): Promise<void> {
    const subject = this.subject(event);
    await this.version(event);
    const payload = await this.payload<EvaluationPayload>(event);
    const body = event.body as {
      evaluator: string;
      verdict: EvaluationResult['verdict'];
      subject_digest: string;
    };
    const record: EvaluationResult = {
      evaluator: body.evaluator,
      artifact: subject.artifact,
      ordinal: subject.ordinal,
      verdict: body.verdict,
      ...(payload.findings ? { findings: payload.findings } : {}),
      subject_digest: body.subject_digest,
      recorded_at: event.occurred_at,
    };
    await this.handle.evaluations.put(record);
    this.counts.evaluations += 1;
  }

  private async questionRaised(event: SpineEvent): Promise<void> {
    const subject = this.subject(event);
    await this.version(event);
    const payload = await this.payload<TextPayload>(event);
    const body = event.body as { question: string; asked_kind: Question['asked_kind'] };
    const question: Question = {
      id: body.question,
      workspace: this.workspace,
      artifact: subject.artifact,
      ordinal: subject.ordinal,
      text: payload.text,
      asked_by: event.acting,
      asked_kind: body.asked_kind,
      asked_at: event.occurred_at,
      answers: [],
    };
    await this.handle.questions.insert(question);
    this.counts.questions += 1;
  }

  private async questionAnswered(event: SpineEvent): Promise<void> {
    const payload = await this.payload<TextPayload>(event);
    const body = event.body as { question: string; answer: string; kind: Answer['kind'] };
    const answer: Answer = {
      id: body.answer,
      text: payload.text,
      by: event.acting,
      kind: body.kind,
      at: event.occurred_at,
    };
    const question = await this.handle.questions.get(body.question);
    if (!question) this.refuse(event, `question \`${body.question}\` was never raised on this record`);
    await this.handle.questions.answer(body.question, answer, question.answers.length);
  }

  private async questionResolved(event: SpineEvent): Promise<void> {
    const body = event.body as { question: string };
    const question = await this.handle.questions.get(body.question);
    if (!question) this.refuse(event, `question \`${body.question}\` was never raised on this record`);
    await this.handle.questions.resolve(body.question, event.occurred_at, event.acting);
  }
}
