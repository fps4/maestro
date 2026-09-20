/**
 * The environment a spine Lambda reads. The Terraform module sets these; a component's relay
 * module sets the same names. Nothing else is configuration.
 *
 *   ARCHIVE_BUCKET      the archive bucket
 *   ARCHIVE_PREFIX      key prefix inside it (optional)
 *   EVENTS_TOPIC_ARN    the FIFO topic a relay publishes to
 *   DIGEST_TOPIC_ARN    the topic the sealer sends segment digests to (optional)
 */

export function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
