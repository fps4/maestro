/**
 * The MCP surface — transport-agnostic.
 *
 * **Agents author; they never decide** (ADR-0005). MCP exposes reads, draft writes and propose, and
 * **no decision surface at all**. That is not a filter applied to a general tool list: there is no
 * tool here that reaches a decision, and `DecisionService` is not imported by this module, its
 * transport, or anything they import — a lint rule refuses the import, and the decider's packet
 * reads a gate through `gate-view.ts` for that reason. A capability that does not exist cannot be
 * granted by mistake.
 *
 * Two consequences follow, and the first is the point. **Agent authority can be generous** — draft
 * freely, extract facets, propose — because the constraint sits at the point of consequence rather
 * than spread across everything an agent touches. And **the catalogue is readable here**, which is
 * what makes an agent governing a tenant able to ask one service "what governs this specification"
 * and get the standard's text, the tenant's acceptance and the recorded verdict in one place.
 */

import { z } from 'zod';
import { ArtifactService } from '../services/artifacts.js';
import { AcceptanceService, CatalogueReader } from '../services/catalogue.js';
import { EvaluationService } from '../services/evaluate.js';
import { LineageService } from '../services/lineage.js';
import { PacketService } from '../services/packet.js';
import { QuestionService } from '../services/questions.js';
import { excerpt } from '../services/render.js';
import type { RequestContext } from '../auth/context.js';
import type { ProvenanceMap } from '../domain/types.js';

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler(context: RequestContext, input: unknown): Promise<unknown>;
}

const services = (ctx: RequestContext) => {
  const catalogue = new CatalogueReader(ctx.catalogue);
  return {
    artifacts: new ArtifactService(ctx.handle, ctx.workspace),
    lineage: new LineageService(ctx.handle, ctx.workspace),
    catalogue,
    acceptances: new AcceptanceService(ctx.handle, catalogue),
    // No URL signer over MCP: an attachment reference is reported as unresolved rather than handed
    // to an agent as a signed URL it has no business forwarding.
    packets: new PacketService(ctx.handle, ctx.workspace, undefined),
    questions: new QuestionService(ctx.handle),
    evaluations: new EvaluationService(ctx.handle, ctx.workspace),
  };
};

