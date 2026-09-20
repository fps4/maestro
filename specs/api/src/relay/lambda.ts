/**
 * The relay as a scheduled Lambda (ADR-0019 §6). The spine's handler over this service's outbox;
 * the environment carries the archive and topic the spine's Terraform module outputs, plus this
 * service's own MongoDB connection. One connection per container, made on first use.
 */

import { relayHandler } from '@fps4/maestro-spine';
import { loadConfig } from '../config.js';
import { Store } from '../db/client.js';
import { RECORD_TYPES } from '../db/record-types.js';
import { PrincipalDirectory } from '../services/principals.js';
import { MongoOutboxSource } from './source.js';

let source: MongoOutboxSource | undefined;

async function connect(): Promise<MongoOutboxSource> {
  if (source) return source;
  const config = loadConfig({ ...process.env, RECORD_SINK: 'off' });
  const store = await Store.connect(config);
  source = new MongoOutboxSource(store, new PrincipalDirectory(store));
  return source;
}

export async function handler() {
  const s = await connect();
  return relayHandler({ component: 'specs', source: s, resolve: s.resolve, types: RECORD_TYPES })();
}
