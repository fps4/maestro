/**
 * Delivery over SNS FIFO. Message group = workspace, so a subscribed FIFO queue receives a
 * workspace's events in `seq` order; deduplication id = `event_id`, so a relay run repeated after a
 * crash publishes nothing twice within SNS's window. The body is the event's canonical line — the
 * same bytes the archive holds — and the attributes let a subscription filter by type without
 * parsing it.
 */

import { PublishBatchCommand, SNSClient, type SNSClientConfig } from '@aws-sdk/client-sns';
import type { SpineEvent } from '../domain/event.js';
import { eventLine } from '../domain/segment.js';
import type { Delivery } from './port.js';

/** SNS accepts at most ten entries per batch. */
export const SNS_BATCH = 10;

export interface SnsFifoDeliveryOptions {
  topicArn: string;
  client?: SnsSender;
  clientConfig?: SNSClientConfig;
}

export type SnsSender = Pick<SNSClient, 'send'>;

export class SnsFifoDelivery implements Delivery {
  readonly topicArn: string;
  private readonly client: SnsSender;

  constructor(options: SnsFifoDeliveryOptions) {
    if (!options.topicArn.endsWith('.fifo')) throw new Error(`${options.topicArn} is not a FIFO topic`);
    this.topicArn = options.topicArn;
    this.client = options.client ?? new SNSClient(options.clientConfig ?? {});
  }

  async publish(events: readonly SpineEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i += SNS_BATCH) {
      const slice = events.slice(i, i + SNS_BATCH);
      const out = await this.client.send(
        new PublishBatchCommand({
          TopicArn: this.topicArn,
          PublishBatchRequestEntries: slice.map((event) => ({
            Id: event.event_id,
            Message: eventLine(event),
            MessageGroupId: event.workspace_id,
            MessageDeduplicationId: event.event_id,
            MessageAttributes: {
              type: { DataType: 'String', StringValue: event.type },
              type_version: { DataType: 'Number', StringValue: String(event.type_version) },
              subject_type: { DataType: 'String', StringValue: event.subject_type },
              workspace_id: { DataType: 'String', StringValue: event.workspace_id },
            },
          })),
        }),
      );
      const failed = out.Failed ?? [];
      if (failed.length > 0) {
        const first = failed[0]!;
        throw new Error(
          `SNS refused ${failed.length} of ${slice.length}: ${first.Id} ${first.Code ?? ''} ${first.Message ?? ''}`.trim(),
        );
      }
    }
  }
}
