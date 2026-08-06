/**
 * Gate decisions.
 *
 * A decision is immutable, attributed to a named human, and carries every evaluation in force at
 * the time plus the digest of exactly what was decided on. **The service never decides** — it
 * resolves who may, refuses everyone else, checks what the gate declared must be true, and records
 * the outcome a person chose.
 *
 * A refused decision is itself recorded. A control whose refusals are invisible is a control nobody
 * can audit, and "the system stopped me" needs to be a fact rather than a memory.
 */

import { ARTIFACTS, DECISIONS, DRAFTS, EVALUATIONS, VERSIONS } from '../db/collections.js';
import { emit } from '../db/outbox.js';
import type { WorkspaceHandle } from '../db/handle.js';
import { assertAttribution, checkAttribution } from '../domain/attribution.js';
import {
  gateIsOpen,
  gateRequirements,
  mayDecide,
  type AcceptanceState,
  type Requirement,
} from '../domain/gates.js';
import { mintDecisionId, mintDraftId } from '../domain/ids.js';
import { freezePins } from '../domain/links.js';
import { phaseAfterGate } from '../domain/lifecycle.js';
import { nextState } from '../domain/versioning.js';
import { gateIn, profileIn, typeIn } from '../domain/workspace-definition.js';
import type {
  Artifact,
  Attribution,
  Decision,
  Draft,
  EvaluationResult,
  Materiality,
  Principal,
  Version,
} from '../domain/types.js';
import { NotFound, Refused, type Actor } from './artifacts.js';
import type { LoadedWorkspace } from './workspaces.js';

export interface GateView {
  gate: string;
  artifact: string;
  ordinal: number;
  requirements: Requirement[];
  open: boolean;
  may_decide: boolean;
  may_decide_reason: string;
  outcomes: string[];
  attribution_profile: { id: string; required: string[]; optional: string[] };
}

export interface DecideInput {
  gate: string;
  artifact: string;
  ordinal: number;
  outcome: string;
  reasoning?: string;
  attribution: Attribution;
  /** Required when the gate declares `records_materiality` — a publication gate (ADR-0010). */
  materiality?: Materiality;
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

export class DecisionService {
  constructor(
    private readonly handle: WorkspaceHandle,
    private readonly workspace: LoadedWorkspace,
  ) {}

  private gateOrThrow(id: string) {
    const gate = gateIn(this.workspace.definition, id);
    if (!gate) {
      throw new NotFound(`Gate \`${id}\``);
    }
    return gate;
  }

  private async load(artifact: string, ordinal: number) {
    const version = await this.handle
      .collection<Version>(VERSIONS)
      .findOne({ artifact, ordinal }, { projection: { _id: 0 } });
    if (!version) throw new NotFound(`Version \`${artifact}@${ordinal}\``);
    const record = await this.handle.collection<Artifact>(ARTIFACTS).findOne({ id: artifact });
    if (!record) throw new NotFound(`Artifact \`${artifact}\``);
    const evaluations = await this.handle
      .collection<EvaluationResult>(EVALUATIONS)
      .find({ artifact, ordinal }, { projection: { _id: 0 } })
      .toArray();
    return { version, artifact: record, evaluations };
  }

  /** Who created the lineage, for `exclude_creator`. The first version's proposer. */
  private async creatorOf(artifact: string): Promise<string> {
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
    const gate = this.gateOrThrow(gateId);
    const { version, evaluations } = await this.load(artifactId, ordinal);

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

    return {
      gate: gate.id,
      artifact: artifactId,
      ordinal,
      requirements,
      open: gateIsOpen(requirements),
      may_decide: verdict.allowed,
      may_decide_reason: verdict.reason,
      outcomes: gate.outcomes,
      attribution_profile: { id: profile.id, required: profile.required, optional: profile.optional },
    };
  }

