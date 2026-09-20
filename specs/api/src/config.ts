/**
 * Environment → typed configuration, validated at boot.
 *
 * A misconfiguration should stop the process with a sentence naming the variable, not surface three
 * requests later as a confusing 500. Everything the service needs is read here, once, and nothing
 * downstream touches `process.env`.
 */

import { z } from 'zod';

const booleanish = z
  .string()
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()))
  .pipe(z.boolean());

const schema = z.object({
  SPECS_ENV: z.enum(['local', 'ci', 'production']).default('local'),
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // The URI deliberately carries no credentials; the driver receives them separately, so a password
  // containing `@` or `#` cannot corrupt the connection string.
  MONGO_URI: z.string().default('mongodb://127.0.0.1:27019'),
  MONGO_USER: z.string().optional(),
  MONGO_PASSWORD: z.string().optional(),
  MONGO_AUTH_SOURCE: z.string().default('admin'),
  MONGO_CONTROL_DB: z.string().default('specs_control'),
  MONGO_DB_PREFIX: z.string().default('ws'),

  AUTH_MODE: z.enum(['dev', 'jwks']).default('dev'),
  AUTH_JWKS_URL: z.string().optional(),
  AUTH_ISSUER: z.string().optional(),
  AUTH_AUDIENCE: z.string().optional(),

  /** Setting this both publishes the discovery document and adds the URL to accepted audiences. */
  MCP_RESOURCE_URL: z.string().optional(),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('mstr-specs'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanish.default('true'),

  /**
   * The record sink (ADR-0019 §6). `local` relays the outbox to a filesystem archive with
   * in-process delivery — the laptop's spine. `s3` is maestro's: the archive bucket and the FIFO
   * topic the spine's Terraform module outputs, named the way the spine's handlers read them.
   * `off` writes the outbox and relays nothing (a Lambda relay drains it instead).
   */
  RECORD_SINK: z.enum(['local', 's3', 'off']).default('local'),
  RECORD_ARCHIVE_DIR: z.string().default('./archive'),
  RECORD_SINK_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  ARCHIVE_BUCKET: z.string().optional(),
  ARCHIVE_PREFIX: z.string().optional(),
  EVENTS_TOPIC_ARN: z.string().optional(),

  EVALUATOR_BASE: z.string().optional(),

  /** The one workspace whose artifacts every tenant may read, and none may write (ADR-0008). */
  CATALOGUE_WORKSPACE: z.string().default('catalogue'),

  /** Well under MongoDB's 16MB document limit, leaving room for facets and metadata (§8.2). */
  BODY_CEILING_BYTES: z.coerce.number().int().positive().default(1_048_576),

  CORS_ORIGINS: z.string().default(''),
});

export type Config = z.infer<typeof schema> & {
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
  const isProduction = value.SPECS_ENV === 'production' || value.NODE_ENV === 'production';

  // `dev` auth injects a stub principal so the stack runs with no identity provider. In production
  // that would mean every caller is whoever they claim to be, which is not a degraded mode — it is
  // no authentication at all, so it is refused rather than warned about.
  if (isProduction && value.AUTH_MODE === 'dev') {
    throw new Error(
      'AUTH_MODE=dev injects a stub principal and cannot run in production. Set AUTH_MODE=jwks with AUTH_JWKS_URL, AUTH_ISSUER and AUTH_AUDIENCE.',
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

  return {
    ...value,
    isProduction,
    corsOrigins: value.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
