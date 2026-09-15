#!/usr/bin/env node
/**
 * `specs` — the git-native path.
 *
 * A specification for a service lives most naturally next to the code, as a markdown file with
 * YAML front-matter, reviewed where the code is reviewed. This is the command that takes that file
 * and makes it a proposed version, and the command a human runs to decide on one. The record stays
 * in the service; only the authoring moved to where the author already is.
 *
 *   specs propose docs/spec.md --workspace maestro-platform
 *   specs packet  specification_gate art-…@3
 *   specs decide  specification_gate art-…@3 --outcome approve --reasoning "…" --attr seat=owner
 *   specs withdraw art-…@2
 *
 * Front-matter carries what the api needs and the body is the body:
 *
 *   ---
 *   type: specification
 *   title: Materiaalstaat generator
 *   artifact: art-…                          # optional: revise an existing lineage
 *   classification: { lawful_basis: contract, retention: 7y, personal_data: false }
 *   links: [{ type: justified_by, target: art-… }]
 *   facets:                                  # or any other top-level key — same thing
 *     class: generative
 *     acceptance_criteria: [ … ]
 *   ---
 *   ## Scope
 *
 * Auth is a bearer token in `SPECS_TOKEN` and the service in `SPECS_URL`. The service marks the
 * facets `declared` when the token is a person's and `extracted` when it is an agent's — the CLI
 * is the same principal as its token, never someone else.
 */

import { readFile } from 'node:fs/promises';
import { facetsFrom, splitFrontMatter } from '../domain/document.js';

export { facetsFrom, splitFrontMatter };

interface Options {
  url: string;
  token: string;
  workspace: string;
}

function usage(): never {
  process.stderr.write(
    [
      'usage:',
      '  specs propose <file.md> --workspace <ws> [--type <type>] [--artifact <id>] [--title <t>] [--keep-proposed]',
      '  specs withdraw <artifact>@<ordinal> --workspace <ws> [--reason <r>]',
      '  specs packet <gate> <artifact>@<ordinal> --workspace <ws>',
      '  specs decide <gate> <artifact>@<ordinal> --workspace <ws> --outcome <o> [--reasoning <r>] [--attr k=v …]',
      '',
      'env: SPECS_URL (default http://127.0.0.1:8020), SPECS_TOKEN (bearer)',
      '',
    ].join('\n'),
  );
  process.exit(2);
}

/** `--flag value`, `--flag=value`, repeated `--attr k=v`, and bare `--switch`. */
function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const attrs: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    const value = inline ?? (argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i] : true);
    if (name === 'attr' && typeof value === 'string') {
      const [k, v] = value.split(/=(.*)/s, 2);
      if (k && v !== undefined) attrs[k] = v;
      continue;
    }
    flags[name!] = value as string | true;
  }
  return { positional, flags, attrs };
}

function ref(value: string): { artifact: string; ordinal: number } {
  const m = /^(.+)@(\d+)$/.exec(value);
  if (!m) throw new Error(`expected <artifact>@<ordinal>, got \`${value}\``);
  return { artifact: m[1]!, ordinal: Number(m[2]) };
}

class Api {
  constructor(private readonly options: Options) {}

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.options.url}/v1/workspaces/${this.options.workspace}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
      message?: string;
    };
    if (!response.ok) {
      const issues = Array.isArray(payload.issues)
        ? '\n' +
          (payload.issues as Array<{ path?: string; field?: string; message: string }>)
            .map((i) => `  ${i.path ?? i.field ?? ''}: ${i.message}`)
            .join('\n')
        : '';
      throw new Error(`${response.status} from ${method} ${path}: ${payload.message ?? 'refused'}${issues}`);
    }
    return payload as T;
  }
}

