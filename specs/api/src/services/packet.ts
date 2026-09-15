/**
 * The decider's packet — everything a person needs to decide, in one call.
 *
 * The decision screen used to assemble this from four requests and leave the reader to join them.
 * An agent asked "what am I being asked to approve?" had to do the same join, and every client did
 * it slightly differently. This is the one answer, built once, in plain language, and returned the
 * same way to the console, the API and MCP — which is what lets an agent explain a decision to a
 * sponsor without inventing anything the service did not say.
 *
 * It contains no way to decide. It is what you read *before* deciding.
 */

import { DECISIONS, EVALUATIONS, VERSIONS } from '../db/collections.js';
import type { WorkspaceHandle } from '../db/handle.js';
import { consequencesOf, type OutcomeConsequence } from '../domain/consequences.js';
import { facetDiff, linkDiff, bodyDiff, type FacetChange, type LinkDiff } from '../domain/diff.js';
import type { Requirement } from '../domain/gates.js';
import { humanise, labelsFor } from '../domain/labels.js';
import type { Decision, EvaluationResult, Version } from '../domain/types.js';
import { gateIn, typeIn } from '../domain/workspace-definition.js';
import { ArtifactService, NotFound } from './artifacts.js';
import type { UrlSigner } from './attachments.js';
import { GateViewService, type DecisionContext } from './gate-view.js';
import { renderVersion, type RenderedBody } from './render.js';
import type { LoadedWorkspace } from './workspaces.js';

export interface PacketFacet {
  field: string;
  /** The schema's `title`, or the humanised field name. */
  label: string;
  /** The schema's `description` — the plain-language question this facet answers. */
  description?: string;
  value: unknown;
  source: 'declared' | 'extracted' | 'reconstructed' | 'unattributed';
  confirmed: boolean;
}

export interface PacketCheck extends Requirement {
  /** Per-standard findings, when the requirement is an evaluation that reported them. */
  findings?: EvaluationResult['findings'];
}

export interface PacketSince {
  ordinal: number;
  state: Version['state'];
  decided_at?: string;
  outcome?: { id: string; label: string };
  facets: Array<FacetChange & { label: string }>;
  links: LinkDiff;
  body: { unchanged: boolean; added_lines: number; removed_lines: number };
}

export interface PacketHistoryEntry {
  ordinal: number;
  gate: string;
  gate_title: string;
  outcome: string;
  outcome_label: string;
  decided_by: string;
  decided_at: string;
  reasoning?: string;
}

export interface DecisionPacket {
  gate: {
    id: string;
    title: string;
    description?: string;
    decides_on: string;
    type_title: string;
    type_description?: string;
  };
  subject: {
    artifact: string;
    ordinal: number;
    title: string;
    state: Version['state'];
    digest: string;
    phase: string;
    phase_label: string;
    proposed_by: string;
    proposed_at: string;
    contributors: Version['contributors'];
  };
  document: RenderedBody & { markdown: string };
  facets: PacketFacet[];
  /** What changed since the last version anyone decided on. Null the first time a decision is taken. */
  since: PacketSince | null;
  checks: PacketCheck[];
  open: boolean;
  decider: {
    may_decide: boolean;
    reason: string;
    outcomes: OutcomeConsequence[];
    attribution: { required: string[]; optional: string[]; field_labels: Record<string, string> };
  };
  history: PacketHistoryEntry[];
}

export class PacketService {
  constructor(
    private readonly handle: WorkspaceHandle,
    private readonly workspace: LoadedWorkspace,
    private readonly signUrls: UrlSigner | undefined,
  ) {}

