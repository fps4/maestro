#!/usr/bin/env node
/**
 * spine-verify — check a workspace's archive with every service off.
 *
 *   spine-verify <archive-root> --workspace ws-aannemer-x [--from 2026-09-01] [--to 2026-09-18]
 *
 * Exit 0 on pass with the verified range on stdout; exit 1 with the period, the first divergent
 * sequence number and the reason on a failure; exit 2 on usage. Reads a directory in the archive's
 * layout — a local archive, or an export unpacked anywhere.
 */

import { resolve } from 'node:path';
import { FsArchive } from '../archive/fs.js';
import { verifyRange } from '../archive/writer.js';
import { DAY } from '../domain/segment.js';
import { WORKSPACE_ID } from '../domain/ids.js';

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(
    'usage: spine-verify <archive-root> --workspace <ws-id> [--from YYYY-MM-DD] [--to YYYY-MM-DD]',
  );
  process.exit(2);
}

export async function main(argv: string[]): Promise<number> {
  let root: string | undefined;
  let workspace: string | undefined;
  let from: string | undefined;
  let to: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--workspace' || arg === '-w') workspace = argv[++i];
    else if (arg === '--from') from = argv[++i];
    else if (arg === '--to') to = argv[++i];
    else if (arg.startsWith('-')) usage(`unknown option ${arg}`);
    else if (root === undefined) root = arg;
    else usage(`unexpected argument ${arg}`);
  }
  if (!root) usage('an archive root is required');
  if (!workspace || !WORKSPACE_ID.test(workspace)) usage('--workspace must name a workspace (ws-…)');
  if (from !== undefined && !DAY.test(from)) usage('--from must be YYYY-MM-DD');
  if (to !== undefined && !DAY.test(to)) usage('--to must be YYYY-MM-DD');

  const verdict = await verifyRange(new FsArchive(resolve(root)), workspace, { from, to });
  if (verdict.ok) {
    console.log(
      `pass  ${verdict.workspace_id}  seq ${verdict.first_seq}–${verdict.last_seq}  ${verdict.segments} segment(s)`,
    );
    return 0;
  }
  console.log(`FAIL  ${workspace}  ${verdict.period || '-'}  seq ${verdict.seq ?? '-'}  ${verdict.reason}`);
  return 1;
}

const invokedDirectly = process.argv[1] !== undefined && /verify\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
