/**
 * The relay, built from configuration: the spine's `relayOnce` over this service's outbox, into
 * the archive and delivery the sink names. `local` is the laptop's spine — a directory and an
 * in-process delivery — and the verifier reads that directory with everything off.
 */

import {
  FsArchive,
  InProcessDelivery,
  S3Archive,
  SnsFifoDelivery,
  relayOnce,
  relayUntilDrained,
  type ArchiveStore,
  type Delivery,
  type RelayReport,
} from '@fps4/maestro-spine';
import type { Config } from '../config.js';
import type { Store } from '../db/client.js';
import { RECORD_TYPES } from '../db/record-types.js';
import type { PrincipalDirectory } from '../services/principals.js';
import { MongoOutboxSource } from './source.js';

export interface Relay {
  once(): Promise<RelayReport>;
  drain(): Promise<RelayReport>;
  readonly archive: ArchiveStore;
  readonly delivery: Delivery;
}

export function sinkFor(
  config: Pick<
    Config,
    'RECORD_SINK' | 'RECORD_ARCHIVE_DIR' | 'ARCHIVE_BUCKET' | 'ARCHIVE_PREFIX' | 'EVENTS_TOPIC_ARN'
  >,
): {
  archive: ArchiveStore;
  delivery: Delivery;
} | null {
  if (config.RECORD_SINK === 'off') return null;
  if (config.RECORD_SINK === 's3') {
    return {
      archive: new S3Archive({ bucket: config.ARCHIVE_BUCKET!, prefix: config.ARCHIVE_PREFIX }),
      delivery: new SnsFifoDelivery({ topicArn: config.EVENTS_TOPIC_ARN! }),
    };
  }
  return { archive: new FsArchive(config.RECORD_ARCHIVE_DIR), delivery: new InProcessDelivery() };
}

export function createRelay(
  store: Store,
  directory: PrincipalDirectory,
  sink: { archive: ArchiveStore; delivery: Delivery },
): Relay {
  const source = new MongoOutboxSource(store, directory);
  const deps = {
    source,
    archive: sink.archive,
    delivery: sink.delivery,
    resolve: source.resolve,
    types: RECORD_TYPES,
  };
  return {
    archive: sink.archive,
    delivery: sink.delivery,
    once: () => relayOnce(deps),
    drain: () => relayUntilDrained(deps),
  };
}
