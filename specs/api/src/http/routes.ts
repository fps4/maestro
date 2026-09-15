/**
 * Routes. Thin by rule: validate, resolve a context, call a service, map errors.
 *
 * No business logic lives here. Anything that decides something belongs in `domain/`, and anything
 * that decides something *about stored data* belongs in `services/` — which is what made the MCP
 * surface additive rather than a fork: it is a second caller of the same service functions.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  buildContext,
  Forbidden,
  requireRole,
  type ContextDeps,
  type RequestContext,
} from '../auth/context.js';
import { Unauthenticated, type TokenVerifier } from '../auth/verify.js';
import { AttributionRefused } from '../domain/attribution.js';
import { FacetValidationError } from '../domain/facets.js';
import { PinRefused } from '../domain/links.js';
import { IllegalStateChange, ProposalRefused, StaleRevision } from '../domain/versioning.js';
import { DefinitionError } from '../domain/workspace-definition.js';
import { labelsFor } from '../domain/labels.js';
import { ArtifactService, NotFound, Refused } from '../services/artifacts.js';
import { AcceptanceService, CatalogueReader } from '../services/catalogue.js';
import { DecisionService } from '../services/decisions.js';
import { EvaluationService } from '../services/evaluate.js';
import { LineageService } from '../services/lineage.js';
import { PacketService } from '../services/packet.js';
import { PrincipalDirectory } from '../services/principals.js';
import { QuestionService } from '../services/questions.js';
import { renderVersion } from '../services/render.js';
import type { UrlSigner } from '../services/attachments.js';
import type { Principal } from '../domain/types.js';
import type { Config } from '../config.js';

export interface RouteDeps extends ContextDeps {
  config: Config;
  verifier: TokenVerifier;
  /** Signs short-lived URLs for attachment keys. Absent when no object storage is configured. */
  signUrls?: UrlSigner;
}

