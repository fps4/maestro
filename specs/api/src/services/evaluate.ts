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
 */

import { EVALUATIONS } from '../db/collections.js';
import type { WorkspaceHandle } from '../db/handle.js';
import { facetSchemaEvaluation } from '../domain/builtin-evaluators.js';
import type { EvaluationResult, Version } from '../domain/types.js';
import { evaluatorIn, gatesDecidingOn, type EvaluatorDeclaration } from '../domain/workspace-definition.js';
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

export class EvaluationService {
  constructor(
    private readonly handle: WorkspaceHandle,
    private readonly workspace: LoadedWorkspace,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Record a verdict against exactly one version's digest. The one write path, shared with the API. */
  async record(input: Omit<EvaluationResult, 'recorded_at'>): Promise<EvaluationResult> {
    const record: EvaluationResult = { ...input, recorded_at: new Date().toISOString() };
    await this.handle
      .collection<EvaluationResult>(EVALUATIONS)
      .replaceOne({ artifact: input.artifact, ordinal: input.ordinal, evaluator: input.evaluator }, record, {
        upsert: true,
      });
    return record;
  }

  /** Every evaluator any gate on this type requires, run once each against this version. */
  async run(version: Version): Promise<EvaluationRun[]> {
    const def = this.workspace.definition;
    const required = new Set(gatesDecidingOn(def, version.type).flatMap((g) => g.requires.evaluations));
    const runs: EvaluationRun[] = [];
    for (const id of required) {
      const declared = evaluatorIn(def, id);
      if (!declared) {
        runs.push({ evaluator: id, status: 'unavailable', reason: 'not declared in this workspace' });
        continue;
      }
      runs.push(await this.runOne(declared, version));
    }
    return runs;
  }

  private async runOne(evaluator: EvaluatorDeclaration, version: Version): Promise<EvaluationRun> {
    if (evaluator.builtin === 'facet_schema') {
      const schema = (this.workspace.facet_schemas[version.type] ?? {}) as Parameters<
        typeof facetSchemaEvaluation
      >[0];
      const issues = this.workspace.validator.check(version.type, version.facets);
      const { verdict, findings } = facetSchemaEvaluation(schema, version.facets, issues);
      await this.record({
        evaluator: evaluator.id,
        artifact: version.artifact,
        ordinal: version.ordinal,
        verdict,
        findings,
        subject_digest: version.digest,
      });
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
      await this.record({
        evaluator: evaluator.id,
        artifact: version.artifact,
        ordinal: version.ordinal,
        verdict: reply.verdict,
        ...(reply.findings ? { findings: reply.findings } : {}),
        subject_digest: version.digest,
      });
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