export const TOOLS: McpTool[] = [
  {
    name: 'register',
    title: 'Read the register',
    description:
      'Everything in flight in this workspace with its lifecycle phase and latest state. Start here: it is the cheapest way to find what exists before reading anything in full.',
    inputSchema: z.object({}),
    async handler(ctx) {
      return { register: await services(ctx).artifacts.register() };
    },
  },
  {
    name: 'read_version',
    title: 'Read a version',
    description:
      'One immutable version in full — envelope, facets with provenance, body, links, and the standards it references. Provenance matters: a facet marked `extracted` without a `confirmed_by` has not been confirmed by a human and cannot reach a gate.',
    inputSchema: z.object({ artifact: z.string(), ordinal: z.number().int().positive().optional() }),
    async handler(ctx, input) {
      const { artifact, ordinal } = z
        .object({ artifact: z.string(), ordinal: z.number().int().positive().optional() })
        .parse(input);
      const svc = services(ctx);
      const version =
        ordinal === undefined
          ? ((await svc.artifacts.acceptedVersion(artifact)) ??
            (await svc.artifacts.getVersion(
              artifact,
              (await svc.artifacts.getArtifact(artifact)).latest_ordinal,
            )))
          : await svc.artifacts.getVersion(artifact, ordinal);
      return { version };
    },
  },
  {
    name: 'diff_versions',
    title: 'Diff two versions',
    description:
      'What changed between two versions of one artifact: facet diff, link diff and body diff. A pinned link can never appear as repointed, because the operation does not exist.',
    inputSchema: z.object({ artifact: z.string(), from: z.number().int(), to: z.number().int() }),
    async handler(ctx, input) {
      const { artifact, from, to } = z
        .object({ artifact: z.string(), from: z.number().int(), to: z.number().int() })
        .parse(input);
      return { diff: await services(ctx).lineage.diff(artifact, from, to) };
    },
  },
  {
    name: 'lineage',
    title: 'Trace lineage',
    description:
      'Follow the typed links out of and into an artifact, in both directions. Answers "why does this exist" backwards and "what happened to my idea" forwards. A frozen pin reports the ordinal it froze to, not the current one.',
    inputSchema: z.object({ artifact: z.string(), depth: z.number().int().min(1).max(8).default(4) }),
    async handler(ctx, input) {
      const { artifact, depth } = z
        .object({ artifact: z.string(), depth: z.number().int().min(1).max(8).default(4) })
        .parse(input);
      return { lineage: await services(ctx).lineage.lineage(artifact, depth) };
    },
  },
  {
    name: 'search',
    title: 'Search this workspace',
    description:
      'Full-text over facets and bodies, within this workspace only — search cannot cross a workspace boundary. Returns excerpts rather than whole bodies.',
    inputSchema: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) }),
    async handler(ctx, input) {
      const { query, limit } = z
        .object({ query: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) })
        .parse(input);
      const results = await services(ctx).artifacts.search(query, limit);
      return {
        results: results.map((r) => ({
          artifact: r.artifact,
          ordinal: r.ordinal,
          type: r.type,
          title: r.title,
          state: r.state,
          excerpt: excerpt(r.body ?? { format: 'text/v1', content: '' }),
        })),
      };
    },
  },
  {
    name: 'decision_packet',
    title: 'Read what a decider is being asked',
    description:
      'Everything a person needs to decide at a gate, in one call and in plain language: what the artifact is, what changed since the last decision, what the checks found, what each outcome would do, who may decide and why, and the decisions already taken. Use it to explain a pending decision to the human accountable for it, or to draft their reasoning. It contains no way to decide, and there is none on MCP.',
    inputSchema: z.object({ gate: z.string(), artifact: z.string(), ordinal: z.number().int().positive() }),
    async handler(ctx, input) {
      const { gate, artifact, ordinal } = z
        .object({ gate: z.string(), artifact: z.string(), ordinal: z.number().int().positive() })
        .parse(input);
      const svc = services(ctx);
      const version = await svc.artifacts.getVersion(artifact, ordinal);
      const acceptances = await svc.acceptances.statesFor(version.catalogue_refs);
      return {
        packet: await svc.packets.build(gate, artifact, ordinal, {
          decider: ctx.principal,
          roles: ctx.roles,
          routed: [],
          assigned: ctx.gates,
          directory: new Map(),
          acceptances,
        }),
      };
    },
  },
  {
    name: 'run_evaluations',
    title: 'Run the evaluations a gate requires',
    description:
      'Re-run every evaluation any gate on this version’s type requires, and record the verdicts against its digest. Use it when a gate says "no verdict has been recorded" and an evaluator has since become available. It records facts about the version; it decides nothing.',
    inputSchema: z.object({ artifact: z.string(), ordinal: z.number().int().positive() }),
    async handler(ctx, input) {
      const { artifact, ordinal } = z
        .object({ artifact: z.string(), ordinal: z.number().int().positive() })
        .parse(input);
      const svc = services(ctx);
      const version = await svc.artifacts.getVersion(artifact, ordinal);
      return { evaluations: await svc.evaluations.run(version) };
    },
  },
  {
    name: 'list_questions',
    title: 'Read the questions on a version',
    description:
      'Every question asked of one version, with its answers and whether a human has closed it. Open questions are what a decider is waiting on; if you can answer one from the version and the standards, do — a question a sponsor asked at 22:00 answered by 22:01 is the difference between a decision tomorrow and a decision next week.',
    inputSchema: z.object({ artifact: z.string(), ordinal: z.number().int().positive() }),
    async handler(ctx, input) {
      const { artifact, ordinal } = z
        .object({ artifact: z.string(), ordinal: z.number().int().positive() })
        .parse(input);
      return { questions: await services(ctx).questions.list(artifact, ordinal) };
    },
  },
  {
    name: 'ask_question',
    title: 'Ask a question of a version',
    description:
      'Attach a question to an immutable version. It never changes the version — the digest a decision cites is untouched — and it goes on the record, attributed to you as an agent. Ask when something in a version you are reviewing or explaining is genuinely unclear; do not ask what the version already answers.',
    inputSchema: z.object({
      artifact: z.string(),
      ordinal: z.number().int().positive(),
      text: z.string().min(1),
    }),
    async handler(ctx, input) {
      const { artifact, ordinal, text } = z
        .object({ artifact: z.string(), ordinal: z.number().int().positive(), text: z.string().min(1) })
        .parse(input);
      return { question: await services(ctx).questions.ask(artifact, ordinal, text, ctx.actor) };
    },
  },
  {
    name: 'answer_question',
    title: 'Answer a question',
    description:
      'Answer an open question on a version. Your answer is marked as an agent’s, so the reader knows what they are reading; cite the version, the facets, or a standard rather than asserting. Answering does not close the question — the person who asked decides whether they were answered, and there is no tool here that closes one.',
    inputSchema: z.object({ question: z.string(), text: z.string().min(1) }),
    async handler(ctx, input) {
      const { question, text } = z.object({ question: z.string(), text: z.string().min(1) }).parse(input);
      return { question: await services(ctx).questions.answer(question, text, ctx.actor) };
    },
  },
  {
    name: 'list_standards',
    title: 'List the standards in the catalogue',
    description:
      'The standards every tenant is governed against, read-only. `authority: ours` means the body is the full standard including the know-how; `authority: external` means the body is our summary and our reading, because the licence forbids more — check `licence_disposition` before quoting one.',
    inputSchema: z.object({ pack: z.string().optional(), type: z.string().optional() }),
    async handler(ctx, input) {
      const query = z.object({ pack: z.string().optional(), type: z.string().optional() }).parse(input);
      return { standards: await services(ctx).catalogue.list(query) };
    },
  },
  {
    name: 'read_standard',
    title: 'Read a standard in full',
    description:
      'One standard with its body and its machine-evaluable facets. For a platform standard this is the authoritative text; for an external one it is our summary, and the authoritative source is cited in the facets.',
    inputSchema: z.object({ artifact: z.string(), ordinal: z.number().int().positive().optional() }),
    async handler(ctx, input) {
      const { artifact, ordinal } = z
        .object({ artifact: z.string(), ordinal: z.number().int().positive().optional() })
        .parse(input);
      return { standard: await services(ctx).catalogue.read(artifact, ordinal) };
    },
  },
  {
    name: 'list_acceptances',
    title: 'Read which standards this workspace has accepted',
    description:
      'Who accepted each standard, when, and against which pack version. A `lapsed` status means a material change was published after the acceptance, so what was accepted is not what is now in force — treat any claim resting on it as unsupported until it is re-accepted.',
    inputSchema: z.object({}),
    async handler(ctx) {
      return { acceptances: await services(ctx).acceptances.list() };
    },
  },
  {
    name: 'create_draft',
    title: 'Start a draft',
    description:
      'Create a mutable draft, optionally on an existing artifact. Drafts are where authoring happens and are not records — nothing may cite one. Facets you supply should carry provenance `extracted` with your own principal as `by`; a human confirms them before they can reach a gate.',
    inputSchema: z.object({
      type: z.string(),
      title: z.string().min(1),
      artifact: z.string().optional(),
      facets: z.record(z.unknown()).optional(),
      body: z.object({ format: z.string(), content: z.string() }).optional(),
    }),
    async handler(ctx, input) {
      const parsed = z
        .object({
          type: z.string(),
          title: z.string().min(1),
          artifact: z.string().optional(),
          facets: z.record(z.unknown()).optional(),
          body: z.object({ format: z.string(), content: z.string() }).optional(),
        })
        .parse(input);

      // An agent's own writes are marked `extracted` and attributed to it. It cannot mark its own
      // work `declared`, which would claim a human wrote it.
      const at = new Date().toISOString();
      const provenance = Object.fromEntries(
        Object.keys(parsed.facets ?? {}).map((field) => [
          field,
          { source: 'extracted' as const, by: ctx.actor.principal, at },
        ]),
      );

      return { draft: await services(ctx).artifacts.createDraft({ ...parsed, provenance }, ctx.actor) };
    },
  },
  {
    name: 'save_draft',
    title: 'Edit a draft',
    description:
      'Save changes to a draft. Supply the `revision` you read; a stale one is refused with the current state rather than overwriting someone else’s edit. Changing a facet voids any human confirmation it carried.',
    inputSchema: z.object({
      draft: z.string(),
      revision: z.number().int().positive(),
      title: z.string().optional(),
      facets: z.record(z.unknown()).optional(),
      body: z.object({ format: z.string(), content: z.string() }).optional(),
    }),
    async handler(ctx, input) {
      const parsed = z
        .object({
          draft: z.string(),
          revision: z.number().int().positive(),
          title: z.string().optional(),
          facets: z.record(z.unknown()).optional(),
          body: z.object({ format: z.string(), content: z.string() }).optional(),
        })
        .parse(input);
      const { draft: id, ...rest } = parsed;

      const svc = services(ctx);
      let provenance: ProvenanceMap | undefined;
      if (rest.facets) {
        const current = await svc.artifacts.getDraft(id);
        const at = new Date().toISOString();
        // Carry the existing provenance forward and re-mark only what this call touched, so a
        // human's earlier confirmation on an untouched facet survives an agent editing its
        // neighbour.
        provenance = { ...current.provenance };
        for (const field of Object.keys(rest.facets)) {
          provenance[field] = { source: 'extracted', by: ctx.actor.principal, at };
        }
      }

      return {
        draft: await svc.artifacts.saveDraft(
          id,
          { ...rest, ...(provenance ? { provenance } : {}) },
          ctx.actor,
        ),
      };
    },
  },
  {
    name: 'read_document',
    title: 'Read a draft or a version as one document',
    description:
      'The whole artifact as one markdown document: front-matter carrying the title, classification, links and facets, then the body. Pass a draft id for the live draft, or an artifact and ordinal for an immutable version. This is the form to edit — change the document and save it with `save_document` rather than editing facets and body separately.',
    inputSchema: z.object({
      draft: z.string().optional(),
      artifact: z.string().optional(),
      ordinal: z.number().int().positive().optional(),
    }),
    async handler(ctx, input) {
      const { draft, artifact, ordinal } = z
        .object({
          draft: z.string().optional(),
          artifact: z.string().optional(),
          ordinal: z.number().int().positive().optional(),
        })
        .parse(input);
      const svc = services(ctx);
      if (draft) {
        const record = await svc.artifacts.getDraft(draft);
        return { document: svc.artifacts.documentOf(record), revision: record.revision };
      }
      if (!artifact) throw new Error('Pass a `draft`, or an `artifact` and `ordinal`.');
      const version =
        ordinal === undefined
          ? ((await svc.artifacts.acceptedVersion(artifact)) ??
            (await svc.artifacts.getVersion(
              artifact,
              (await svc.artifacts.getArtifact(artifact)).latest_ordinal,
            )))
          : await svc.artifacts.getVersion(artifact, ordinal);
      return {
        document: svc.artifacts.documentOf(version),
        digest: version.digest,
        ordinal: version.ordinal,
      };
    },
  },
  {
    name: 'save_document',
    title: 'Save a draft as one document',
    description:
      'Replace a draft with one markdown document: front-matter (title, classification, links, and every other key as a facet) and the body. Facets the type declares as body blocks — a table under a named heading — are read from the body. Every facet you write is marked `extracted` and attributed to you; a person confirms before it reaches a gate. Supply the `revision` you read.',
    inputSchema: z.object({ draft: z.string(), revision: z.number().int().positive(), document: z.string() }),
    async handler(ctx, input) {
      const { draft, revision, document } = z
        .object({ draft: z.string(), revision: z.number().int().positive(), document: z.string() })
        .parse(input);
      const svc = services(ctx);
      const saved = await svc.artifacts.saveDocument(draft, { revision, document }, ctx.actor);
      return { draft: saved, readiness: await svc.artifacts.readiness(draft) };
    },
  },
  {
    name: 'draft_readiness',
    title: 'What a draft still needs',
    description:
      'What stops this draft from being proposed, and what its gate will ask once it is — each missing facet as the question the schema asks, each unconfirmed extraction, a missing classification or pinned link. Read this before proposing, and after every save: it is the difference between a proposal and a 422.',
    inputSchema: z.object({ draft: z.string() }),
    async handler(ctx, input) {
      const { draft } = z.object({ draft: z.string() }).parse(input);
      return { readiness: await services(ctx).artifacts.readiness(draft) };
    },
  },
  {
    name: 'propose',
    title: 'Propose a version',
    description:
      'Snapshot a draft into an immutable version, in state `proposed`. This is as far as any agent goes: a proposed version waits for a named human to decide at a gate, and there is no tool here that decides one.',
    inputSchema: z.object({ draft: z.string() }),
    async handler(ctx, input) {
      const { draft } = z.object({ draft: z.string() }).parse(input);
      const svc = services(ctx);
      const version = await svc.artifacts.propose(draft, ctx.actor, 1_048_576);
      const evaluations = await svc.evaluations.run(version);
      return {
        version,
        evaluations,
        next: 'This version is `proposed`. A named human decides it at a gate; no MCP tool can.',
      };
    },
  },
];

export async function callTool(name: string, ctx: RequestContext, input: unknown): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool)
    throw new Error(`No MCP tool named \`${name}\`. Available: ${TOOLS.map((t) => t.name).join(', ')}.`);
  return tool.handler(ctx, input);
}
