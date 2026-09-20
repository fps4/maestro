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

import type { Act, Recorder } from '../db/outbox.js';
import { Conflict, type WorkspaceHandle } from '../db/handle.js';
import { assertAttribution, checkAttribution } from '../domain/attribution.js';
import { gateIsOpen, gateRequirements, mayDecide } from '../domain/gates.js';
import { mintDecisionId, mintDraftId } from '../domain/ids.js';
import { freezePins } from '../domain/links.js';
import { phaseAfterGate } from '../domain/lifecycle.js';
import { nextState } from '../domain/versioning.js';
import { acceptingOutcome, gateIn, profileIn, typeIn } from '../domain/workspace-definition.js';
import { versionPayloadKey, writePayload, type PayloadStore } from '../record/payload-store.js';
import type { Attribution, Decision, Draft, EvaluationResult, Materiality } from '../domain/types.js';
import { NotFound, Refused, type Actor } from './artifacts.js';
import { GateViewService, type DecisionContext, type GateView } from './gate-view.js';
import { pinnedLinkInput } from './pinned-link.js';
import { QuestionService } from './questions.js';
import type { LoadedWorkspace } from './workspaces.js';

export type { DecisionContext, GateView } from './gate-view.js';

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

/** What `DecisionRecorded` carries as its payload (ADR-0020 §2): the prose, and what it was taken on. */
export interface DecisionPayload {
  reasoning?: string;
  evaluations: EvaluationResult[];
}

export class DecisionService {
  constructor(
    private readonly handle: WorkspaceHandle,
    private readonly workspace: LoadedWorkspace,
    private readonly recorder?: Recorder,
    private readonly payloads?: PayloadStore,
  ) {}

  private record(): Recorder {
    if (!this.recorder) throw new Error('This service was built without a recorder and cannot write.');
    return this.recorder;
  }

  private store(): PayloadStore {
    if (!this.payloads) throw new Error('This service was built without a payload store and cannot write.');
    return this.payloads;
  }

  private gateOrThrow(id: string) {
    const gate = gateIn(this.workspace.definition, id);
    if (!gate) {
      throw new NotFound(`Gate \`${id}\``);
    }
    return gate;
  }

  private async load(artifact: string, ordinal: number) {
    const version = await this.handle.versions.get(artifact, ordinal);
    if (!version) throw new NotFound(`Version \`${artifact}@${ordinal}\``);
    const record = await this.handle.artifacts.get(artifact);
    if (!record) throw new NotFound(`Artifact \`${artifact}\``);
    const evaluations = await this.handle.evaluations.ofVersion(artifact, ordinal);
    return { version, artifact: record, evaluations };
  }

  /** Who created the lineage, for `exclude_creator`. The first version's proposer. */
  private async creatorOf(artifact: string): Promise<string> {
    return (await this.handle.versions.creator(artifact)) ?? '';
  }

  /** Everything the console needs to render the decision screen. Read-only; lives in `gate-view.ts`. */
  async view(
    gateId: string,
    artifactId: string,
    ordinal: number,
    context: DecisionContext,
  ): Promise<GateView> {
    return new GateViewService(this.handle, this.workspace).view(gateId, artifactId, ordinal, context);
  }

