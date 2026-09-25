/**
 * Environment → typed configuration, validated at boot.
 *
 * A misconfiguration stops the process with a sentence naming the variable, rather than surfacing
 * three requests later as a confusing 500. Everything the service needs is read here, once, and
 * nothing downstream touches `process.env`.
 */

import { z } from 'zod';

const booleanish = z
  .string()
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()))
  .pipe(z.boolean());

const schema = z.object({
  WORK_ENV: z.enum(['local', 'ci', 'production']).default('local'),
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /**
   * The record store: one DynamoDB table (maestro ADR-0018, ADR-0019). No credential — on AWS the
   * function's role is the grant. `DYNAMODB_ENDPOINT` names DynamoDB Local on a laptop.
   */
  TABLE_NAME: z.string().min(1, 'TABLE_NAME names the DynamoDB table this service reads and writes'),
  DYNAMODB_ENDPOINT: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),

  /**
   * `dev` reads a stub principal from the bearer token (`dev:<prn>[:role,role]`) and is refused in
   * production. `jwks` verifies identity-service's tokens and reads the `prn` claim.
   */
  AUTH_MODE: z.enum(['dev', 'jwks']).default('dev'),
  AUTH_JWKS_URL: z.string().optional(),
  AUTH_ISSUER: z.string().optional(),
  AUTH_AUDIENCE: z.string().optional(),

  /** Setting this both publishes the MCP endpoint in production and accepts it as an audience. */
  MCP_RESOURCE_URL: z.string().optional(),

  /** Object storage for payloads: MinIO locally (`S3_ENDPOINT`), the SDK's default on AWS. */
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanish.default('true'),

  /**
   * The record sink. `local` relays the outbox to a filesystem archive with in-process delivery —
   * the laptop's spine. `s3` is maestro's: the archive bucket and FIFO topic the spine's module
   * outputs. `off` writes the outbox and relays nothing (the relay Lambda drains it).
   */
  RECORD_SINK: z.enum(['local', 's3', 'off']).default('local'),
  RECORD_ARCHIVE_DIR: z.string().default('./archive'),
  RECORD_SINK_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  ARCHIVE_BUCKET: z.string().optional(),
  ARCHIVE_PREFIX: z.string().optional(),
  EVENTS_TOPIC_ARN: z.string().optional(),

  /**
   * The payload store: an item's title, a note, a reason — the words an event names by reference
   * and digest. `local` is a directory; `s3` is this service's bucket under a prefix. Unset, it
   * follows the sink: `local` under `RECORD_SINK=local`, `s3` otherwise.
   */
  PAYLOAD_STORE: z.enum(['local', 's3']).optional(),
  RECORD_PAYLOAD_DIR: z.string().default('./payloads'),
  PAYLOAD_BUCKET: z.string().optional(),
  PAYLOAD_PREFIX: z.string().default('payloads'),

  /**
   * The sweep (maestro ADR-0019 §6): what the passing of time does to open items. `in_process` runs
   * it on an interval beside the API — the laptop's; `off` leaves it to the scheduled Lambda.
   * `SWEEP_PRINCIPAL` is the workload it acts as — identity-service's id for this service; locally a
   * stand-in is used.
   */
  SWEEP_MODE: z.enum(['in_process', 'off']).default('in_process'),
  SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  SWEEP_PRINCIPAL: z
    .string()
    .regex(/^prn-w-[a-z0-9][a-z0-9._-]{0,62}$/, 'must be a workload principal id (prn-w-…)')
    .optional(),

  /** How a chase-ladder step reaches a person: a log line, or a Slack incoming webhook. */
  NOTIFIER: z.enum(['log', 'slack']).default('log'),
  SLACK_WEBHOOK_URL: z.string().url().optional(),

  CORS_ORIGINS: z.string().default(''),
});

export type Config = Omit<z.infer<typeof schema>, 'PAYLOAD_STORE'> & {
  PAYLOAD_STORE: 'local' | 's3';
  corsOrigins: string[];
  isProduction: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuration is invalid:\n${lines.join('\n')}`);
  }
  const value = parsed.data;
  const isProduction = value.WORK_ENV === 'production' || value.NODE_ENV === 'production';

  // `dev` auth believes whatever the bearer says. In production that is not a degraded mode — it is
  // no authentication at all — so it is refused rather than warned about.
  if (isProduction && value.AUTH_MODE === 'dev') {
    throw new Error(
      'AUTH_MODE=dev believes the bearer and cannot run in production. Set AUTH_MODE=jwks with AUTH_JWKS_URL, AUTH_ISSUER and AUTH_AUDIENCE.',
    );
  }
  if (value.AUTH_MODE === 'jwks') {
    for (const key of ['AUTH_JWKS_URL', 'AUTH_ISSUER', 'AUTH_AUDIENCE'] as const) {
      if (!value[key]) throw new Error(`AUTH_MODE=jwks requires ${key}`);
    }
  }
  if (value.RECORD_SINK === 's3') {
    for (const key of ['ARCHIVE_BUCKET', 'EVENTS_TOPIC_ARN'] as const) {
      if (!value[key]) throw new Error(`RECORD_SINK=s3 requires ${key}`);
    }
  }
  if (value.NOTIFIER === 'slack' && !value.SLACK_WEBHOOK_URL) {
    throw new Error('NOTIFIER=slack requires SLACK_WEBHOOK_URL');
  }
  const payloadStore = value.PAYLOAD_STORE ?? (value.RECORD_SINK === 'local' ? 'local' : 's3');
  const payloadBucket = value.PAYLOAD_BUCKET ?? value.S3_BUCKET;
  if (payloadStore === 's3' && !payloadBucket) {
    throw new Error(
      `PAYLOAD_STORE=s3${value.PAYLOAD_STORE ? '' : ` (the default under RECORD_SINK=${value.RECORD_SINK})`} requires PAYLOAD_BUCKET, or S3_BUCKET to default to`,
    );
  }

  return {
    ...value,
    PAYLOAD_STORE: payloadStore,
    ...(payloadBucket ? { PAYLOAD_BUCKET: payloadBucket } : {}),
    isProduction,
    corsOrigins: value.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
