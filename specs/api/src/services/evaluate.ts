/**
 * The evaluator port.
 *
 * A gate declares the evaluations it requires; this is what produces them. Two adapters, chosen per
 * evaluator by the definition (ADR-0015):
 *
 * - **builtin** — the service computes the verdict itself from the type's facet schema. The local
 *   default, and the reason a gate can open on a deployment with nothing behind the port.
 * - **endpoint** — an HTTP callout with the version's facets and digest; the evaluator answers with
 *   a verdict and findings, and the service records them. `${VAR}` in the endpoint resolves from the
 *   environment at call time, so a committed definition names the port and a deployment names the
 *   host.
 *
 * Either way the service **records** a verdict against a digest. An evaluator that is unreachable,
 * unresolved, or slow records nothing — the gate then says "no verdict has been recorded", which is
 * the truth, and `run` reports why so the reader is not left guessing.
 *
 * A verdict is on the record (ADR-0020 §3): a gate opens or stays shut on it, so `record` emits
 * `EvaluationRecorded` in the transaction with its upsert, under the seat of whoever ran it — an
 * agent through MCP, a person through the console, the proposer at propose — with the findings as
 * the payload.
 */

import { firstSeat, type Actor, type Recorder } from '../db/outbox.js';
import type { WorkspaceHandle } from '../db/handle.js';
import { facetSchemaEvaluation } from '../domain/builtin-evaluators.js';
import type { EvaluationResult, Version } from '../domain/types.js';
import { evaluatorIn, gatesDecidingOn, type EvaluatorDeclaration } from '../domain/workspace-definition.js';
import {
  PAYLOAD_CONTENT_TYPE,
  encodePayload,
  versionPayloadKey,
  type PayloadStore,
} from '../record/payload-store.js';
import { NotFound, Refused } from './artifacts.js';
import type { LoadedWorkspace } from './workspaces.js';

export interface EvaluationRun {
  evaluator: string;
  status: 'recorded' | 'unavailable';
  verdict?: EvaluationResult['verdict'];
  reason?: string;
}

/** The wire shape an endpoint evaluator answers with. Anything else is recorded as unavailable. */
interface EndpointReply {
  verdict: EvaluationResult['verdict'];
  findings?: EvaluationResult['findings'];
}

/** What `EvaluationRecorded` carries as its payload (ADR-0020 §2). */
export interface EvaluationPayload {
  findings?: EvaluationResult['findings'];
}

/** What recording needs beyond the handle: the record, and where the findings go first. */
export interface EvaluationWriter {
  recorder: Recorder;
  payloads: PayloadStore;
}

