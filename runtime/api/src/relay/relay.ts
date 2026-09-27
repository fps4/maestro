/**
 * The relay, built from configuration: the spine's `relayOnce` over this service's outbox, into the
 * archive and delivery the sink names. `local` is the laptop's spine — a directory and in-process
 * delivery — and `spine-verify` reads that directory with everything off.
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
import { RECORD_TYPES } from '../domain/record-types.js';
import { FsSbomStore, S3SbomStore, type SbomStore } from '../record/sbom-store.js';
import { s3ClientFor } from '../record/s3.js';
import { DynamoOutboxSource } from './source.js';

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

export function archiveFor(config: SinkConfig): ArchiveStore | null {
  if (config.RECORD_SINK === 'local') return new FsArchive(config.RECORD_ARCHIVE_DIR);
  if (!config.ARCHIVE_BUCKET) return null;
  return new S3Archive({ bucket: config.ARCHIVE_BUCKET, prefix: config.ARCHIVE_PREFIX });
}

export function sinkFor(config: SinkConfig): { archive: ArchiveStore; delivery: Delivery } | null {
  if (config.RECORD_SINK === 'off') return null;
  const archive = archiveFor(config)!;
  if (config.RECORD_SINK === 's3') {
    return { archive, delivery: new SnsFifoDelivery({ topicArn: config.EVENTS_TOPIC_ARN! }) };
  }
  return { archive, delivery: new InProcessDelivery() };
}

/** The SBOM store the configuration names — for the service and a rebuild alike. */
export function sbomStoreFor(config: Config): SbomStore {
  if (config.SBOM_STORE === 's3') return new S3SbomStore(config.SBOM_BUCKET!, s3ClientFor(config));
  return new FsSbomStore(config.SBOM_DIR);
}

export function createRelay(store: Store, sink: { archive: ArchiveStore; delivery: Delivery }): Relay {
  const source = new DynamoOutboxSource(store);
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