const body = z.object({ format: z.string(), content: z.string() });
const link = z.object({
  type: z.string(),
  target: z.string(),
  pinned_to: z.number().int().nullable().optional(),
});
const catalogueRef = z.object({
  standard: z.string(),
  ordinal: z.number().int().positive(),
  pack: z.string(),
  pack_version: z.string(),
});
const classification = z.object({
  lawful_basis: z.string(),
  retention: z.string(),
  personal_data: z.boolean(),
  subject_refs: z.array(z.string()).optional(),
});
const effective = z.object({
  effective_from: z.string().optional(),
  effective_to: z.string().nullable().optional(),
  lapse_behaviour: z.enum(['fail', 'unregulated', 'freeze_at_last']).optional(),
});
const provenance = z.record(
  z.object({
    source: z.enum(['declared', 'extracted', 'reconstructed']),
    by: z.string(),
    confirmed_by: z.string().optional(),
    confirmed_at: z.string().optional(),
    at: z.string(),
  }),
);

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { config } = deps;

  app.get('/health', async () => ({ status: 'ok' }));

  // Published only when an MCP resource URL is configured, because it is a promise about a surface
  // that may not be exposed.
  if (config.MCP_RESOURCE_URL) {
    app.get('/.well-known/oauth-protected-resource', async () => ({
      resource: config.MCP_RESOURCE_URL,
      authorization_servers: [config.AUTH_ISSUER],
      bearer_methods_supported: ['header'],
    }));
  }

  async function context(request: FastifyRequest, workspace: string): Promise<RequestContext> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new Unauthenticated('This endpoint needs a bearer token.');
    const token = await deps.verifier.verify(header.slice('Bearer '.length));
    return buildContext(deps, token, workspace);
  }

  function services(ctx: RequestContext) {
    const reader = new CatalogueReader(ctx.catalogue);
    return {
      artifacts: new ArtifactService(ctx.handle, ctx.workspace),
      decisions: new DecisionService(ctx.handle, ctx.workspace),
      lineage: new LineageService(ctx.handle, ctx.workspace),
      catalogue: reader,
      acceptances: new AcceptanceService(ctx.handle, reader),
      evaluations: new EvaluationService(ctx.handle, ctx.workspace),
    };
  }

  const ws = z.object({ ws: z.string() });

  // --- workspace ---

  app.get('/v1/workspaces', async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new Unauthenticated('This endpoint needs a bearer token.');
    await deps.verifier.verify(header.slice('Bearer '.length));
    return { workspaces: await deps.registry.list() };
  });

  app.get('/v1/workspaces/:ws/definition', async (request) => {
    const { ws: workspace } = ws.parse(request.params);
    const ctx = await context(request, workspace);
    return {
      record: ctx.workspace.record,
      definition: ctx.workspace.definition,
      facet_schemas: ctx.workspace.facet_schemas,
      // Every identifier the definition declares, as the word a reader should see for it.
      labels: labelsFor(ctx.workspace.definition),
    };
  });

  app.get('/v1/workspaces/:ws/register', async (request) => {
    const { ws: workspace } = ws.parse(request.params);
    const ctx = await context(request, workspace);
    return { register: await services(ctx).artifacts.register() };
  });

  app.get('/v1/workspaces/:ws/search', async (request) => {
    const { ws: workspace } = ws.parse(request.params);
    const { q, limit } = z
      .object({ q: z.string().min(1), limit: z.coerce.number().int().positive().max(100).default(25) })
      .parse(request.query);
    const ctx = await context(request, workspace);
    return { results: await services(ctx).artifacts.search(q, limit) };
  });

  // --- drafts ---

  const createDraft = z.object({
    type: z.string(),
    title: z.string().min(1),
    artifact: z.string().optional(),
    facets: z.record(z.unknown()).optional(),
    provenance: provenance.optional(),
    body: body.optional(),
    links: z.array(link).optional(),
    catalogue_refs: z.array(catalogueRef).optional(),
    classification: classification.optional(),
    effective: effective.optional(),
  });

  app.post('/v1/workspaces/:ws/drafts', async (request, reply) => {
    const { ws: workspace } = ws.parse(request.params);
    const ctx = await context(request, workspace);
    requireRole(ctx, 'author');
    const draft = await services(ctx).artifacts.createDraft(createDraft.parse(request.body), ctx.actor);
    return reply.code(201).send({ draft });
  });

  app.get('/v1/workspaces/:ws/drafts', async (request) => {
    const { ws: workspace } = ws.parse(request.params);
    const ctx = await context(request, workspace);
    return { drafts: await services(ctx).artifacts.listDrafts() };
  });

  app.get('/v1/workspaces/:ws/drafts/:id', async (request) => {
    const { ws: workspace, id } = ws.extend({ id: z.string() }).parse(request.params);
    const ctx = await context(request, workspace);
    return { draft: await services(ctx).artifacts.getDraft(id) };
  });

  const saveDraft = createDraft
    .partial()
    .omit({ type: true, artifact: true })
    .extend({ revision: z.number().int().positive() });

  app.patch('/v1/workspaces/:ws/drafts/:id', async (request) => {
    const { ws: workspace, id } = ws.extend({ id: z.string() }).parse(request.params);
    const ctx = await context(request, workspace);
    requireRole(ctx, 'author');
    return { draft: await services(ctx).artifacts.saveDraft(id, saveDraft.parse(request.body), ctx.actor) };
  });

  app.post('/v1/workspaces/:ws/drafts/:id/confirm', async (request) => {
    const { ws: workspace, id } = ws.extend({ id: z.string() }).parse(request.params);
    const { fields } = z.object({ fields: z.array(z.string()).min(1) }).parse(request.body);
    const ctx = await context(request, workspace);
    return { draft: await services(ctx).artifacts.confirmFacets(id, fields, ctx.actor) };
  });

  app.get('/v1/workspaces/:ws/drafts/:id/readiness', async (request) => {
    const { ws: workspace, id } = ws.extend({ id: z.string() }).parse(request.params);
    const ctx = await context(request, workspace);
    return { readiness: await services(ctx).artifacts.readiness(id) };
  });

  app.post('/v1/workspaces/:ws/drafts/:id/propose', async (request, reply) => {
    const { ws: workspace, id } = ws.extend({ id: z.string() }).parse(request.params);
    const ctx = await context(request, workspace);
    requireRole(ctx, 'author');
    const svc = services(ctx);
    const version = await svc.artifacts.propose(id, ctx.actor, config.BODY_CEILING_BYTES);
    // The evaluations a gate requires run against the version as soon as it exists. They are facts
    // about the digest, recorded outside the proposal's transaction; an unavailable evaluator is
    // reported here rather than leaving the reader to wonder why the gate says "no verdict".
    const evaluations = await svc.evaluations.run(version);
    return reply.code(201).send({ version, evaluations });
  });

  app.delete('/v1/workspaces/:ws/drafts/:id', async (request, reply) => {
    const { ws: workspace, id } = ws.extend({ id: z.string() }).parse(request.params);
    const ctx = await context(request, workspace);
    requireRole(ctx, 'author');
    await services(ctx).artifacts.discardDraft(id);
    return reply.code(204).send();
  });

  // --- artifacts and versions ---

  const artifactParams = ws.extend({ id: z.string() });

  app.get('/v1/workspaces/:ws/artifacts/:id', async (request) => {
    const { ws: workspace, id } = artifactParams.parse(request.params);
    const ctx = await context(request, workspace);
    const svc = services(ctx);
    const [artifact, versions, decisions] = await Promise.all([
      svc.artifacts.getArtifact(id),
      svc.artifacts.listVersions(id),
      svc.lineage.decisions(id),
    ]);
    return { artifact, versions, decisions };
  });

  app.get('/v1/workspaces/:ws/artifacts/:id/versions/:ordinal', async (request) => {
    const {
      ws: workspace,
      id,
      ordinal,
    } = artifactParams.extend({ ordinal: z.coerce.number().int() }).parse(request.params);
    const { render } = z.object({ render: z.coerce.boolean().default(false) }).parse(request.query);
    const ctx = await context(request, workspace);
    const version = await services(ctx).artifacts.getVersion(id, ordinal);
    if (!render) return { version };
    return { version, rendered: await renderVersion(version, deps.signUrls) };
  });

  /** Re-run every evaluation a gate requires — after an evaluator comes online, or on demand. */
  app.post('/v1/workspaces/:ws/artifacts/:id/versions/:ordinal/evaluate', async (request) => {
    const {
      ws: workspace,
      id,
      ordinal,
    } = artifactParams.extend({ ordinal: z.coerce.number().int() }).parse(request.params);
    const ctx = await context(request, workspace);
    const svc = services(ctx);
    const version = await svc.artifacts.getVersion(id, ordinal);
    return { evaluations: await svc.evaluations.run(version) };
  });

  app.get('/v1/workspaces/:ws/artifacts/:id/diff', async (request) => {
    const { ws: workspace, id } = artifactParams.parse(request.params);
    const { from, to } = z
      .object({ from: z.coerce.number().int(), to: z.coerce.number().int() })
      .parse(request.query);
    const ctx = await context(request, workspace);
    return { diff: await services(ctx).lineage.diff(id, from, to) };
  });

  app.get('/v1/workspaces/:ws/artifacts/:id/lineage', async (request) => {
    const { ws: workspace, id } = artifactParams.parse(request.params);
    const { depth } = z
      .object({ depth: z.coerce.number().int().min(1).max(8).default(4) })
      .parse(request.query);
    const ctx = await context(request, workspace);
    return { lineage: await services(ctx).lineage.lineage(id, depth) };
  });

  // --- questions on a version: asked by anyone, answered by anyone, closed by a human ---

  const versionParams = artifactParams.extend({ ordinal: z.coerce.number().int().positive() });
  const questionText = z.object({ text: z.string().min(1).max(4000) });

  app.get('/v1/workspaces/:ws/artifacts/:id/versions/:ordinal/questions', async (request) => {
    const { ws: workspace, id, ordinal } = versionParams.parse(request.params);
    const ctx = await context(request, workspace);
    return { questions: await new QuestionService(ctx.handle).list(id, ordinal) };
  });

  app.post('/v1/workspaces/:ws/artifacts/:id/versions/:ordinal/questions', async (request, reply) => {
    const { ws: workspace, id, ordinal } = versionParams.parse(request.params);
    const { text } = questionText.parse(request.body);
    const ctx = await context(request, workspace);
    const question = await new QuestionService(ctx.handle).ask(id, ordinal, text, ctx.actor);
    return reply.code(201).send({ question });
  });

  const questionParams = versionParams.extend({ question: z.string() });

  app.post(
    '/v1/workspaces/:ws/artifacts/:id/versions/:ordinal/questions/:question/answers',
    async (request, reply) => {
      const { ws: workspace, question } = questionParams.parse(request.params);
      const { text } = questionText.parse(request.body);
      const ctx = await context(request, workspace);
      const updated = await new QuestionService(ctx.handle).answer(question, text, ctx.actor);
      return reply.code(201).send({ question: updated });
    },
  );

  app.post(
    '/v1/workspaces/:ws/artifacts/:id/versions/:ordinal/questions/:question/resolve',
    async (request) => {
      const { ws: workspace, question } = questionParams.parse(request.params);
      const ctx = await context(request, workspace);
      return { question: await new QuestionService(ctx.handle).resolve(question, ctx.actor) };
    },
  );

  // --- gates ---

  const gateParams = ws.extend({ gate: z.string(), id: z.string(), ordinal: z.coerce.number().int() });

  app.get('/v1/workspaces/:ws/gates/:gate/:id/:ordinal', async (request) => {
    const { ws: workspace, gate, id, ordinal } = gateParams.parse(request.params);
    const ctx = await context(request, workspace);
    const svc = services(ctx);
    const version = await svc.artifacts.getVersion(id, ordinal);
    const acceptances = await svc.acceptances.statesFor(version.catalogue_refs);
    return {
      view: await svc.decisions.view(gate, id, ordinal, {
        decider: ctx.principal,
        roles: ctx.roles,
        routed: [],
        assigned: ctx.gates,
        directory: new Map(),
        acceptances,
      }),
    };
  });

  /**
   * The decider's packet: everything a person needs to decide, in one call and in plain language.
   * The same object reaches the console and MCP, so an agent explaining a decision to a sponsor is
   * reading what the sponsor's screen reads.
   */
  app.get('/v1/workspaces/:ws/gates/:gate/:id/:ordinal/packet', async (request) => {
    const { ws: workspace, gate, id, ordinal } = gateParams.parse(request.params);
    const ctx = await context(request, workspace);
    const svc = services(ctx);
    const version = await svc.artifacts.getVersion(id, ordinal);
    const acceptances = await svc.acceptances.statesFor(version.catalogue_refs);
    const packets = new PacketService(ctx.handle, ctx.workspace, deps.signUrls);
    return {
      packet: await packets.build(gate, id, ordinal, {
        decider: ctx.principal,
        roles: ctx.roles,
        routed: [],
        assigned: ctx.gates,
        directory: new Map(),
        acceptances,
      }),
    };
  });

  const decide = z.object({
    artifact: z.string(),
    ordinal: z.number().int().positive(),
    outcome: z.string(),
    reasoning: z.string().optional(),
    // `accountable` and `acting` are optional on the wire: the server fills them from the session.
    attribution: z.record(z.string()).default({}),
    materiality: z.enum(['material', 'immaterial']).optional(),
  });

  app.post('/v1/workspaces/:ws/gates/:gate/decisions', async (request, reply) => {
    const { ws: workspace, gate } = ws.extend({ gate: z.string() }).parse(request.params);
    const input = decide.parse(request.body);
    const ctx = await context(request, workspace);
    const svc = services(ctx);

    const version = await svc.artifacts.getVersion(input.artifact, input.ordinal);
    const acceptances = await svc.acceptances.statesFor(version.catalogue_refs);

    // `accountable` and `acting` default to the authenticated principal, and a caller cannot name
    // someone else as accountable — that is the one field an attacker would most want to choose,
    // and "who is answerable for this" is not a claim a client gets to make. Supplying your own id
    // is permitted because it is what the default already is; naming anyone else is refused here
    // rather than being caught later by the profile's kind rule, which would only stop an *agent*.
    for (const field of ['accountable', 'acting'] as const) {
      const supplied = input.attribution[field];
      if (supplied && supplied !== ctx.principal.id) {
        throw new Forbidden(
          `\`${field}\` is resolved from your session and cannot be set to another principal. You are \`${ctx.principal.id}\`.`,
        );
      }
    }
    const attribution = { ...input.attribution, accountable: ctx.principal.id, acting: ctx.principal.id };

    // Load every principal the attribution names, so the check stays a pure function over data
    // rather than a function that reaches for a database mid-rule.
    const named = Object.values(attribution).filter((v): v is string => typeof v === 'string');
    const records = await deps.directory.getMany([...named, ctx.principal.id]);
    const directory = new Map<string, Principal>(records);

    const decision = await svc.decisions.decide({ gate, ...input, attribution }, ctx.actor, {
      decider: ctx.principal,
      roles: ctx.roles,
      routed: [],
      assigned: ctx.gates,
      directory,
      acceptances,
    });
    return reply.code(201).send({ decision });
  });

  // --- evaluations: the service records a verdict and never computes one ---

  const evaluation = z.object({
    evaluator: z.string(),
    artifact: z.string(),
    ordinal: z.number().int().positive(),
    verdict: z.enum(['pass', 'fail', 'not_applicable']),
    subject_digest: z.string(),
    findings: z
      .array(
        z.object({
          standard: z.string().optional(),
          outcome: z.enum(['met', 'unmet', 'not_applicable', 'unsupported']),
          detail: z.string().optional(),
        }),
      )
      .optional(),
  });

  app.post('/v1/workspaces/:ws/evaluations', async (request, reply) => {
    const { ws: workspace } = ws.parse(request.params);
    const input = evaluation.parse(request.body);
    const ctx = await context(request, workspace);

    // A verdict against bytes we do not hold is not a verdict about anything here.
    const version = await services(ctx).artifacts.getVersion(input.artifact, input.ordinal);
    if (version.digest !== input.subject_digest) {
      throw new Refused(
        `This verdict names digest ${input.subject_digest}, and ${input.artifact}@${input.ordinal} is ${version.digest}. ` +
          'A verdict reached against different bytes is not a verdict about this version.',
      );
    }

    const record = await services(ctx).evaluations.record(input);
    return reply.code(201).send({ evaluation: record });
  });

  // --- standards: the catalogue, and this workspace's acceptances ---

  app.get('/v1/workspaces/:ws/catalogue/standards', async (request) => {
    const { ws: workspace } = ws.parse(request.params);
    const query = z.object({ pack: z.string().optional(), type: z.string().optional() }).parse(request.query);
    const ctx = await context(request, workspace);
    return { standards: await services(ctx).catalogue.list(query) };
  });

  app.get('/v1/workspaces/:ws/catalogue/standards/:artifact', async (request) => {
    const { ws: workspace, artifact } = ws.extend({ artifact: z.string() }).parse(request.params);
    const { ordinal } = z.object({ ordinal: z.coerce.number().int().optional() }).parse(request.query);
    const ctx = await context(request, workspace);
    const version = await services(ctx).catalogue.read(artifact, ordinal);
    if (!version) throw new NotFound(`Standard \`${artifact}\``);
    return { standard: version, rendered: await renderVersion(version, deps.signUrls) };
  });

  app.get('/v1/workspaces/:ws/acceptances', async (request) => {
    const { ws: workspace } = ws.parse(request.params);
    const ctx = await context(request, workspace);
    return { acceptances: await services(ctx).acceptances.list() };
  });

  app.post('/v1/workspaces/:ws/acceptances/refresh', async (request) => {
    const { ws: workspace } = ws.parse(request.params);
    const ctx = await context(request, workspace);
    requireRole(ctx, 'workspace_admin');
    return await services(ctx).acceptances.refresh();
  });

  app.setErrorHandler(errorHandler);
}

