/**
 * `npm run principal:adopt -- --issuer <iss> --subject <sub> --prn <prn-…> [--dry-run]`
 *
 * Aligns an identity this service first saw before it read identity-service's `prn` claim — when it
 * minted a principal id of its own — with the id identity-service mints (ADR-0022 §3). Once per
 * identity, by an operator; a request carrying the `prn` is refused until it has run, with this
 * command in the refusal.
 *
 * What it changes is what is **not** record:
 * - the registry — the principal under the `prn`, `supersedes: [old]`; the old item kept, marked
 *   `superseded_by`; the `(issuer, subject)` mapping re-pointed — in one transaction;
 * - every workspace's membership held by the old id, moved to the new one;
 * - every membership and agent that names the old id as its answerable human, re-pointed.
 *
 * What it leaves is the record: versions, decisions, evaluations, questions and the outbox name the
 * old id, as the archive does. The archive is append-only and sealed by day, and the projection is
 * held equal to it by the rebuild gate, so neither is rewritten; the old→new mapping is recorded
 * forward, on the registry, and the rules that ask "the same person?" read it.
 *
 * Idempotent: run again, it finds the registry aligned and moves whatever grant was left behind.
 * `--dry-run` reads and prints the plan and writes nothing.
 */
import { loadConfig } from '../config.js';
import { Store } from '../db/client.js';
import type { PrincipalRecord } from '../db/control.js';
import { kindOfPrincipalId } from '../domain/ids.js';

export interface AdoptInput {
  issuer: string;
  subject: string;
  prn: string;
  dryRun: boolean;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[]): AdoptInput {
  const flags = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (flag === '--dry-run') {
      dryRun = true;
      continue;
    }
    const value = argv[i + 1];
    if (!flag.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new UsageError(`\`${flag}\` needs a value`);
    }
    flags.set(flag.slice(2), value);
    i += 1;
  }
  const issuer = flags.get('issuer');
  const subject = flags.get('subject');
  const prn = flags.get('prn');
  if (!issuer || !subject || !prn) throw new UsageError('--issuer, --subject and --prn are required');
  if (!kindOfPrincipalId(prn))
    throw new UsageError(`\`${prn}\` is not a maestro principal id (prn-h-…, prn-a-…, prn-w-…)`);
  return { issuer, subject, prn, dryRun };
}

/** One change the command makes, or would make. */
export interface Step {
  what: 'register' | 'membership' | 'accountable' | 'operated_by';
  workspace?: string;
  principal: string;
  from: string;
  to: string;
}

export interface AdoptReport {
  /** The id the identity was registered under before, when it was not already the `prn`. */
  superseded: string[];
  steps: Step[];
  /** Why nothing was done, when nothing was. */
  note?: string;
  applied: boolean;
}

