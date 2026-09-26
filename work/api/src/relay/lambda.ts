/**
 * The relay as a scheduled Lambda: the spine's handler over this service's outbox. The environment
 * carries the archive and topic the spine's Terraform module outputs, plus this service's table
 * (`TABLE_NAME`; the function's role is the grant). One client per container, made on first use.
 */

import { relayHandler } from '@fps4/maestro-spine';
import { loadConfig } from '../config.js';
import { Store } from '../db/client.js';
import { RECORD_TYPES } from '../domain/record-types.js';
import { DynamoOutboxSource } from './source.js';

let source: DynamoOutboxSource | undefined;

async function connect(): Promise<DynamoOutboxSource> {
  if (source) return source;
  const config = loadConfig({ ...process.env, RECORD_SINK: 'off' });
  source = new DynamoOutboxSource(await Store.connect(config));
  return source;
}

export async function handler() {
  const s = await connect();
  return relayHandler({ component: 'work', source: s, resolve: s.resolve, types: RECORD_TYPES })();
}