/**
 * One place that decides what an error means over HTTP.
 *
 * Every message here is written for the person who hit it: what was refused, and what would make it
 * work. A 400 saying "invalid" costs the reader a support conversation.
 */
export function errorHandler(error: Error, _request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof Unauthenticated)
    return reply.code(401).send({ error: 'unauthenticated', message: error.message });
  if (error instanceof Forbidden) return reply.code(403).send({ error: 'forbidden', message: error.message });
  if (error instanceof NotFound) return reply.code(404).send({ error: 'not_found', message: error.message });
  if (error instanceof StaleRevision) {
    return reply.code(409).send({
      error: 'stale_revision',
      message: error.message,
      expected: error.expected,
      actual: error.actual,
    });
  }
  if (error instanceof FacetValidationError) {
    return reply.code(422).send({ error: 'facets_invalid', message: error.message, issues: error.issues });
  }
  if (error instanceof AttributionRefused) {
    return reply
      .code(422)
      .send({ error: 'attribution_refused', message: error.message, issues: error.issues });
  }
  if (error instanceof ProposalRefused) {
    return reply
      .code(422)
      .send({ error: 'proposal_refused', message: error.message, reasons: error.reasons });
  }
  if (error instanceof DefinitionError) {
    return reply
      .code(422)
      .send({ error: 'definition_invalid', message: error.message, issues: error.issues });
  }
  if (error instanceof PinRefused || error instanceof IllegalStateChange || error instanceof Refused) {
    return reply.code(422).send({ error: 'refused', message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: 'invalid_request',
      message: 'The request body or query does not match what this endpoint accepts.',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return reply.code(500).send({ error: 'internal', message: error.message });
}

export { PrincipalDirectory };