  /**
   * Record a decision.
   *
   * Everything below happens in one transaction with the outbox emission: the version's state, the
   * previous accepted version's supersession, the pin freezing, the phase transition, the reopened
   * draft, and the events describing all of it. Each write is conditioned on what was read — the
   * version still proposed, the superseded one still accepted, each pin target's accepted ordinal
   * unmoved — so a decision taken on a moved record is refused rather than half-applied.
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

    const { version, evaluations } = await this.load(input.artifact, input.ordinal);
    const type = typeIn(this.workspace.definition, version.type)!;
    const profile = profileIn(this.workspace.definition, gate.attribution_profile)!;

    const requirements = gateRequirements({
      gate,
      facets: version.facets,
      provenance: version.provenance,
      evaluations,
      subject_digest: version.digest,
      acceptances: context.acceptances,
      open_questions: await new QuestionService(this.handle).openCount(version.artifact, version.ordinal),
      ...pinnedLinkInput(this.workspace.definition, version),
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
      // The sentences go to the response and the log; the record keeps what was unmet, by id
      // (ADR-0019 §4).
      await this.recordRefusal(input, actor, version.type, {
        refused_for: [
          ...(!verdict.allowed ? (['may_not_decide'] as const) : []),
          ...(!open ? (['gate_closed'] as const) : []),
          ...(attributionIssues.length > 0 ? (['attribution'] as const) : []),
        ],
        unmet: requirements.filter((r) => r.blocking && !r.satisfied).map((r) => r.id),
        attribution_fields: attributionIssues.map((i) => i.field),
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

    const accepted = acceptingOutcome(gate) === input.outcome;
    const reopens = gate.reopens_on === input.outcome;
    const now = new Date().toISOString();

    // The reasoning is prose and the evaluations snapshot is what the decision was taken on: both
    // go to the payload store before the transaction that records the decision (ADR-0020 §2).
    const decisionId = mintDecisionId();
    const payload: DecisionPayload = {
      ...(input.reasoning ? { reasoning: input.reasoning } : {}),
      evaluations,
    };
    const payloadRef = await writePayload(
      this.store(),
      versionPayloadKey(this.handle.workspace, input, `decision/${decisionId}.json`),
      payload,
    );

    return this.handle
      .transaction(async (tx) => {
        // Re-read on every attempt: a retry after a moved counter must see the record as it is.
        const { version: current, artifact } = await this.load(input.artifact, input.ordinal);
        const state = nextState(current.state, {
          kind: 'gate_decision',
          outcome: accepted ? 'accept' : reopens ? 'reopen' : 'reject',
          gate: gate.id,
        });

        let links = current.links;
        if (accepted) {
          // Resolve every pin target's accepted ordinal now, and condition the transaction on each
          // staying where it was read, so the pin freezes to what was accepted at this instant
          // rather than to what was accepted when the screen was rendered.
          const targets = [...new Set(current.links.map((l) => l.target))];
          const acceptedByArtifact = await this.handle.artifacts.acceptedOrdinals(targets);
          for (const target of targets) {
            if (target === input.artifact) continue;
            this.handle.artifacts.checkAccepted(tx, target, acceptedByArtifact.get(target));
          }
          links = freezePins(current.links, type, (a) => acceptedByArtifact.get(a));
        }

        await this.handle.versions.update(
          input.artifact,
          input.ordinal,
          {
            state,
            links,
            decided_at: now,
            ...(input.materiality ? { materiality: input.materiality } : {}),
          },
          tx,
          { expectState: current.state },
        );

        let superseded: number | undefined;
        if (accepted && artifact.accepted_ordinal && artifact.accepted_ordinal !== input.ordinal) {
          const previous = await this.handle.versions.get(input.artifact, artifact.accepted_ordinal);
          if (previous && previous.state === 'accepted') {
            await this.handle.versions.update(
              input.artifact,
              artifact.accepted_ordinal,
              { state: nextState('accepted', { kind: 'supersede', by_ordinal: input.ordinal }) },
              tx,
              { expectState: 'accepted' },
            );
            superseded = artifact.accepted_ordinal;
          }
        }

        const phase = phaseAfterGate(this.workspace.definition, artifact.phase, gate.id, input.outcome);
        await this.handle.artifacts.update(
          input.artifact,
          {
            ...(phase ? { phase } : {}),
            ...(accepted ? { accepted_ordinal: input.ordinal } : {}),
            updated_at: now,
          },
          tx,
        );

        const decision: Decision = {
          id: decisionId,
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
        await this.handle.decisions.insert(decision, tx);

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
          await this.handle.drafts.insert(draft, tx);
        }

        // The decision's own attribution is the profile's — accountable, acting and whatever else it
        // required — and it must agree with the seat: a decider is a human in `decider`.
        const declared = {
          accountable: input.attribution.accountable,
          acting: input.attribution.acting,
          oversight_level: input.attribution.oversight_level,
        };
        const consequences: Act[] = [
          ...(superseded !== undefined
            ? [
                {
                  type: 'VersionSuperseded',
                  subject: { artifact: input.artifact, ordinal: superseded },
                  artifact_type: version.type,
                  seat: 'decider' as const,
                  body: { by_ordinal: input.ordinal },
                  occurred_at: now,
                  attribution: declared,
                },
              ]
            : []),
          ...(accepted && links.some((l) => l.pinned_to != null)
            ? [
                {
                  type: 'LinkPinned',
                  subject: { artifact: input.artifact, ordinal: input.ordinal },
                  artifact_type: version.type,
                  seat: 'decider' as const,
                  body: {
                    links: links
                      .filter((l) => l.pinned_to != null)
                      .map((l) => ({ type: l.type, target: l.target, pinned_to: l.pinned_to })),
                  },
                  occurred_at: now,
                  attribution: declared,
                },
              ]
            : []),
        ];
        await this.record().emit(tx, [
          {
            type: 'DecisionRecorded',
            subject: { artifact: input.artifact, ordinal: input.ordinal },
            artifact_type: version.type,
            seat: 'decider',
            body: {
              decision: decision.id,
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
            payload: payloadRef,
            attribution: declared,
          },
          ...consequences,
        ]);

        return decision;
      })
      .catch((error) => {
        if (error instanceof Conflict) throw new Refused(error.message);
        throw error;
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
  private async recordRefusal(
    input: DecideInput,
    actor: Actor,
    artifactType: string,
    detail: { refused_for: string[]; unmet: string[]; attribution_fields: string[] },
  ) {
    const now = new Date().toISOString();
    // An agent has no seat to be refused in: `decider` is O0, so the recorder would refuse the
    // refusal. The attempt is logged by the caller's refusal and stays off the record — there is
    // no answerable human to write it under, which is the point (ADR-0019 §2).
    if (actor.kind !== 'human') return;
    await this.handle.transaction(async (tx) => {
      await this.record().emit(tx, [
        {
          type: 'DecisionRefused',
          subject: { artifact: input.artifact, ordinal: input.ordinal },
          artifact_type: artifactType,
          seat: 'decider',
          body: { gate: input.gate, outcome: input.outcome, ...detail },
          occurred_at: now,
        },
      ]);
    });
  }

  async listDecisions(artifact: string): Promise<Decision[]> {
    return this.handle.decisions.ofArtifact(artifact);
  }
}
