/**
 * The MCP surface — transport-agnostic.
 *
 * **Agents author; they never decide** (ADR-0005). MCP exposes reads, draft writes and propose, and
 * **no decision surface at all**. That is not a filter applied to a general tool list: there is no
 * tool here that reaches a decision, and `DecisionService` is not imported by this module or its
 * transport. A capability that does not exist cannot be granted by mistake.
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
import { LineageService } from '../services/lineage.js';
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
    name: 'propose',
    title: 'Propose a version',
    description:
      'Snapshot a draft into an immutable version, in state `proposed`. This is as far as any agent goes: a proposed version waits for a named human to decide at a gate, and there is no tool here that decides one.',
    inputSchema: z.object({ draft: z.string() }),
    async handler(ctx, input) {
      const { draft } = z.object({ draft: z.string() }).parse(input);
      const version = await services(ctx).artifacts.propose(draft, ctx.actor, 1_048_576);
      return {
        version,
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
