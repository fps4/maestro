/**
 * `npm run workspace:member -- <workspace> --issuer <iss> --subject <sub> --prn <prn-…> --roles a,b [--kind human|agent|service] [--gates g1,g2] [--accountable <prn>] [--display-name <name>]`
 *
 * Grants a principal membership of a workspace — the operator's act that admits the first human of
 * a fresh deployment, and every agent after (ADR-0019 §2). Membership is granted in the workspace,
 * never by the token: a token names who someone is (issuer and subject), the membership names what
 * this workspace lets them do (roles, gates) and, for an agent, the human answerable for it.
 *
 * The principal is resolved exactly as a token's would be — registered under its `prn` on first
 * sight of (issuer, subject), found on every sight after — so the membership written here is the
 * one the first request will read. The `prn` is identity-service's id for the person or credential
 * (the token's `prn` claim; ADR-0022): required for an identity this registry has not seen, except
 * the development issuer's, whose principals are still minted here. Memberships are grants, not
 * record: nothing is emitted to the spine.
 */
import { loadConfig } from '../config.js';
import { Store } from '../db/client.js';
import { kindOfPrincipalId } from '../domain/ids.js';
import type { PrincipalKind } from '../domain/types.js';
import { PrincipalDirectory } from '../services/principals.js';

const KINDS: readonly PrincipalKind[] = ['human', 'agent', 'service'];

export interface MemberInput {
  workspace: string;
  issuer: string;
  subject: string;
  /** identity-service's principal id for this identity — its tokens' `prn` claim. */
  prn?: string;
  roles: string[];
  kind: PrincipalKind;
  gates?: string[];
  accountable?: string;
  display_name?: string;
}

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
  const issuer = flags.get('issuer');
  const subject = flags.get('subject');
  const roles = flags.get('roles');
  if (!issuer || !subject || !roles) throw new UsageError('--issuer, --subject and --roles are required');
  const kind = (flags.get('kind') ?? 'human') as PrincipalKind;
  if (!KINDS.includes(kind)) throw new UsageError(`--kind is one of ${KINDS.join(', ')}`);
  const prn = flags.get('prn');
  if (prn !== undefined && kindOfPrincipalId(prn) !== kind) {
    throw new UsageError(`--prn \`${prn}\` is not a ${kind}'s principal id (prn-h-…, prn-a-…, prn-w-…)`);
  }
  const list = (value: string | undefined): string[] | undefined =>
    value === undefined
      ? undefined
      : value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
  const accountable = flags.get('accountable');
  if (kind !== 'human' && !accountable) {
    throw new UsageError(
      `a ${kind} needs --accountable <prn-h-…>: the human answerable for what it does here (ADR-0019 §2)`,
    );
  }
  return {
    workspace,
    issuer,
    subject,
    ...(prn ? { prn } : {}),
    roles: list(roles) ?? [],
    kind,
    ...(list(flags.get('gates')) ? { gates: list(flags.get('gates')) } : {}),
    ...(accountable ? { accountable } : {}),
    ...(flags.get('display-name') ? { display_name: flags.get('display-name') } : {}),
  };
}

export class UsageError extends Error {}

/** The development verifier's issuer: its principals are still minted here (ADR-0022). */
const DEV_ISSUER = 'dev';

/** The grant: resolve the principal as a token would, then write the membership. Returns what was written. */
export async function grantMembership(
  store: Store,
  input: MemberInput,
): Promise<{ principal: string; created: boolean }> {
  const directory = new PrincipalDirectory(store);
  const before = await store.control.principals.bySubject(input.issuer, input.subject);
  if (!before && !input.prn && input.issuer !== DEV_ISSUER) {
    throw new UsageError(
      `\`${input.issuer}\` / \`${input.subject}\` is not registered here: name it with --prn, the \`prn\` claim identity-service puts in its tokens (ADR-0022). This service mints no principal id for a real identity.`,
    );
  }
  const principal = await directory.resolve({
    issuer: input.issuer,
    subject: input.subject,
    kind: input.kind,
    display_name: input.display_name ?? before?.display_name ?? input.subject,
    ...(input.prn ? { prn: input.prn } : {}),
  });
  const handle = await store.handle(input.workspace);
  await handle.memberships.put({
    principal: principal.id,
    roles: input.roles,
    ...(input.gates ? { gates: input.gates } : {}),
    ...(input.accountable ? { accountable: input.accountable } : {}),
  });
  return { principal: principal.id, created: !before };
}

async function main(): Promise<void> {
  let input: MemberInput;
  try {
    input = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`workspace:member: ${error.message}`);
      console.error(
        'Usage: workspace:member -- <workspace> --issuer <iss> --subject <sub> --prn <prn-…> --roles a,b [--kind human|agent|service] [--gates g1,g2] [--accountable <prn>] [--display-name <name>]',
      );
      process.exit(2);
    }
    throw error;
  }
  const store = await Store.connect(loadConfig());
  try {
    const { principal } = await grantMembership(store, input);
    console.log(
      `\`${principal}\` (${input.kind}, ${input.issuer} / ${input.subject}) is a member of \`${input.workspace}\` with roles ${input.roles.join(', ')}` +
        (input.gates ? ` and gates ${input.gates.join(', ')}` : '') +
        (input.accountable ? `, answerable to \`${input.accountable}\`` : '') +
        '.',
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  } finally {
    await store.close();
  }
}

if (process.argv[1] && /member\.(ts|js)$/.test(process.argv[1])) await main();
