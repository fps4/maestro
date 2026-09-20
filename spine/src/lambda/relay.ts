/**
 * A component's relay Lambda, made from its outbox. The component's own module deploys it on a
 * schedule with the spine's bucket and topic in the environment; this factory is the rest.
 *
 *   export const handler = relayHandler({ source: myOutbox, resolve: myRegistry.resolve, types });
 */

import { SNSClient } from '@aws-sdk/client-sns';
import { S3Archive } from '../archive/s3.js';
import { SnsFifoDelivery } from '../delivery/sns.js';
import type { PrincipalResolver, TypeSchemas } from '../domain/event.js';
import type { OutboxSource } from '../relay/port.js';
import { type RelayReport, relayUntilDrained } from '../relay/relay.js';
import { required } from './env.js';
import { NAMESPACE, emit } from './metrics.js';

export interface RelayComponent {
  /** Names the component in metrics and logs: `specs`, `work`, … */
  component: string;
  source: OutboxSource;
  resolve: PrincipalResolver;
  types?: TypeSchemas;
  batch?: number;
  log?: (line: string) => void;
}

export function relayHandler(
  c: RelayComponent,
  env: NodeJS.ProcessEnv = process.env,
): () => Promise<RelayReport> {
  let archive: S3Archive | undefined;
  let delivery: SnsFifoDelivery | undefined;
  return async () => {
    archive ??= new S3Archive({ bucket: required(env, 'ARCHIVE_BUCKET'), prefix: env.ARCHIVE_PREFIX });
    delivery ??= new SnsFifoDelivery({
      topicArn: required(env, 'EVENTS_TOPIC_ARN'),
      client: new SNSClient({}),
    });
    const report = await relayUntilDrained(
      { source: c.source, archive, delivery, resolve: c.resolve, types: c.types },
      c.batch,
    );
    emit(
      NAMESPACE,
      { function: 'relay', component: c.component },
      [
        { name: 'Archived', value: report.archived },
        { name: 'Published', value: report.published },
        { name: 'Refused', value: report.refused.length },
      ],
      { ...report },
      c.log,
    );
    return report;
  };
}