export async function adoptPrincipal(store: Store, input: AdoptInput): Promise<AdoptReport> {
  const principals = store.control.principals;
  const current = await principals.bySubject(input.issuer, input.subject);
  if (!current) {
    return {
      superseded: [],
      steps: [],
      applied: false,
      note: `\`${input.issuer}\` / \`${input.subject}\` is not registered here; its first request registers it as \`${input.prn}\`.`,
    };
  }

  const kind = kindOfPrincipalId(input.prn);
  if (kind !== current.kind) {
    throw new Error(
      `\`${current.id}\` is ${current.kind === 'agent' ? 'an' : 'a'} ${current.kind}; \`${input.prn}\` names a ${kind}.`,
    );
  }

  const steps: Step[] = [];
  let superseded: string[];
  let next: PrincipalRecord | null = null;
  const now = new Date().toISOString();

  if (current.id === input.prn) {
    // Aligned already — by an earlier run, or never minted here. Finish what an interrupted run left.
    superseded = current.supersedes ?? [];
  } else {
    if (current.superseded_by) {
      throw new Error(
        `\`${current.id}\` is marked superseded by \`${current.superseded_by}\` and still mapped; look before re-running.`,
      );
    }
    if (await principals.get(input.prn)) {
      throw new Error(
        `\`${input.prn}\` is already registered here for another identity; nothing is re-pointed.`,
      );
    }
    superseded = [current.id, ...(current.supersedes ?? [])];
    next = {
      id: input.prn,
      kind: current.kind,
      display_name: current.display_name,
      issuer: input.issuer,
      subject: input.subject,
      ...(current.operated_by ? { operated_by: current.operated_by } : {}),
      supersedes: superseded,
      created_at: now,
    };
    steps.push({ what: 'register', principal: input.prn, from: current.id, to: input.prn });
  }

  if (superseded.length === 0) {
    return {
      superseded,
      steps,
      applied: false,
      note: `\`${input.prn}\` is registered and supersedes nothing; there is nothing to move.`,
    };
  }
  const old = new Set(superseded);

  for (const workspace of await store.control.workspaces.list()) {
    const handle = await store.handle(workspace.id);
    for (const membership of await handle.memberships.list()) {
      if (old.has(membership.principal)) {
        steps.push({
          what: 'membership',
          workspace: workspace.id,
          principal: membership.principal,
          from: membership.principal,
          to: input.prn,
        });
      }
      if (membership.accountable && old.has(membership.accountable)) {
        steps.push({
          what: 'accountable',
          workspace: workspace.id,
          principal: membership.principal,
          from: membership.accountable,
          to: input.prn,
        });
      }
    }
  }
  for (const principal of await principals.list()) {
    if (principal.operated_by && old.has(principal.operated_by)) {
      steps.push({
        what: 'operated_by',
        principal: principal.id,
        from: principal.operated_by,
        to: input.prn,
      });
    }
  }

  if (input.dryRun) return { superseded, steps, applied: false };

  if (next) await principals.adopt(current, next, now);
  for (const step of steps) {
    if (step.what === 'membership') {
      const handle = await store.handle(step.workspace!);
      const membership = await handle.memberships.get(step.from);
      // The accountable step below may name this same grant's agent; a moved grant keeps its fields.
      if (membership) await handle.memberships.move(membership, step.to);
    }
  }
  for (const step of steps) {
    if (step.what === 'accountable') {
      const handle = await store.handle(step.workspace!);
      // A membership moved above sits under its new key now.
      const holder = old.has(step.principal) ? step.to : step.principal;
      await handle.memberships.setAccountable(holder, step.from, step.to);
    }
    if (step.what === 'operated_by') await principals.setOperatedBy(step.principal, step.from, step.to);
  }
  return { superseded, steps, applied: true };
}

function describe(step: Step): string {
  switch (step.what) {
    case 'register':
      return `registry: \`${step.to}\` registered for this identity, superseding \`${step.from}\` (kept, marked superseded_by); the (issuer, subject) mapping re-pointed`;
    case 'membership':
      return `${step.workspace}: membership of \`${step.from}\` moved to \`${step.to}\``;
    case 'accountable':
      return `${step.workspace}: \`${step.principal}\`'s answerable human \`${step.from}\` → \`${step.to}\``;
    case 'operated_by':
      return `registry: \`${step.principal}\`'s operator \`${step.from}\` → \`${step.to}\``;
  }
}

async function main(): Promise<void> {
  let input: AdoptInput;
  try {
    input = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`principal:adopt: ${error.message}`);
      console.error('Usage: principal:adopt -- --issuer <iss> --subject <sub> --prn <prn-…> [--dry-run]');
      process.exit(2);
    }
    throw error;
  }
  const store = await Store.connect(loadConfig());
  try {
    const report = await adoptPrincipal(store, input);
    if (report.note) console.log(report.note);
    const verb = report.applied
      ? 'done'
      : input.dryRun
        ? 'would do (dry run; nothing written)'
        : 'nothing to do';
    console.log(`principal:adopt ${input.issuer} / ${input.subject} → ${input.prn}: ${verb}`);
    for (const step of report.steps) console.log(`  - ${describe(step)}`);
    if (report.superseded.length > 0) {
      console.log(
        `  Records naming ${report.superseded.map((id) => `\`${id}\``).join(', ')} are history and stay as they are; the registry says whose they are.`,
      );
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  } finally {
    await store.close();
  }
}

if (process.argv[1] && /adopt\.(ts|js)$/.test(process.argv[1])) await main();
