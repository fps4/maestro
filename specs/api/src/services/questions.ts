/**
 * Questions on a version.
 *
 * The one thing "not a wiki" wrongly excluded. A reviewer who cannot ask "what does this line mean?"
 * asks it on Slack, and the trail loses it. So a question is admitted — narrowly. It attaches to an
 * **immutable version**, never to a draft (a draft has an editor; a question on a draft is a
 * comment, and comments are what this service refuses). It never mutates the version: the digest is
 * untouched, the decision still cites the same bytes. And it is closed by a **human**, which is the
 * same line ADR-0005 draws for confirming an extraction — an agent may ask and may answer, and it
 * is the agent answering that makes a non-technical reviewer's question cheap to ask, but the loop
 * is closed by the person who needed the answer.
 *
 * Every state change is an event on the record sink, carrying the question's id and a digest of
 * the text — never the text. A question routinely names a person; the payload stays here under the
 * workspace's own retention, and the spine learns that a question was asked, answered and closed.
 */

import { QUESTIONS, VERSIONS } from '../db/collections.js';
import { firstSeat, type Recorder } from '../db/outbox.js';
import type { WorkspaceHandle } from '../db/handle.js';
import { digestOf } from '../domain/digest.js';
import { mintQuestionId } from '../domain/ids.js';
import type { Answer, Question, Version } from '../domain/types.js';
import { versionPayloadKey, writePayload, type PayloadStore } from '../record/payload-store.js';
import { NotFound, Refused, type Actor } from './artifacts.js';

/** What `QuestionRaised` and `QuestionAnswered` carry as their payload (ADR-0020 §2). */
export interface TextPayload {
  text: string;
}

export class QuestionService {
  constructor(
    private readonly handle: WorkspaceHandle,
    private readonly recorder?: Recorder,
    private readonly payloads?: PayloadStore,
  ) {}

  private record(): Recorder {
    if (!this.recorder) throw new Error('This service was built without a recorder and cannot write.');
    return this.recorder;
  }

  /** The text goes to the payload store before the transaction that names it (ADR-0020 §2). */
  private async payload(subject: { artifact: string; ordinal: number }, what: string, text: string) {
    if (!this.payloads) throw new Error('This service was built without a payload store and cannot write.');
    const payload: TextPayload = { text };
    return writePayload(this.payloads, versionPayloadKey(this.handle.workspace, subject, what), payload);
  }

  /**
   * Asking and answering are anyone's acts: the seat is the first the actor holds. Resolving is
   * a human's, in `reviewer` — the person who needed the answer closes the loop (ADR-0014).
   */
  private seatOf(actor: Actor) {
    return firstSeat(actor, ['reviewer', 'author', 'workspace_admin', 'auditor'] as const);
  }

  private questions() {
    return this.handle.collection<Question>(QUESTIONS);
  }

  private async versionOrThrow(artifact: string, ordinal: number): Promise<Version> {
    const version = await this.handle
      .collection<Version>(VERSIONS)
      .findOne({ artifact, ordinal }, { projection: { _id: 0, body: 0 } });
    if (!version) throw new NotFound(`Version \`${artifact}@${ordinal}\``);
    return version;
  }

  async list(artifact: string, ordinal: number): Promise<Question[]> {
    return this.questions()
      .find({ artifact, ordinal }, { projection: { _id: 0 } })
      .sort({ asked_at: 1 })
      .toArray();
  }

  /** Open questions on a version — the number a gate may block on. */
  async openCount(artifact: string, ordinal: number): Promise<number> {
    return this.questions().countDocuments({ artifact, ordinal, resolved_at: { $exists: false } });
  }

  async get(id: string): Promise<Question> {
    const question = await this.questions().findOne({ id }, { projection: { _id: 0 } });
    if (!question) throw new NotFound(`Question \`${id}\``);
    return question;
  }

  async ask(artifact: string, ordinal: number, text: string, actor: Actor): Promise<Question> {
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Refused('A question needs some text.');
    const version = await this.versionOrThrow(artifact, ordinal);

    const now = new Date().toISOString();
    const question: Question = {
      id: mintQuestionId(),
      workspace: this.handle.workspace,
      artifact,
      ordinal,
      text: trimmed,
      asked_by: actor.principal,
      asked_kind: actor.kind,
      asked_at: now,
      answers: [],
    };
    const payload = await this.payload({ artifact, ordinal }, `question/${question.id}.json`, trimmed);

    await this.handle.transaction(async (session) => {
      await this.questions().insertOne(question, { session });
      await this.record().emit(session, [
        {
          type: 'QuestionRaised',
          subject: { artifact, ordinal },
          artifact_type: version.type,
          seat: this.seatOf(actor),
          body: { question: question.id, text_digest: digestOf(trimmed), asked_kind: actor.kind },
          occurred_at: now,
          payload,
        },
      ]);
    });
    return question;
  }

  /**
   * Answer a question. Anyone may — including an agent, whose answer is marked as an agent's so the
   * reader knows what they are reading. Answering does not resolve: the person who asked decides
   * whether they were answered.
   */
  async answer(id: string, text: string, actor: Actor): Promise<Question> {
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Refused('An answer needs some text.');
    const question = await this.get(id);
    if (question.resolved_at) {
      throw new Refused('This question is closed. Ask a new one if something is still unclear.');
    }
    const version = await this.versionOrThrow(question.artifact, question.ordinal);

    const now = new Date().toISOString();
    const answer: Answer = {
      id: `${question.id}-a${question.answers.length + 1}`,
      text: trimmed,
      by: actor.principal,
      kind: actor.kind,
      at: now,
    };
    const payload = await this.payload(question, `answer/${answer.id}.json`, trimmed);

    return this.handle.transaction(async (session) => {
      const updated = await this.questions().findOneAndUpdate(
        { id, resolved_at: { $exists: false } },
        { $push: { answers: answer } },
        { session, returnDocument: 'after', projection: { _id: 0 } },
      );
      if (!updated) throw new Refused('This question was closed while you were answering.');
      await this.record().emit(session, [
        {
          type: 'QuestionAnswered',
          subject: { artifact: question.artifact, ordinal: question.ordinal },
          artifact_type: version.type,
          seat: this.seatOf(actor),
          body: { question: id, answer: answer.id, text_digest: digestOf(trimmed), kind: actor.kind },
          occurred_at: now,
          payload,
        },
      ]);
      return updated;
    });
  }

  /** Close a question. A human's act, always — the same line as confirming an extraction. */
  async resolve(id: string, actor: Actor): Promise<Question> {
    if (actor.kind !== 'human') {
      throw new Refused(
        'Only a human closes a question. An agent closing the question it answered would make the answer decorative.',
      );
    }
    const question = await this.get(id);
    if (question.resolved_at) return question;
    const version = await this.versionOrThrow(question.artifact, question.ordinal);

    const now = new Date().toISOString();
    return this.handle.transaction(async (session) => {
      const updated = await this.questions().findOneAndUpdate(
        { id, resolved_at: { $exists: false } },
        { $set: { resolved_at: now, resolved_by: actor.principal } },
        { session, returnDocument: 'after', projection: { _id: 0 } },
      );
      if (!updated) return question;
      await this.record().emit(session, [
        {
          type: 'QuestionResolved',
          subject: { artifact: question.artifact, ordinal: question.ordinal },
          artifact_type: version.type,
          seat: this.seatOf(actor),
          body: { question: id, answers: question.answers.length },
          occurred_at: now,
        },
      ]);
      return updated;
    });
  }
}
