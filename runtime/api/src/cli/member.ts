/**
 * `npm run workspace:member -- <workspace> --prn <prn-…> --roles a,b [--accountable <prn-h-…>] [--by <prn>]`
 *
 * Grants a principal membership of a workspace: the seats it may claim in and, for an agent, the
 * human answerable for what it does here. The principal is identity-service's id — its tokens'
 * `prn` claim; this service mints none. Memberships are grants, not record: nothing is emitted.
 */

import { loadConfig } from '../config.js';
import { Store } from '../db/client.js';
import { kindOf, isPrincipalId } from '../domain/ids.js';

export interface MemberInput {
  workspace: string;
  prn: string;
  roles: string[];
  accountable?: string;
  by: string;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[]): MemberInput {
  const [workspace, ...rest] = argv;
  if (!workspace || workspace.startsWith('--')) throw new UsageError('the workspace comes first');
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]!;
    const value = rest[i + 1];
    if (!flag.startsWith('--') || value === undefined) throw new UsageError(`\`${flag}\` needs a value`);
    flags.set(flag.slice(2), value);
  }
  const prn = flags.get('prn');
  if (!prn || !isPrincipalId(prn))
    throw new UsageError('--prn names identity-service’s principal id (prn-h-…, prn-a-…)');
  const accountable = flags.get('accountable');
  if (accountable && kindOf(accountable) !== 'human')
    throw new UsageError('--accountable names a human (prn-h-…)');
  if (kindOf(prn) !== 'human' && !accountable) {
    throw new UsageError(
      'an agent or a workload is admitted with --accountable, the human answerable for it',
    );
  }
  const roles = (flags.get('roles') ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  return { workspace, prn, roles, ...(accountable ? { accountable } : {}), by: flags.get('by') ?? 'cli' };
}

async function main(): Promise<void> {
  let input: MemberInput;
  try {
    input = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(
      `${error.message}\nUsage: workspace:member -- <workspace> --prn <prn-…> --roles a,b [--accountable <prn-h-…>]`,
    );
    process.exit(2);
  }
  const store = await Store.connect(loadConfig());
  try {
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const handle = await store.handle(input.workspace);
    await store.control.principals.seen(input.prn, kindOf(input.prn), now);
    if (input.accountable) await store.control.principals.seen(input.accountable, 'human', now);
    await handle.memberships.put({
      principal: input.prn,
      roles: input.roles,
      ...(input.accountable ? { accountable: input.accountable } : {}),
      granted_at: now,
      granted_by: input.by,
    });
    console.log(
      `\`${input.prn}\` is a member of \`${input.workspace}\` with ${input.roles.length ? input.roles.map((r) => `\`${r}\``).join(', ') : 'no roles'}.`,
    );
  } finally {
    await store.close();
  }
}

if (process.argv[1]?.endsWith('member.ts') || process.argv[1]?.endsWith('member.js')) await main();
