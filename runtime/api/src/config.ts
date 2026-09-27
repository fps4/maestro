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
  RUNTIME_ENV: z.enum(['local', 'ci', 'production']).default('local'),
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

  /** Object storage for SBOMs: MinIO locally (`S3_ENDPOINT`), the SDK's default on AWS. */
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
   * The SBOM store (maestro ADR-0027 §2): where a pipeline uploads the CycloneDX file its build
   * record names. `local` is a directory; `s3` is this service's bucket. Unset, it follows the sink.
   */
  SBOM_STORE: z.enum(['local', 's3']).optional(),
  SBOM_DIR: z.string().default('./sboms'),
  SBOM_BUCKET: z.string().optional(),

  /**
   * The intake (ADR-0027 §3): the queue a rule delivers `maestro.build` and `maestro.deploy` into is
   * taken in as one workload — identity-service's id for this deployment's intake — admitted to the
   * workspace with `intake`.
   */
  INTAKE_PRINCIPAL: z
    .string()
    .regex(/^prn-w-[a-z0-9][a-z0-9._-]{0,62}$/, 'must be a workload principal id (prn-w-…)')
    .optional(),
  INTAKE_WORKSPACE: z.string().optional(),

  /**
   * Where a digest mismatch goes (ADR-0027 §5): `work` posts a `digest_mismatch` signal to
   * work-service's intake as this service's workload, with a token from identity-service's
   * client-credentials grant; `log` writes a line and nothing else — the laptop's.
   */
  /**
   * How long a deploy of a digest the ledger has never seen waits for its build record before it is a
   * mismatch. The two events are put in order, but the queue between them does not keep it, and a
   * retry can bring the deploy first. Within the window the deploy is retried; after it, a mismatch.
   */
  BUILD_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(300),
  SIGNALS: z.enum(['log', 'work']).default('log'),
  WORK_API_URL: z.string().url().optional(),
  SIGNALS_TOKEN_URL: z.string().url().optional(),
  SIGNALS_CLIENT_ID: z.string().optional(),
  SIGNALS_CLIENT_SECRET: z.string().optional(),

  CORS_ORIGINS: z.string().default(''),
});

export type Config = Omit<z.infer<typeof schema>, 'SBOM_STORE'> & {
  SBOM_STORE: 'local' | 's3';
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
  const isProduction = value.RUNTIME_ENV === 'production' || value.NODE_ENV === 'production';

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
  if (value.SIGNALS === 'work') {
    for (const key of [
      'WORK_API_URL',
      'SIGNALS_TOKEN_URL',
      'SIGNALS_CLIENT_ID',
      'SIGNALS_CLIENT_SECRET',
    ] as const) {
      if (!value[key]) throw new Error(`SIGNALS=work requires ${key}`);
    }
  }
  const sbomStore = value.SBOM_STORE ?? (value.RECORD_SINK === 'local' ? 'local' : 's3');
  const sbomBucket = value.SBOM_BUCKET ?? value.S3_BUCKET;
  if (sbomStore === 's3' && !sbomBucket) {
    throw new Error(
      `SBOM_STORE=s3${value.SBOM_STORE ? '' : ` (the default under RECORD_SINK=${value.RECORD_SINK})`} requires SBOM_BUCKET, or S3_BUCKET to default to`,
    );
  }

  return {
    ...value,
    SBOM_STORE: sbomStore,
    ...(sbomBucket ? { SBOM_BUCKET: sbomBucket } : {}),
    isProduction,
    corsOrigins: value.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
