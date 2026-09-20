export { canonicalize } from './domain/canonical.js';
export { sha256, digestOf, isDigest, DIGEST, type Digest } from './domain/digest.js';
export {
  uuidv7,
  isPrincipalId,
  claimedKind,
  PRINCIPAL_ID,
  WORKSPACE_ID,
  UUID_V7,
  type PrincipalKind,
} from './domain/ids.js';
export {
  eventSchema,
  checkEvent,
  assertEvent,
  typeKey,
  AppendRefused,
  OVERSIGHT_LEVELS,
  type SpineEvent,
  type EmittableEvent,
  type AppendIssue,
  type PrincipalResolver,
  type TypeSchemas,
  type OversightLevel,
} from './domain/event.js';
export { leafHash, merkleRoot } from './domain/merkle.js';
export {
  seal,
  eventLine,
  parseEventLine,
  segmentDigest,
  manifestSchema,
  SealRefused,
  SEALER_VERSION,
  DAY,
  type SegmentManifest,
} from './domain/segment.js';
export { verify, type Verdict, type SegmentInput } from './domain/verify.js';

export { type ArchiveStore, type ArchiveHead, partName, partSeq } from './archive/port.js';
export { MemoryArchive } from './archive/memory.js';
export { FsArchive } from './archive/fs.js';
export { S3Archive, type S3ArchiveOptions, type S3Sender } from './archive/s3.js';
export {
  append,
  readDay,
  sealDay,
  sealBefore,
  previousManifest,
  verifyRange,
  ArchiveRefused,
  type AppendReport,
} from './archive/writer.js';

export { type Delivery, InProcessDelivery } from './delivery/port.js';
export { SnsFifoDelivery, type SnsFifoDeliveryOptions, type SnsSender, SNS_BATCH } from './delivery/sns.js';

export { type OutboxSource } from './relay/port.js';
export { MemoryOutbox } from './relay/memory.js';
export { relayOnce, relayUntilDrained, utcDay, type RelayDeps, type RelayReport } from './relay/relay.js';

export { runSealer, digestNotice, type SealerDeps, type SealerReport } from './lambda/sealer.js';
export { relayHandler, type RelayComponent } from './lambda/relay.js';
