/**
 * Today, specs-service's half (ux.md rule 1): the decisions only this person can take, and the
 * questions waiting on what they wrote. work-service serves the other half; the console puts both on
 * one page (maestro ADR-0023).
 *
 * Read-only, and built on the gate view rather than beside it: a version is on a person's Decide
 * list exactly when the decision page would let them decide, for the same reason, so the list can
 * never offer what the page then refuses.
 */

import type { WorkspaceHandle } from '../db/handle.js';
import type { Requirement } from '../domain/gates.js';
import { labelsFor } from '../domain/labels.js';
import type { Question, Version } from '../domain/types.js';
import type { AcceptanceService } from './catalogue.js';
import { GateViewService, type DecisionContext } from './gate-view.js';
import type { LoadedWorkspace } from './workspaces.js';

export interface DecideRow {
  gate: string;
  gate_title: string;
  artifact: string;
  ordinal: number;
  title: string;
  type: string;
  type_title: string;
  proposed_by: string;
  proposed_at: string;
  /** Every blocking requirement is met: the decision can be taken now. */
  open: boolean;
  /** What still holds the gate shut, by title. */
  waiting_on: string[];
}

export interface AnswerRow {
  question: string;
  artifact: string;
  ordinal: number;
  title: string;
  text: string;
  asked_by: string;
  asked_kind: Question['asked_kind'];
  asked_at: string;
}

export interface SpecsToday {
  principal: string;
  decide: DecideRow[];
  answer: AnswerRow[];
}

export class TodayService {
  constructor(
    private readonly handle: WorkspaceHandle,
    private readonly workspace: LoadedWorkspace,
    private readonly acceptances: AcceptanceService,
  ) {}

  async today(context: Omit<DecisionContext, 'acceptances'>): Promise<SpecsToday> {
    const proposed = await this.proposed();
    const gates = new GateViewService(this.handle, this.workspace);
    const labels = labelsFor(this.workspace.definition);
    const me = context.decider.id;

    const decide: DecideRow[] = [];
    for (const version of proposed) {
      for (const gate of this.workspace.definition.gates.filter((g) => g.decides_on === version.type)) {
        const view = await gates.view(gate.id, version.artifact, version.ordinal, {
          ...context,
          acceptances: await this.acceptances.statesFor(version.catalogue_refs),
        });
        if (!view.may_decide) continue;
        decide.push({
          gate: gate.id,
          gate_title: view.title,
          artifact: version.artifact,
          ordinal: version.ordinal,
          title: version.title,
          type: version.type,
          type_title: labels.types[version.type]?.title ?? version.type,
          proposed_by: version.proposed_by,
          proposed_at: version.proposed_at,
          open: view.open,
          waiting_on: view.requirements.filter(holdsShut).map((r) => r.title),
        });
      }
    }

    const answer: AnswerRow[] = [];
    for (const version of proposed.filter((v) => v.proposed_by === me)) {
      for (const q of await this.handle.questions.ofVersion(version.artifact, version.ordinal)) {
        if (q.resolved_at || q.answers.length > 0) continue;
        answer.push({
          question: q.id,
          artifact: version.artifact,
          ordinal: version.ordinal,
          title: version.title,
          text: q.text,
          asked_by: q.asked_by,
          asked_kind: q.asked_kind,
          asked_at: q.asked_at,
        });
      }
    }

    decide.sort((a, b) => a.proposed_at.localeCompare(b.proposed_at));
    answer.sort((a, b) => a.asked_at.localeCompare(b.asked_at));
    return { principal: me, decide, answer };
  }

  /** The latest version of every lineage, where it is proposed: what a gate can be asked about. */
  private async proposed(): Promise<Array<Omit<Version, 'body'>>> {
    const artifacts = await this.handle.artifacts.list();
    if (artifacts.length === 0) return [];
    const latest = await this.handle.versions.getMany(
      artifacts.map((a) => ({ artifact: a.id, ordinal: a.latest_ordinal })),
    );
    return latest.filter((v) => v.state === 'proposed');
  }
}

const holdsShut = (r: Requirement): boolean => r.blocking && !r.satisfied;
