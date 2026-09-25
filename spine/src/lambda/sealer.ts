/**
 * The sealer: a scheduled Lambda, once a day after midnight UTC, over every workspace in the
 * archive. Seals every day before today into a chained segment and sends each segment's digest to
 * the tenant's contact, so the tenant holds evidence maestro cannot revise.
 *
 * A component whose workspaces share their ids with another's relays under its own prefix — the
 * sequence is per workspace and per writer, so two writers of `ws-x` at one prefix would collide at
 * `seq 1`. Each such prefix is a further stream (`SEALED_PREFIXES`, inside `ARCHIVE_PREFIX`), sealed
 * exactly as the root is, and named on its digests.
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
  /** Further writer streams under their own prefixes, each sealed as the root is. */
  streams?: Array<{ prefix: string; archive: ArchiveStore }>;
  /** Where digests go; `null` sends none. */
  digests: { client: SnsSender; topicArn: string } | null;
  today?: () => string;
  now?: () => string;
  log?: (line: string) => void;
}

export interface SealerReport {
  today: string;
  sealed: Array<
    Pick<SegmentManifest, 'workspace_id' | 'period' | 'first_seq' | 'last_seq' | 'segment_digest'> & {
      /** The stream's prefix; absent for the root. */
      stream?: string;
    }
  >;
  notified: number;
}

/** The digest notice: a readable text for a person's inbox, the manifest without its leaves for a queue. */
export function digestNotice(
  m: SegmentManifest,
  stream?: string,
): { subject: string; text: string; json: string } {
  const { leaves: _leaves, ...rest } = m;
  const where = stream ? `${stream.replace(/\/+$/, '')}/${m.workspace_id}` : m.workspace_id;
  const subject = `maestro sealed ${where} ${m.period} ${m.segment_digest.slice(0, 23)}…`;
  const text = [
    `maestro sealed ${where} ${m.period}`,
    `events    ${m.first_seq}–${m.last_seq} (${m.event_count})`,
    `root      ${m.merkle_root}`,
    `previous  ${m.prev_segment_digest ?? '(first segment)'}`,
    `digest    ${m.segment_digest}`,
    `sealed    ${m.sealed_at} by sealer v${m.sealer_version}`,
    '',
    'Keep this. The digest is what a verifier compares against; maestro cannot change it after the fact.',
  ].join('\n');
  return { subject, text, json: JSON.stringify(stream ? { ...rest, stream } : rest) };
}

export async function runSealer(deps: SealerDeps): Promise<SealerReport> {
  const today = (deps.today ?? utcDay)();
  const sealedAt = deps.now?.();
  const manifests: Array<{ m: SegmentManifest; stream?: string }> = (
    await sealBefore(deps.archive, today, sealedAt)
  ).map((m) => ({ m }));
  for (const { prefix, archive } of deps.streams ?? []) {
    for (const m of await sealBefore(archive, today, sealedAt)) manifests.push({ m, stream: prefix });
  }
  let notified = 0;
  if (deps.digests) {
    for (const { m, stream } of manifests) {
      const notice = digestNotice(m, stream);
      await deps.digests.client.send(
        new PublishCommand({
          TopicArn: deps.digests.topicArn,
          Subject: notice.subject.slice(0, 100),
          MessageStructure: 'json',
          Message: JSON.stringify({ default: notice.json, email: notice.text }),
          MessageAttributes: {
            workspace_id: { DataType: 'String', StringValue: m.workspace_id },
            period: { DataType: 'String', StringValue: m.period },
            ...(stream ? { stream: { DataType: 'String', StringValue: stream } } : {}),
          },
        }),
      );
      notified += 1;
    }
  }
  const report: SealerReport = {
    today,
    sealed: manifests.map(({ m: { workspace_id, period, first_seq, last_seq, segment_digest }, stream }) => ({
      workspace_id,
      period,
      first_seq,
      last_seq,
      segment_digest,
      ...(stream ? { stream } : {}),
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

/** `SEALED_PREFIXES` — comma-separated, each inside `ARCHIVE_PREFIX` — as further streams. */
export function streamsFrom(env: NodeJS.ProcessEnv): Array<{ prefix: string; archive: S3Archive }> {
  const bucket = required(env, 'ARCHIVE_BUCKET');
  const root = env.ARCHIVE_PREFIX ? env.ARCHIVE_PREFIX.replace(/\/+$/, '') + '/' : '';
  return (env.SEALED_PREFIXES ?? '')
    .split(',')
    .map((p) => p.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .map((p) => {
      if (p.startsWith('ws-'))
        throw new Error(
          `SEALED_PREFIXES: \`${p}\` reads as a workspace; a stream's prefix does not start with ws-`,
        );
      return { prefix: `${p}/`, archive: new S3Archive({ bucket, prefix: `${root}${p}` }) };
    });
}

function fromEnv(env: NodeJS.ProcessEnv = process.env): SealerDeps {
  const archive = new S3Archive({ bucket: required(env, 'ARCHIVE_BUCKET'), prefix: env.ARCHIVE_PREFIX });
  const streams = streamsFrom(env);
  const topicArn = env.DIGEST_TOPIC_ARN;
  return { archive, streams, digests: topicArn ? { client: new SNSClient({}), topicArn } : null };
}

/** The Lambda entry point. The schedule's payload is ignored. */
export async function handler(): Promise<SealerReport> {
  deps ??= fromEnv();
  return runSealer(deps);
}
