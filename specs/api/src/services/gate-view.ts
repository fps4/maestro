/**
 * The gate view — what must be true before a decision, and whether this principal may take one.
 *
 * Read-only, and kept apart from `DecisionService` on purpose: the MCP surface and the decider's
 * packet need to *show* a gate without being able to *pass* it. A module that imports this one has
 * imported nothing that can decide (ADR-0005).
 */

import { ARTIFACTS, EVALUATIONS, VERSIONS } from '../db/collections.js';
import type { WorkspaceHandle } from '../db/handle.js';
import {
  gateIsOpen,
  gateRequirements,
  mayDecide,
  type AcceptanceState,
  type Requirement,
} from '../domain/gates.js';
import { labelsFor } from '../domain/labels.js';
import type { Artifact, EvaluationResult, Principal, Version } from '../domain/types.js';
import { gateIn, profileIn } from '../domain/workspace-definition.js';
import { NotFound, Refused } from './artifacts.js';
import { QuestionService } from './questions.js';
import type { LoadedWorkspace } from './workspaces.js';

export interface GateView {
  gate: string;
  /** What the gate is called to a reader, and what it asks — from the definition, never an id. */
  title: string;
  description?: string;
  decides_on: string;
  type_title: string;
  artifact: string;
  ordinal: number;
  requirements: Requirement[];
  open: boolean;
  may_decide: boolean;
  may_decide_reason: string;
  outcomes: string[];
  /** Outcome id → the word on the button. The record carries the id; the person read the label. */
  outcome_labels: Record<string, string>;
  attribution_profile: {
    id: string;
    required: string[];
    optional: string[];
    field_labels: Record<string, string>;
  };
}

export interface DecisionContext {
  decider: Principal;
  roles: string[];
  routed: string[];
  assigned: string[];
  /** Principals a decision names, pre-loaded so the attribution check stays a pure function. */
  directory: Map<string, Principal>;
  acceptances: AcceptanceState[];
}

export class GateViewService {
  constructor(
    private readonly handle: WorkspaceHandle,
    private readonly workspace: LoadedWorkspace,
  ) {}

  /** Who created the lineage, for `exclude_creator`. The first version's proposer. */
  async creatorOf(artifact: string): Promise<string> {
    const first = await this.handle
      .collection<Version>(VERSIONS)
      .findOne({ artifact }, { sort: { ordinal: 1 }, projection: { proposed_by: 1 } });
    return first?.proposed_by ?? '';
  }

  /** Everything the console needs to render the decision screen, before anything is decided. */
  async view(
    gateId: string,
    artifactId: string,
    ordinal: number,
    context: DecisionContext,
  ): Promise<GateView> {
    const gate = gateIn(this.workspace.definition, gateId);
    if (!gate) throw new NotFound(`Gate \`${gateId}\``);
    const version = await this.handle
      .collection<Version>(VERSIONS)
      .findOne({ artifact: artifactId, ordinal }, { projection: { _id: 0 } });
    if (!version) throw new NotFound(`Version \`${artifactId}@${ordinal}\``);
    const record = await this.handle.collection<Artifact>(ARTIFACTS).findOne({ id: artifactId });
    if (!record) throw new NotFound(`Artifact \`${artifactId}\``);
    const evaluations = await this.handle
      .collection<EvaluationResult>(EVALUATIONS)
      .find({ artifact: artifactId, ordinal }, { projection: { _id: 0 } })
      .toArray();

    if (version.type !== gate.decides_on) {
      throw new Refused(
        `\`${gate.id}\` decides on \`${gate.decides_on}\`, and \`${artifactId}\` is a \`${version.type}\`.`,
      );
    }

    const requirements = gateRequirements({
      gate,
      facets: version.facets,
      provenance: version.provenance,
      evaluations,
      subject_digest: version.digest,
      acceptances: context.acceptances,
      open_questions: await new QuestionService(this.handle).openCount(version.artifact, version.ordinal),
    });

    const verdict = mayDecide({
      gate,
      decider: context.decider,
      roles: context.roles,
      routed: context.routed,
      assigned: context.assigned,
      proposed_by: version.proposed_by,
      created_by: await this.creatorOf(artifactId),
    });

    const profile = profileIn(this.workspace.definition, gate.attribution_profile)!;
    const labels = labelsFor(this.workspace.definition);
    const gateLabel = labels.gates[gate.id]!;

    return {
      gate: gate.id,
      title: gateLabel.title,
      ...(gateLabel.description ? { description: gateLabel.description } : {}),
      decides_on: gate.decides_on,
      type_title: labels.types[gate.decides_on]?.title ?? gate.decides_on,
      artifact: artifactId,
      ordinal,
      requirements,
      open: gateIsOpen(requirements),
      may_decide: verdict.allowed,
      may_decide_reason: verdict.reason,
      outcomes: gate.outcomes,
      outcome_labels: gateLabel.outcomes,
      attribution_profile: {
        id: profile.id,
        required: profile.required,
        optional: profile.optional,
        field_labels: Object.fromEntries(
          [...profile.required, ...profile.optional].map((f) => [f, labels.attribution[f] ?? f]),
        ),
      },
    };
  }
}
