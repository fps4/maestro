/**
 * The sweep as a scheduled Lambda: every minute, one invocation at a time (the relay's pattern).
 * The environment is the service's own configuration; the function's role is the table's grant.
 */

import { loadConfig } from '../config.js';
import { Store } from '../db/client.js';
import { notifierFor, sweepPrincipal } from '../notify/from-config.js';
import { payloadStoreFor } from '../relay/relay.js';
import { SweepService } from '../services/sweep.js';

let sweep: SweepService | undefined;

async function connect(): Promise<SweepService> {
  if (sweep) return sweep;
  const config = loadConfig({ ...process.env, RECORD_SINK: 'off', SWEEP_MODE: 'off' });
  const principal = sweepPrincipal(config);
  sweep = new SweepService({
    store: await Store.connect(config),
    payloads: payloadStoreFor(config),
    notifier: notifierFor(config),
    principal: () => principal,
    now: () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
  return sweep;
}

export async function handler() {
  const report = await (await connect()).once();
  console.log(JSON.stringify({ msg: 'sweep', ...report }));
  // A failed item is not a failed sweep, but it is an error to alarm on: it stays due and retries.
  if (report.failed.length > 0)
    throw new Error(`sweep: ${report.failed.length} item(s) failed; see the log line above`);
  return report;
}
