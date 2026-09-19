/**
 * Delivery: the queue side of the spine. Transport, not record — at-least-once, ordered per
 * workspace (SNS FIFO with message group = workspace, on AWS). A consumer that needs history reads
 * the archive, never this.
 */

import type { SpineEvent } from '../domain/event.js';

export interface Delivery {
  /** Events of one workspace, in `seq` order. */
  publish(events: readonly SpineEvent[]): Promise<void>;
}

/** The in-process default: hands events to subscribers directly. What a test's "consumer queue" is. */
export class InProcessDelivery implements Delivery {
  private readonly subscribers: Array<(events: readonly SpineEvent[]) => Promise<void> | void> = [];
  readonly published: SpineEvent[] = [];

  subscribe(handler: (events: readonly SpineEvent[]) => Promise<void> | void): void {
    this.subscribers.push(handler);
  }

  async publish(events: readonly SpineEvent[]): Promise<void> {
    this.published.push(...events);
    for (const handler of this.subscribers) await handler(events);
  }
}
