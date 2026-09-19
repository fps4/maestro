/**
 * The outbox side of the relay. A component exposes its outbox through this port; the relay never
 * sees its database. Sequence is the component's — assigned in its outbox, per workspace, inside
 * the transaction that made the change — and the relay carries it, never assigns it.
 */

import type { SpineEvent } from '../domain/event.js';

export interface OutboxSource {
  /** Undelivered events, oldest first, at most `limit`. May span workspaces. */
  pending(limit: number): Promise<SpineEvent[]>;
  /** Mark delivered. Called only after the archive holds them and delivery accepted them. */
  ack(events: readonly SpineEvent[]): Promise<void>;
}
