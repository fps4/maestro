/**
 * The intake as an SQS-triggered Lambda (maestro ADR-0027 §3): a rule on the default bus delivers
 * `maestro.build` and `maestro.deploy` into this service's own queue, beside work-service's, and
 * each record is taken in as the intake workload in the deployment's workspace (`INTAKE_WORKSPACE`,
 * `INTAKE_PRINCIPAL`).
 *
 * A record the rules refuse — malformed, or naming a foreign SBOM — is logged and dropped: a retry
 * would refuse it again. Anything else fails the record alone (a partial batch response), and SQS
 * retries it until the dead-letter queue takes it.
 */

import { ZodError } from 'zod';
import { loadConfig } from '../config.js';
import { Store } from '../db/client.js';
import { Refusal } from '../domain/decide.js';
import { DefinitionError } from '../domain/definition.js';
import { fromQueue } from '../domain/intake.js';
import { SbomRefused } from '../record/sbom-store.js';
import { sbomStoreFor } from '../relay/relay.js';
import { intakeScope, RuntimeService } from '../services/runtime.js';
import { WorkspaceRegistry } from '../services/workspaces.js';
import { signalSinkFor } from '../signals/from-config.js';

interface SqsEvent {
  Records: Array<{ messageId: string; body: string }>;
}

let ready: { store: Store; runtime: RuntimeService; workspace: string; principal: string } | undefined;

async function connect() {
  if (ready) return ready;
  const config = loadConfig({ ...process.env, RECORD_SINK: 'off' });
  if (!config.INTAKE_WORKSPACE || !config.INTAKE_PRINCIPAL) {
    throw new Error(
      'The intake needs INTAKE_WORKSPACE and INTAKE_PRINCIPAL: where builds and deploys land, and who takes them in.',
    );
  }
  const store = await Store.connect(config);
  const runtime = new RuntimeService({
    store,
    sboms: sbomStoreFor(config),
    signals: signalSinkFor(config),
    workspaces: new WorkspaceRegistry(store),
    now: () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
  ready = { store, runtime, workspace: config.INTAKE_WORKSPACE, principal: config.INTAKE_PRINCIPAL };
  return ready;
}

export async function handler(event: SqsEvent) {
  const { store, runtime, workspace, principal } = await connect();
  const scope = await intakeScope(store, workspace, principal);
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const result = await runtime.intake(scope, fromQueue(record.body));
      console.log(JSON.stringify({ msg: 'intake', message: record.messageId, ...result }));
    } catch (error) {
      if (
        error instanceof Refusal ||
        error instanceof ZodError ||
        error instanceof DefinitionError ||
        error instanceof SbomRefused
      ) {
        console.log(
          JSON.stringify({
            msg: 'intake refused',
            message: record.messageId,
            reason: (error as Error).message,
          }),
        );
        continue;
      }
      console.error(
        JSON.stringify({ msg: 'intake failed', message: record.messageId, err: (error as Error).message }),
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