async function propose(api: Api, file: string, flags: Record<string, string | true>) {
  const source = await readFile(file, 'utf8');
  // Only the envelope is read here, to name the type and lineage; the service parses the rest.
  const { meta } = splitFrontMatter(source);
  const type = (flags.type as string) ?? (meta.type as string);
  const title = (flags.title as string) ?? (meta.title as string);
  const artifact = (flags.artifact as string) ?? (meta.artifact as string | undefined);
  if (!type) throw new Error('a type is needed: `type:` in the front-matter or --type');
  if (!title) throw new Error('a title is needed: `title:` in the front-matter or --title');

  // One live proposal per lineage: withdraw what this principal proposed earlier and nobody decided.
  if (artifact && !flags['keep-proposed']) {
    const { artifact: record, versions } = await api.call<{
      artifact: { id: string };
      versions: Array<{ ordinal: number; state: string; proposed_by: string }>;
    }>('GET', `/artifacts/${artifact}`);
    for (const v of versions.filter((v) => v.state === 'proposed')) {
      try {
        await api.call('POST', `/artifacts/${record.id}/versions/${v.ordinal}/withdraw`, {
          reason: `superseded by a new proposal from ${file}`,
        });
        process.stderr.write(`withdrew ${record.id}@${v.ordinal}\n`);
      } catch (error) {
        process.stderr.write(`left ${record.id}@${v.ordinal} proposed: ${(error as Error).message}\n`);
      }
    }
  }

  // One code path: the file *is* the document. The service derives facets from front-matter and
  // from the type's declared blocks, and marks their provenance from the token's kind.
  const { draft: created } = await api.call<{ draft: { id: string; revision: number } }>('POST', '/drafts', {
    type,
    title,
    ...(artifact ? { artifact } : {}),
  });
  const { draft } = await api.call<{ draft: { id: string } }>('PUT', `/drafts/${created.id}/document`, {
    revision: created.revision,
    document: source,
  });

  const { readiness } = await api.call<{
    readiness: {
      proposable: boolean;
      blockers: Array<{ label: string; detail: string; description?: string }>;
    };
  }>('GET', `/drafts/${draft.id}/readiness`);
  if (!readiness.proposable) {
    await api.call('DELETE', `/drafts/${draft.id}`).catch(() => undefined);
    throw new Error(
      `${file} cannot be proposed yet:\n` +
        readiness.blockers
          .map((b) => `  - ${b.label}${b.description ? ` — ${b.description}` : ''}: ${b.detail}`)
          .join('\n'),
    );
  }

  const { version, evaluations } = await api.call<{
    version: { artifact: string; ordinal: number; digest: string; type: string };
    evaluations: Array<{ evaluator: string; status: string; verdict?: string; reason?: string }>;
  }>('POST', `/drafts/${draft.id}/propose`);

  process.stdout.write(`proposed ${version.artifact}@${version.ordinal} (${version.digest})\n`);
  for (const run of evaluations) {
    process.stdout.write(
      `  ${run.evaluator}: ${run.status === 'recorded' ? run.verdict : `unavailable — ${run.reason}`}\n`,
    );
  }
  if (readiness.blockers.length > 0) {
    process.stdout.write('  the gate will still ask for:\n');
    for (const b of readiness.blockers) process.stdout.write(`    - ${b.label}: ${b.detail}\n`);
  }
  // Machine-readable on the last line, for a workflow step to pick up.
  process.stdout.write(
    `${JSON.stringify({ artifact: version.artifact, ordinal: version.ordinal, digest: version.digest })}\n`,
  );
}

