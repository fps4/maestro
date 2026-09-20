/**
 * The sealer: a scheduled Lambda, once a day after midnight UTC, over every workspace in the
 * archive. Seals every day before today into a chained segment and sends each segment's digest to
 * the tenant's contact, so the tenant holds evidence maestro cannot revise.
 */

import { PublishCommand } from '@aws-sdk/client-sns';
import { SNSClient } from '@aws-sdk/client-sns';
import { S3Archive } from '../archive/s3.js';
import type { ArchiveStore } from '../archive/port.js';
import { sealBefore } from '../archive/writer.js';
import type { SegmentManifest } from '../domain/segment.js';
import type { SnsSender } from '../delivery/sns.js';
import { utcDay } from '../relay/relay.js';
import { required } from './env.js';
import { NAMESPACE, emit } from './metrics.js';

export interface SealerDeps {
  archive: ArchiveStore;
  /** Where digests go; `null` sends none. */
  digests: { client: SnsSender; topicArn: string } | null;
  today?: () => string;
  now?: () => string;
  log?: (line: string) => void;
}

export interface SealerReport {
  today: string;
  sealed: Array<
    Pick<SegmentManifest, 'workspace_id' | 'period' | 'first_seq' | 'last_seq' | 'segment_digest'>
  >;
  notified: number;
}

/** The digest notice: a readable text for a person's inbox, the manifest without its leaves for a queue. */
export function digestNotice(m: SegmentManifest): { subject: string; text: string; json: string } {
  const { leaves: _leaves, ...rest } = m;
  const subject = `maestro sealed ${m.workspace_id} ${m.period} ${m.segment_digest.slice(0, 23)}…`;
  const text = [
    `maestro sealed ${m.workspace_id} ${m.period}`,
    `events    ${m.first_seq}–${m.last_seq} (${m.event_count})`,
    `root      ${m.merkle_root}`,
    `previous  ${m.prev_segment_digest ?? '(first segment)'}`,
    `digest    ${m.segment_digest}`,
    `sealed    ${m.sealed_at} by sealer v${m.sealer_version}`,
    '',
    'Keep this. The digest is what a verifier compares against; maestro cannot change it after the fact.',
  ].join('\n');
  return { subject, text, json: JSON.stringify(rest) };
}

export async function runSealer(deps: SealerDeps): Promise<SealerReport> {
  const today = (deps.today ?? utcDay)();
  const sealedAt = deps.now?.();
  const manifests = await sealBefore(deps.archive, today, sealedAt);
  let notified = 0;
  if (deps.digests) {
    for (const m of manifests) {
      const notice = digestNotice(m);
      await deps.digests.client.send(
        new PublishCommand({
          TopicArn: deps.digests.topicArn,
          Subject: notice.subject.slice(0, 100),
          MessageStructure: 'json',
          Message: JSON.stringify({ default: notice.json, email: notice.text }),
          MessageAttributes: {
            workspace_id: { DataType: 'String', StringValue: m.workspace_id },
            period: { DataType: 'String', StringValue: m.period },
          },
        }),
      );
      notified += 1;
    }
  }
  const report: SealerReport = {
    today,
    sealed: manifests.map(({ workspace_id, period, first_seq, last_seq, segment_digest }) => ({
      workspace_id,
      period,
      first_seq,
      last_seq,
      segment_digest,
    })),
    notified,
  };
  emit(
    NAMESPACE,
    { function: 'sealer' },
    [
      { name: 'Sealed', value: manifests.length },
      { name: 'Notified', value: notified },
    ],
    { ...report },
    deps.log,
  );
  return report;
}

let deps: SealerDeps | undefined;

function fromEnv(env: NodeJS.ProcessEnv = process.env): SealerDeps {
  const archive = new S3Archive({ bucket: required(env, 'ARCHIVE_BUCKET'), prefix: env.ARCHIVE_PREFIX });
  const topicArn = env.DIGEST_TOPIC_ARN;
  return { archive, digests: topicArn ? { client: new SNSClient({}), topicArn } : null };
}

/** The Lambda entry point. The schedule's payload is ignored. */
export async function handler(): Promise<SealerReport> {
  deps ??= fromEnv();
  return runSealer(deps);
}
