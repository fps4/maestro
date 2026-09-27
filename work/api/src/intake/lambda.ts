/**
 * The intake as an SQS-triggered Lambda: the applications' `ops-signals` topics and the deploy-event
 * rule deliver into one queue, runtime-service's level and tier events into a second (FIFO, from
 * the spine's events topic), and each record is translated and applied as the intake workload in
 * the deployment's operations workspace (`INTAKE_WORKSPACE`, `INTAKE_PRINCIPAL`).
 *
 * A record the rules refuse — malformed, or not a thing maestro acts on — is logged and dropped: a
 * retry would refuse it again. Anything else fails the record alone (a partial batch response), and
 * SQS retries it until the dead-letter queue takes it.
 */

import { parseEventLine } from '@fps4/maestro-spine';
import { ZodError } from 'zod';
import { loadConfig } from '../config.js';
import { Store } from '../db/client.js';
import { fromQueue } from '../domain/adapters.js';
import { Refusal } from '../domain/decide.js';
import { DefinitionError } from '../domain/definition.js';
import { payloadStoreFor } from '../relay/relay.js';
import { AdapterService, intakeScope } from '../services/adapters.js';
import { AuthorityService } from '../services/authority.js';
import { WorkItemService } from '../services/work-items.js';
import { WorkspaceRegistry } from '../services/workspaces.js';

interface SqsEvent {
  Records: Array<{ messageId: string; body: string }>;
}

let ready:
  | {
      store: Store;
      adapters: AdapterService;
      authority: AuthorityService;
      workspace: string;
      principal: string;
    }
  | undefined;

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
  const workspaces = new WorkspaceRegistry(store);
  const items = new WorkItemService({ store, payloads: payloadStoreFor(config), workspaces, now });
  ready = {
    store,
    adapters: new AdapterService(items),
    authority: new AuthorityService(store, workspaces, now),
    workspace: config.INTAKE_WORKSPACE,
    principal: config.INTAKE_PRINCIPAL,
  };
  return ready;
}

function isSpineEvent(body: string): boolean {
  try {
    const o = JSON.parse(body) as Record<string, unknown>;
    return typeof o.event_id === 'string' && typeof o.subject_type === 'string';
  } catch {
    return false;
  }
}

export async function handler(event: SqsEvent) {
  const { store, adapters, authority, workspace, principal } = await connect();
  const scope = await intakeScope(store, workspace, principal);
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      // The spine's events topic delivers a component's event as its canonical line (raw delivery):
      // runtime-service's level and tier, projected (ADR-0027 §4). Anything else is an adapter's.
      const result = isSpineEvent(record.body)
        ? await authority.apply(scope, parseEventLine(record.body))
        : await adapters.apply(scope, fromQueue(record.body));
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