async function packet(api: Api, gate: string, target: string) {
  const { artifact, ordinal } = ref(target);
  const { packet } = await api.call<{
    packet: {
      gate: { title: string; description?: string; type_title: string };
      subject: { title: string; proposed_by: string };
      since: null | {
        ordinal: number;
        facets: Array<{ label: string; kind: string }>;
        body: { unchanged: boolean; added_lines: number; removed_lines: number };
      };
      checks: Array<{ title: string; satisfied: boolean; blocking: boolean; detail: string }>;
      questions: { open: number };
      open: boolean;
      decider: {
        may_decide: boolean;
        reason: string;
        outcomes: Array<{ label: string; effects: string[]; blocked?: string }>;
      };
    };
  }>('GET', `/gates/${gate}/${artifact}/${ordinal}/packet`);

  const lines = [
    `# ${packet.gate.title}: ${packet.subject.title}`,
    packet.gate.description ? `You are being asked: ${packet.gate.description}` : '',
    `A ${packet.gate.type_title.toLowerCase()}, version ${ordinal}, proposed by ${packet.subject.proposed_by}.`,
    '',
    '## What changed',
    packet.since
      ? [
          `Since version ${packet.since.ordinal}: ` +
            (packet.since.facets.length
              ? packet.since.facets.map((f) => `${f.label} ${f.kind}`).join(', ')
              : 'no facet changed') +
            (packet.since.body.unchanged
              ? '; text unchanged.'
              : `; text +${packet.since.body.added_lines}/-${packet.since.body.removed_lines} lines.`),
        ].join('')
      : 'First version anyone is asked to decide on.',
    '',
    '## What the checks found',
    ...(packet.checks.length
      ? packet.checks.map(
          (c) => `- [${c.satisfied ? 'x' : ' '}] ${c.title}${c.blocking ? '' : ' (advisory)'} — ${c.detail}`,
        )
      : ['(no checks declared)']),
    packet.questions.open ? `\n${packet.questions.open} open question(s).` : '',
    '',
    '## What happens if you…',
    ...packet.decider.outcomes.flatMap((o) => [
      `**${o.label}**`,
      ...o.effects.map((e) => `- ${e}`),
      ...(o.blocked ? [`- ⚠ ${o.blocked}`] : []),
      '',
    ]),
    packet.open ? 'The gate is open.' : 'The gate is not open yet.',
    packet.decider.may_decide
      ? `You may decide: ${packet.decider.reason}`
      : `You may not decide: ${packet.decider.reason}`,
  ].filter((l) => l !== '');
  process.stdout.write(lines.join('\n') + '\n');
}

async function decide(
  api: Api,
  gate: string,
  target: string,
  flags: Record<string, string | true>,
  attrs: Record<string, string>,
) {
  const { artifact, ordinal } = ref(target);
  const outcome = flags.outcome as string | undefined;
  if (!outcome) throw new Error('--outcome is needed');
  const { decision } = await api.call<{ decision: { id: string; outcome: string; decided_at: string } }>(
    'POST',
    `/gates/${gate}/decisions`,
    {
      artifact,
      ordinal,
      outcome,
      ...(typeof flags.reasoning === 'string' ? { reasoning: flags.reasoning } : {}),
      attribution: attrs,
      ...(typeof flags.materiality === 'string' ? { materiality: flags.materiality } : {}),
    },
  );
  process.stdout.write(
    `decided ${artifact}@${ordinal}: ${decision.outcome} (${decision.id}, ${decision.decided_at})\n`,
  );
}

async function withdraw(api: Api, target: string, flags: Record<string, string | true>) {
  const { artifact, ordinal } = ref(target);
  await api.call('POST', `/artifacts/${artifact}/versions/${ordinal}/withdraw`, {
    ...(typeof flags.reason === 'string' ? { reason: flags.reason } : {}),
  });
  process.stdout.write(`withdrew ${artifact}@${ordinal}\n`);
}

export async function main(argv: string[]): Promise<void> {
  const { positional, flags, attrs } = parseArgs(argv);
  const [command, ...rest] = positional;
  if (!command) usage();

  const workspace = flags.workspace as string | undefined;
  const token = process.env.SPECS_TOKEN;
  if (!workspace) throw new Error('--workspace is needed');
  if (!token) throw new Error('SPECS_TOKEN is not set');
  const api = new Api({
    url: (process.env.SPECS_URL ?? 'http://127.0.0.1:8020').replace(/\/$/, ''),
    token,
    workspace,
  });

  switch (command) {
    case 'propose':
      if (!rest[0]) usage();
      return propose(api, rest[0], flags);
    case 'packet':
      if (!rest[0] || !rest[1]) usage();
      return packet(api, rest[0], rest[1]);
    case 'decide':
      if (!rest[0] || !rest[1]) usage();
      return decide(api, rest[0], rest[1], flags, attrs);
    case 'withdraw':
      if (!rest[0]) usage();
      return withdraw(api, rest[0], flags);
    default:
      usage();
  }
}

const invokedDirectly = process.argv[1] && /specs\.(ts|js|mjs)$/.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error: Error) => {
    process.stderr.write(`specs: ${error.message}\n`);
    process.exit(1);
  });
}