  async build(
    gateId: string,
    artifactId: string,
    ordinal: number,
    context: DecisionContext,
  ): Promise<DecisionPacket> {
    const artifacts = new ArtifactService(this.handle, this.workspace);
    const gates = new GateViewService(this.handle, this.workspace);
    const def = this.workspace.definition;
    const labels = labelsFor(def);

    const gate = gateIn(def, gateId);
    if (!gate) throw new NotFound(`Gate \`${gateId}\``);

    const [view, version, artifact] = await Promise.all([
      gates.view(gateId, artifactId, ordinal, context),
      artifacts.getVersion(artifactId, ordinal),
      artifacts.getArtifact(artifactId),
    ]);
    const type = typeIn(def, version.type)!;

    const evaluations = await this.handle
      .collection<EvaluationResult>(EVALUATIONS)
      .find({ artifact: artifactId, ordinal }, { projection: { _id: 0 } })
      .toArray();

    const history = await this.handle
      .collection<Decision>(DECISIONS)
      .find({ artifact: artifactId }, { projection: { _id: 0 } })
      .sort({ decided_at: -1 })
      .toArray();

    // Link targets: what a pin would freeze to, and what to call each target.
    const targets = version.links.map((l) => l.target);
    const acceptedByArtifact = await artifacts.acceptedOrdinals(targets);
    const targetTitles = new Map<string, string>();
    for (const target of targets) {
      try {
        targetTitles.set(target, (await artifacts.getArtifact(target)).title);
      } catch {
        // A link to something that no longer resolves is shown by id; the pin logic reports it.
      }
    }

    const schema = (this.workspace.facet_schemas[version.type] ?? {}) as {
      properties?: Record<string, { title?: string; description?: string }>;
    };
    const facetLabel = (field: string) => schema.properties?.[field]?.title ?? humanise(field);

    return {
      gate: {
        id: gate.id,
        title: view.title,
        ...(view.description ? { description: view.description } : {}),
        decides_on: gate.decides_on,
        type_title: view.type_title,
        ...(labels.types[gate.decides_on]?.description
          ? { type_description: labels.types[gate.decides_on]!.description }
          : {}),
      },
      subject: {
        artifact: artifactId,
        ordinal,
        title: version.title,
        state: version.state,
        digest: version.digest,
        phase: artifact.phase,
        phase_label: labels.phases[artifact.phase] ?? humanise(artifact.phase),
        proposed_by: version.proposed_by,
        proposed_at: version.proposed_at,
        contributors: version.contributors,
      },
      document: { ...(await renderVersion(version, this.signUrls)), markdown: version.body.content },
      facets: Object.entries(version.facets).map(([field, value]) => {
        const provenance = version.provenance[field];
        return {
          field,
          label: facetLabel(field),
          ...(schema.properties?.[field]?.description
            ? { description: schema.properties[field]!.description }
            : {}),
          value,
          source: provenance?.source ?? 'unattributed',
          confirmed: provenance?.source === 'declared' || Boolean(provenance?.confirmed_by),
        };
      }),
      since: await this.since(version, history, facetLabel, labels.gates),
      checks: view.requirements.map((requirement) => {
        const evaluator = requirement.id.startsWith('evaluation:')
          ? requirement.id.slice('evaluation:'.length)
          : undefined;
        const result = evaluator
          ? evaluations.find((e) => e.evaluator === evaluator && e.subject_digest === version.digest)
          : undefined;
        return { ...requirement, ...(result?.findings ? { findings: result.findings } : {}) };
      }),
      open: view.open,
      decider: {
        may_decide: view.may_decide,
        reason: view.may_decide_reason,
        outcomes: consequencesOf({
          def,
          gate,
          type,
          labels,
          version,
          artifact,
          acceptedByArtifact,
          targetTitles,
        }),
        attribution: {
          required: view.attribution_profile.required,
          optional: view.attribution_profile.optional,
          field_labels: view.attribution_profile.field_labels,
        },
      },
      history: history.map((d) => ({
        ordinal: d.ordinal,
        gate: d.gate,
        gate_title: labels.gates[d.gate]?.title ?? humanise(d.gate),
        outcome: d.outcome,
        outcome_label: labels.gates[d.gate]?.outcomes[d.outcome] ?? humanise(d.outcome),
        decided_by: d.decided_by,
        decided_at: d.decided_at,
        ...(d.reasoning ? { reasoning: d.reasoning } : {}),
      })),
    };
  }

  /**
   * What changed since the last version anyone took a decision on.
   *
   * Not "since the previous ordinal": a reviewer who asked for changes at @2 and is now looking at
   * @4 wants to know what moved since @2, and @3 may have been withdrawn without anyone reading it.
   */
  private async since(
    version: Version,
    history: Decision[],
    facetLabel: (field: string) => string,
    gateLabels: ReturnType<typeof labelsFor>['gates'],
  ): Promise<PacketSince | null> {
    const last = history
      .filter((d) => d.ordinal < version.ordinal)
      .sort((a, b) => b.ordinal - a.ordinal || b.decided_at.localeCompare(a.decided_at))[0];
    if (!last) return null;

    const previous = await this.handle
      .collection<Version>(VERSIONS)
      .findOne({ artifact: version.artifact, ordinal: last.ordinal }, { projection: { _id: 0 } });
    if (!previous) return null;

    const facets = facetDiff(previous.facets, version.facets, previous.provenance, version.provenance);
    const body = bodyDiff(previous.body, version.body);
    return {
      ordinal: previous.ordinal,
      state: previous.state,
      ...(previous.decided_at ? { decided_at: previous.decided_at } : {}),
      outcome: {
        id: last.outcome,
        label: gateLabels[last.gate]?.outcomes[last.outcome] ?? humanise(last.outcome),
      },
      facets: facets.changes.map((change) => ({ ...change, label: facetLabel(change.field) })),
      links: linkDiff(previous.links, version.links),
      body: {
        unchanged: body.unchanged,
        added_lines: body.hunks.filter((h) => h.kind === 'added').reduce((n, h) => n + h.lines.length, 0),
        removed_lines: body.hunks.filter((h) => h.kind === 'removed').reduce((n, h) => n + h.lines.length, 0),
      },
    };
  }
}