  /**
   * Record a decision.
   *
   * Everything below happens in one transaction with the outbox emission: the version's state, the
   * previous accepted version's supersession, the pin freezing, the phase transition, the reopened
   * draft, and the events describing all of it.
   */
  async decide(input: DecideInput, actor: Actor, context: DecisionContext): Promise<Decision> {
    const gate = this.gateOrThrow(input.gate);
    if (!gate.outcomes.includes(input.outcome)) {
      throw new Refused(
        `\`${input.outcome}\` is not an outcome of \`${gate.id}\`. Declared: ${gate.outcomes.join(', ')}.`,
      );
    }
    if (gate.records_materiality && !input.materiality) {
      throw new Refused(
        `\`${gate.id}\` records materiality, so this decision must classify the change as material or immaterial. ` +
          'A material change lapses every acceptance resting on the previous version, and inferring that from the fact that something changed would lapse acceptances on a typo.',
      );
    }

    const { version, artifact, evaluations } = await this.load(input.artifact, input.ordinal);
    const type = typeIn(this.workspace.definition, version.type)!;
    const profile = profileIn(this.workspace.definition, gate.attribution_profile)!;

    const requirements = gateRequirements({
      gate,
      facets: version.facets,
      provenance: version.provenance,
      evaluations,
      subject_digest: version.digest,
      acceptances: context.acceptances,
    });

    const verdict = mayDecide({
      gate,
      decider: context.decider,
      roles: context.roles,
      routed: context.routed,
      assigned: context.assigned,
      proposed_by: version.proposed_by,
      created_by: await this.creatorOf(input.artifact),
    });

    const attributionIssues = checkAttribution(profile, input.attribution, (id) => context.directory.get(id));
    const open = gateIsOpen(requirements);

    if (!verdict.allowed || !open || attributionIssues.length > 0) {
      await this.recordRefusal(input, actor, {
        may_decide: verdict.allowed,
        may_decide_reason: verdict.reason,
        unmet: requirements.filter((r) => r.blocking && !r.satisfied).map((r) => r.id),
        attribution_issues: attributionIssues,
      });
      if (!verdict.allowed) throw new Refused(verdict.reason);
      if (attributionIssues.length > 0)
        assertAttribution(profile, input.attribution, (id) => context.directory.get(id));
      throw new Refused(
        `\`${gate.id}\` cannot open: ${requirements
          .filter((r) => r.blocking && !r.satisfied)
          .map((r) => `${r.title} — ${r.detail}`)
          .join('; ')}`,
      );
    }

    const accepted = input.outcome === 'approve' || input.outcome === 'accept';
    const reopens = gate.reopens_on === input.outcome;
    const now = new Date().toISOString();

    return this.handle.transaction(async (session) => {
      const versions = this.handle.collection<Version>(VERSIONS);
      const state = nextState(version.state, {
        kind: 'gate_decision',
        outcome: accepted ? 'accept' : reopens ? 'reopen' : 'reject',
        gate: gate.id,
      });

      let links = version.links;
      if (accepted) {
        // Resolve every pin target's accepted ordinal *inside* the transaction, so the pin freezes
        // to what was accepted at this instant rather than to what was accepted when the screen
        // was rendered.
        const targets = version.links.map((l) => l.target);
        const rows = await versions
          .find(
            { artifact: { $in: targets }, state: 'accepted' },
            { session, projection: { artifact: 1, ordinal: 1 } },
          )
          .toArray();
        const acceptedByArtifact = new Map(rows.map((r) => [r.artifact, r.ordinal]));
        links = freezePins(version.links, type, (a) => acceptedByArtifact.get(a));
      }

      await versions.updateOne(
        { artifact: input.artifact, ordinal: input.ordinal },
        {
          $set: {
            state,
            links,
            decided_at: now,
            ...(input.materiality ? { materiality: input.materiality } : {}),
          },
        },
        { session },
      );

      let superseded: number | undefined;
      if (accepted && artifact.accepted_ordinal && artifact.accepted_ordinal !== input.ordinal) {
        const previous = await versions.findOne(
          { artifact: input.artifact, ordinal: artifact.accepted_ordinal },
          { session },
        );
        if (previous && previous.state === 'accepted') {
          await versions.updateOne(
            { artifact: input.artifact, ordinal: artifact.accepted_ordinal },
            { $set: { state: nextState('accepted', { kind: 'supersede', by_ordinal: input.ordinal }) } },
            { session },
          );
          superseded = artifact.accepted_ordinal;
        }
      }

      const phase = phaseAfterGate(this.workspace.definition, artifact.phase, gate.id, input.outcome);
      await this.handle.collection<Artifact>(ARTIFACTS).updateOne(
        { id: input.artifact },
        {
          $set: {
            ...(phase ? { phase } : {}),
            ...(accepted ? { accepted_ordinal: input.ordinal } : {}),
            updated_at: now,
          },
        },
        { session },
      );

      const decision: Decision = {
        id: mintDecisionId(),
        workspace: this.handle.workspace,
        gate: gate.id,
        artifact: input.artifact,
        ordinal: input.ordinal,
        subject_digest: version.digest,
        outcome: input.outcome,
        ...(input.reasoning ? { reasoning: input.reasoning } : {}),
        attribution: input.attribution,
        evaluations,
        decided_by: actor.principal,
        decided_at: now,
      };
      await this.handle.collection<Decision>(DECISIONS).insertOne(decision, { session });

      // A request_changes outcome opens a new draft based on the refused version, carrying the
      // reviewer's reasoning. The refused version stays in the record — the loop is visible, not
      // erased.
      let reopenedDraft: string | undefined;
      if (reopens) {
        reopenedDraft = mintDraftId();
        const draft: Draft = {
          id: reopenedDraft,
          workspace: this.handle.workspace,
          artifact: input.artifact,
          type: version.type,
          title: version.title,
          revision: 1,
          facets: version.facets,
          provenance: version.provenance,
          body: version.body,
          attachments: version.attachments,
          links: version.links,
          ...(version.catalogue_refs ? { catalogue_refs: version.catalogue_refs } : {}),
          ...(version.classification ? { classification: version.classification } : {}),
          ...(version.effective ? { effective: version.effective } : {}),
          contributors: version.contributors,
          based_on: version.ordinal,
          reopened_from_decision: decision.id,
          created_at: now,
          updated_at: now,
        };
        await this.handle.collection<Draft>(DRAFTS).insertOne(draft, { session });
      }

      await emit(this.handle.db, session, [
        {
          workspace: this.handle.workspace,
          kind: 'DecisionRecorded',
          subject: { artifact: input.artifact, ordinal: input.ordinal, decision: decision.id },
          actor: actor.principal,
          payload: {
            gate: gate.id,
            outcome: input.outcome,
            state,
            subject_digest: version.digest,
            attribution: input.attribution,
            ...(input.materiality ? { materiality: input.materiality } : {}),
            ...(phase ? { phase } : {}),
            ...(reopenedDraft ? { reopened_draft: reopenedDraft } : {}),
          },
          occurred_at: now,
        },
        ...(superseded !== undefined
          ? [
              {
                workspace: this.handle.workspace,
                kind: 'VersionSuperseded' as const,
                subject: { artifact: input.artifact, ordinal: superseded },
                actor: actor.principal,
                payload: { by_ordinal: input.ordinal },
                occurred_at: now,
              },
            ]
          : []),
        ...(accepted && links.some((l) => l.pinned_to != null)
          ? [
              {
                workspace: this.handle.workspace,
                kind: 'LinkPinned' as const,
                subject: { artifact: input.artifact, ordinal: input.ordinal },
                actor: actor.principal,
                payload: { links: links.filter((l) => l.pinned_to != null) },
                occurred_at: now,
              },
            ]
          : []),
      ]);

      return decision;
    });
  }

  /**
   * Record that a decision was refused, and why.
   *
   * A refusal is a real event on the record sink — "the system stopped me" needs to be a fact
   * rather than a memory, and a control whose refusals are invisible is one nobody can audit. It
   * goes through the ordinary outbox path so it is sequenced with everything else; there is no
   * state change to be atomic with, but the sequence still has to be allocated properly.
   */
  private async recordRefusal(input: DecideInput, actor: Actor, detail: Record<string, unknown>) {
    const now = new Date().toISOString();
    await this.handle.transaction(async (session) => {
      await emit(this.handle.db, session, [
        {
          workspace: this.handle.workspace,
          kind: 'DecisionRefused',
          subject: { artifact: input.artifact, ordinal: input.ordinal },
          actor: actor.principal,
          payload: { gate: input.gate, outcome: input.outcome, ...detail },
          occurred_at: now,
        },
      ]);
    });
  }

  async listDecisions(artifact: string): Promise<Decision[]> {
    return this.handle
      .collection<Decision>(DECISIONS)
      .find({ artifact }, { projection: { _id: 0 } })
      .sort({ decided_at: -1 })
      .toArray();
  }
}