export class EvaluationService {
  constructor(
    private readonly handle: WorkspaceHandle,
    private readonly workspace: LoadedWorkspace,
    private readonly writer?: EvaluationWriter,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private write(): EvaluationWriter {
    if (!this.writer) throw new Error('This service was built without a recorder and cannot write.');
    return this.writer;
  }

  /**
   * Record a verdict against exactly one version's digest. The one write path, shared with the API.
   *
   * The upsert and the event are one transaction. The findings are written to the payload store
   * first, under a content-addressed key — a re-run with the same findings overwrites the same
   * bytes, and one with different findings never overwrites what an earlier event names.
   */
  async record(input: Omit<EvaluationResult, 'recorded_at'>, actor: Actor): Promise<EvaluationResult> {
    const version = await this.handle.versions.get(input.artifact, input.ordinal);
    if (!version) throw new NotFound(`Version \`${input.artifact}@${input.ordinal}\``);
    // A verdict against bytes we do not hold is not a verdict about anything here.
    if (version.digest !== input.subject_digest) {
      throw new Refused(
        `This verdict names digest ${input.subject_digest}, and ${input.artifact}@${input.ordinal} is ${version.digest}. ` +
          'A verdict reached against different bytes is not a verdict about this version.',
      );
    }

    const { recorder, payloads } = this.write();
    const seat = firstSeat(actor, ['reviewer', 'author'] as const);
    const payload: EvaluationPayload = { ...(input.findings ? { findings: input.findings } : {}) };
    const { bytes, digest } = encodePayload(payload);
    const ref = await payloads.put(
      versionPayloadKey(
        this.handle.workspace,
        input,
        `evaluation/${input.evaluator}/${digest.slice('sha256:'.length)}.json`,
      ),
      bytes,
      PAYLOAD_CONTENT_TYPE,
    );

    const now = new Date().toISOString();
    const record: EvaluationResult = { ...input, recorded_at: now };
    return this.handle.transaction(async (tx) => {
      await this.handle.evaluations.put(record, tx);
      await recorder.emit(tx, [
        {
          type: 'EvaluationRecorded',
          subject: { artifact: input.artifact, ordinal: input.ordinal },
          artifact_type: version.type,
          seat,
          body: {
            evaluator: input.evaluator,
            verdict: input.verdict,
            subject_digest: input.subject_digest,
            findings: input.findings?.length ?? 0,
          },
          occurred_at: now,
          payload: ref,
        },
      ]);
      return record;
    });
  }

  /** Every evaluator any gate on this type requires, run once each against this version. */
  async run(version: Version, actor: Actor): Promise<EvaluationRun[]> {
    const def = this.workspace.definition;
    const required = new Set(gatesDecidingOn(def, version.type).flatMap((g) => g.requires.evaluations));
    const runs: EvaluationRun[] = [];
    for (const id of required) {
      const declared = evaluatorIn(def, id);
      if (!declared) {
        runs.push({ evaluator: id, status: 'unavailable', reason: 'not declared in this workspace' });
        continue;
      }
      runs.push(await this.runOne(declared, version, actor));
    }
    return runs;
  }

  private async runOne(
    evaluator: EvaluatorDeclaration,
    version: Version,
    actor: Actor,
  ): Promise<EvaluationRun> {
    if (evaluator.builtin === 'facet_schema') {
      const schema = (this.workspace.facet_schemas[version.type] ?? {}) as Parameters<
        typeof facetSchemaEvaluation
      >[0];
      const issues = this.workspace.validator.check(version.type, version.facets);
      const { verdict, findings } = facetSchemaEvaluation(schema, version.facets, issues);
      await this.record(
        {
          evaluator: evaluator.id,
          artifact: version.artifact,
          ordinal: version.ordinal,
          verdict,
          findings,
          subject_digest: version.digest,
        },
        actor,
      );
      return { evaluator: evaluator.id, status: 'recorded', verdict };
    }

    const endpoint = resolveEndpoint(evaluator.endpoint!, this.env);
    if (!endpoint.resolved) {
      return {
        evaluator: evaluator.id,
        status: 'unavailable',
        reason: `endpoint names \`${endpoint.missing}\`, which this deployment does not set`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), evaluator.timeout_ms);
    try {
      const response = await this.fetchImpl(endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          workspace: this.handle.workspace,
          artifact: version.artifact,
          ordinal: version.ordinal,
          type: version.type,
          subject_digest: version.digest,
          facets: version.facets,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          evaluator: evaluator.id,
          status: 'unavailable',
          reason: `evaluator answered ${response.status}`,
        };
      }
      const reply = (await response.json()) as Partial<EndpointReply>;
      if (reply.verdict !== 'pass' && reply.verdict !== 'fail' && reply.verdict !== 'not_applicable') {
        return {
          evaluator: evaluator.id,
          status: 'unavailable',
          reason: 'evaluator answered without a verdict',
        };
      }
      await this.record(
        {
          evaluator: evaluator.id,
          artifact: version.artifact,
          ordinal: version.ordinal,
          verdict: reply.verdict,
          ...(reply.findings ? { findings: reply.findings } : {}),
          subject_digest: version.digest,
        },
        actor,
      );
      return { evaluator: evaluator.id, status: 'recorded', verdict: reply.verdict };
    } catch (error) {
      const reason =
        (error as Error).name === 'AbortError'
          ? `no answer within ${evaluator.timeout_ms}ms`
          : `could not be reached: ${(error as Error).message}`;
      return { evaluator: evaluator.id, status: 'unavailable', reason };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** `${EVALUATOR_BASE}/sufficiency` → the url, or the first variable the environment does not set. */
export function resolveEndpoint(
  template: string,
  env: NodeJS.ProcessEnv,
): { resolved: true; url: string } | { resolved: false; missing: string } {
  let missing: string | undefined;
  const url = template.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
    const value = env[name];
    if (!value) {
      missing ??= name;
      return '';
    }
    return value;
  });
  return missing ? { resolved: false, missing } : { resolved: true, url };
}
