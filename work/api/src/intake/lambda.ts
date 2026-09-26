/**
 * The intake as an SQS-triggered Lambda: the applications' `ops-signals` topics and the deploy-event
 * rule deliver into one queue, and each record is translated and applied as the intake workload in
 * the deployment's operations workspace (`INTAKE_WORKSPACE`, `INTAKE_PRINCIPAL`).
 *
 * A record the rules refuse — malformed, or not a thing maestro acts on — is logged and dropped: a
 * retry would refuse it again. Anything else fails the record alone (a partial batch response), and
 * SQS retries it until the dead-letter queue takes it.
 */

import { ZodError } from 'zod';
import { loadConfig } from '../config.js';
import { Store } from '../db/client.js';
import { fromQueue } from '../domain/adapters.js';
import { Refusal } from '../domain/decide.js';
import { DefinitionError } from '../domain/definition.js';
import { payloadStoreFor } from '../relay/relay.js';
import { AdapterService, intakeScope } from '../services/adapters.js';
import { WorkItemService } from '../services/work-items.js';
import { WorkspaceRegistry } from '../services/workspaces.js';

interface SqsEvent {
  Records: Array<{ messageId: string; body: string }>;
}

let ready: { store: Store; adapters: AdapterService; workspace: string; principal: string } | undefined;

async function connect() {
  if (ready) return ready;
  const config = loadConfig({ ...process.env, RECORD_SINK: 'off', SWEEP_MODE: 'off' });
  if (!config.INTAKE_WORKSPACE || !config.INTAKE_PRINCIPAL) {
    throw new Error(
      'The intake needs INTAKE_WORKSPACE and INTAKE_PRINCIPAL: where signals land, and who takes them in.',
    );
  }
  const store = await Store.connect(config);
  const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const items = new WorkItemService({
    store,
    payloads: payloadStoreFor(config),
    workspaces: new WorkspaceRegistry(store),
    now,
  });
  ready = {
    store,
    adapters: new AdapterService(items),
    workspace: config.INTAKE_WORKSPACE,
    principal: config.INTAKE_PRINCIPAL,
  };
  return ready;
}

export async function handler(event: SqsEvent) {
  const { store, adapters, workspace, principal } = await connect();
  const scope = await intakeScope(store, workspace, principal);
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const result = await adapters.apply(scope, fromQueue(record.body));
      console.log(JSON.stringify({ msg: 'intake', message: record.messageId, ...result }));
    } catch (error) {
      if (error instanceof Refusal || error instanceof ZodError || error instanceof DefinitionError) {
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
