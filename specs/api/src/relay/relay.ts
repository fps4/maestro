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
import { FsPayloadStore, S3PayloadStore, type PayloadStore } from '../record/payload-store.js';
import { s3ClientFor } from '../services/attachments.js';
import type { PrincipalDirectory } from '../services/principals.js';
import { MongoOutboxSource } from './source.js';

export interface Relay {
  once(): Promise<RelayReport>;
  drain(): Promise<RelayReport>;
  readonly archive: ArchiveStore;
  readonly delivery: Delivery;
}

type SinkConfig = Pick<
  Config,
  'RECORD_SINK' | 'RECORD_ARCHIVE_DIR' | 'ARCHIVE_BUCKET' | 'ARCHIVE_PREFIX' | 'EVENTS_TOPIC_ARN'
>;

/**
 * The archive the configuration names — for the relay to write and the rebuilder to read. Under
 * `off` the relay is a Lambda elsewhere, but the archive is still maestro's when the bucket is
 * named; a rebuild reads it from here.
 */
export function archiveFor(config: SinkConfig): ArchiveStore | null {
  if (config.RECORD_SINK === 'local') return new FsArchive(config.RECORD_ARCHIVE_DIR);
  if (!config.ARCHIVE_BUCKET) return null;
  return new S3Archive({ bucket: config.ARCHIVE_BUCKET, prefix: config.ARCHIVE_PREFIX });
}

export function sinkFor(config: SinkConfig): {
  archive: ArchiveStore;
  delivery: Delivery;
} | null {
  if (config.RECORD_SINK === 'off') return null;
  const archive = archiveFor(config)!;
  if (config.RECORD_SINK === 's3') {
    return { archive, delivery: new SnsFifoDelivery({ topicArn: config.EVENTS_TOPIC_ARN! }) };
  }
  return { archive, delivery: new InProcessDelivery() };
}

/**
 * The payload store the sink's configuration names (ADR-0020 §1) — the one place that chooses it,
 * for the running service and for the rebuilder alike, so a rebuild reads exactly where the
 * service wrote.
 */
export function payloadStoreFor(config: Config): PayloadStore {
  if (config.PAYLOAD_STORE === 's3') {
    // `loadConfig` refused an s3 store without a bucket; the client is the attachments' own.
    return new S3PayloadStore({
      bucket: config.PAYLOAD_BUCKET!,
      prefix: config.PAYLOAD_PREFIX,
      client: s3ClientFor(config),
    });
  }
  return new FsPayloadStore(config.RECORD_PAYLOAD_DIR);
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
