/**
 * `npm run workspace:rebuild -- --workspace <id> [--force]`
 *
 * Rebuild a workspace's items from the archive and the payloads alone (maestro ADR-0019 §4). It
 * reads the same configuration as the running service — `RECORD_SINK`, `RECORD_ARCHIVE_DIR` or
 * `ARCHIVE_BUCKET` and `ARCHIVE_PREFIX`, `PAYLOAD_STORE`, `RECORD_PAYLOAD_DIR` or `PAYLOAD_BUCKET`,
 * `TABLE_NAME` — so it reads exactly where the service wrote. Run it with the service stopped for
 * this workspace: a write during the replay would race the projection. Memberships are grants, not
 * record: re-apply them afterwards.
 */

import { loadConfig } from '../config.js';
import { Store } from '../db/client.js';
import { archiveFor, payloadStoreFor } from '../relay/relay.js';
import { RebuildRefused, RebuildService } from '../services/rebuild.js';

function usage(): never {
  console.error('Usage: workspace:rebuild -- --workspace <id> [--force]');
  process.exit(2);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--workspace');
  const workspace = at >= 0 ? argv[at + 1] : undefined;
  if (!workspace || workspace.startsWith('--')) usage();

  const config = loadConfig();
  const archive = archiveFor(config);
  if (!archive) {
    console.error('No archive to rebuild from: set RECORD_SINK=local, or ARCHIVE_BUCKET for the spine’s.');
    process.exit(2);
  }
  const store = await Store.connect(config);
  try {
    const report = await new RebuildService(store).rebuild({
      workspace,
      archive,
      payloads: payloadStoreFor(config),
      force: argv.includes('--force'),
    });
    console.log(
      `Rebuilt workspace \`${report.workspace}\` from ${report.events} events: ${report.items} items, ${report.open} open, ${report.closed} closed.`,
    );
    console.log('Memberships are grants, not record: re-apply them from the tenant’s configuration.');
  } catch (error) {
    if (error instanceof RebuildRefused) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  } finally {
    await store.close();
  }
}

await main();
