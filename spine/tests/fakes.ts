/**
 * Fakes for the AWS clients: enough of S3 and SNS to exercise the adapters' logic — conditional
 * writes, listing with delimiter and continuation, FIFO grouping and batch limits. A test that
 * passes here is about the adapter, not about AWS; `s3.live.test.ts` runs the same contract
 * against a real bucket when one is named.
 */

import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { PublishBatchCommand, PublishCommand } from '@aws-sdk/client-sns';

function awsError(name: string, status: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

export class FakeS3 {
  readonly objects = new Map<string, string>();
  /** Small on purpose so listings exercise continuation tokens. */
  pageSize = 2;
  calls = 0;

  async send(command: unknown): Promise<unknown> {
    this.calls += 1;
    if (command instanceof PutObjectCommand) {
      const { Key, Body, IfNoneMatch } = command.input;
      if (IfNoneMatch === '*' && this.objects.has(Key!)) throw awsError('PreconditionFailed', 412);
      this.objects.set(Key!, String(Body));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const value = this.objects.get(command.input.Key!);
      if (value === undefined) throw awsError('NoSuchKey', 404);
      return { Body: { transformToString: async () => value } };
    }
    if (command instanceof ListObjectsV2Command) {
      const { Prefix = '', Delimiter, ContinuationToken } = command.input;
      const keys = [...this.objects.keys()].filter((k) => k.startsWith(Prefix)).sort();
      const contents: string[] = [];
      const prefixes = new Set<string>();
      for (const key of keys) {
        const rest = key.slice(Prefix.length);
        const slash = Delimiter ? rest.indexOf(Delimiter) : -1;
        if (slash >= 0) prefixes.add(Prefix + rest.slice(0, slash + 1));
        else contents.push(key);
      }
      // One page = pageSize entries across both lists, in the order S3 would return them.
      const entries = [
        ...contents.map((k) => ({ kind: 'key' as const, value: k })),
        ...[...prefixes].sort().map((p) => ({ kind: 'prefix' as const, value: p })),
      ];
      const start = ContinuationToken ? Number(ContinuationToken) : 0;
      const page = entries.slice(start, start + this.pageSize);
      const truncated = start + this.pageSize < entries.length;
      return {
        Contents: page.filter((e) => e.kind === 'key').map((e) => ({ Key: e.value })),
        CommonPrefixes: page.filter((e) => e.kind === 'prefix').map((e) => ({ Prefix: e.value })),
        IsTruncated: truncated,
        NextContinuationToken: truncated ? String(start + this.pageSize) : undefined,
      };
    }
    throw new Error(
      `FakeS3: unsupported command ${(command as { constructor: { name: string } }).constructor.name}`,
    );
  }
}

export interface FifoMessage {
  group: string;
  dedup: string;
  body: string;
  attributes: Record<string, string>;
}

export class FakeSns {
  /** Every batch call as received — to check sizes and order. */
  readonly batches: PublishBatchCommand['input'][] = [];
  readonly published: PublishCommand['input'][] = [];
  /** What a FIFO queue subscribed to the topic would hold, per message group, dedup applied. */
  readonly queues = new Map<string, FifoMessage[]>();
  private readonly seen = new Set<string>();
  /** Ids to refuse, to test the failure path. */
  refuse = new Set<string>();

  async send(command: unknown): Promise<unknown> {
    if (command instanceof PublishBatchCommand) {
      this.batches.push(command.input);
      const entries = command.input.PublishBatchRequestEntries ?? [];
      if (entries.length > 10) throw awsError('TooManyEntriesInBatchRequest', 400);
      const Failed = [];
      for (const e of entries) {
        if (this.refuse.has(e.Id!)) {
          Failed.push({
            Id: e.Id,
            Code: 'InternalFailure',
            Message: 'refused by the fake',
            SenderFault: false,
          });
          continue;
        }
        if (this.seen.has(e.MessageDeduplicationId!)) continue;
        this.seen.add(e.MessageDeduplicationId!);
        const q = this.queues.get(e.MessageGroupId!) ?? [];
        q.push({
          group: e.MessageGroupId!,
          dedup: e.MessageDeduplicationId!,
          body: e.Message!,
          attributes: Object.fromEntries(
            Object.entries(e.MessageAttributes ?? {}).map(([k, v]) => [k, v.StringValue ?? '']),
          ),
        });
        this.queues.set(e.MessageGroupId!, q);
      }
      return {
        Successful: entries.filter((e) => !this.refuse.has(e.Id!)).map((e) => ({ Id: e.Id })),
        Failed,
      };
    }
    if (command instanceof PublishCommand) {
      this.published.push(command.input);
      return { MessageId: `m-${this.published.length}` };
    }
    throw new Error(`FakeSns: unsupported command`);
  }
}
