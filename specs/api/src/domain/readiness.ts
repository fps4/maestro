/**
 * Readiness — what a draft still needs before it can be proposed, and what its gate will then ask.
 *
 * A draft may be invalid (ADR-0003); a proposal may not. Between those two states is a person or
 * an agent trying to work out *what is still missing*, and until now the answer was a 422 with a
 * JSON-schema path. This turns the schema into the questions it was always asking: "Declared
 * outcome — is it worth solving, and do we know enough to say so? — not yet filled in."
 *
 * Pure. It reads the draft, the type, the schema and the validator's issues, and computes; nothing
 * here touches storage. The service wraps it with the two things it cannot know from data alone.
 */

import type { FacetIssue } from './facets.js';
import { facetsMissingProvenance, unconfirmedExtractions } from './facets.js';
import type { Labels } from './labels.js';
import { humanise } from './labels.js';
import type { Draft } from './types.js';
import { gatesDecidingOn, type TypeDeclaration, type WorkspaceDefinition } from './workspace-definition.js';

export type BlockerKind =
  | 'facet_missing'
  | 'facet_invalid'
  | 'facet_unconfirmed'
  | 'facet_unattributed'
  | 'classification_missing'
  | 'link_missing';

export interface Blocker {
  kind: BlockerKind;
  /** The facet field, where the blocker is about one. */
  field?: string;
  /** What a person reads: the schema's title or the humanised field. */
  label: string;
  /** The plain-language question this facet answers, from the schema, when it gives one. */
  description?: string;
  detail: string;
}

export interface GateAhead {
  gate: string;
  title: string;
  description?: string;
  /** What the gate will require once this is proposed, in words. */
  requirements: string[];
}

export interface Readiness {
  proposable: boolean;
  blockers: Blocker[];
  /** The gates that will decide on this type, and what each asks — so the author writes toward them. */
  gates: GateAhead[];
}

/** The little of JSON Schema this reads: `required`, and each property's `title` and `description`. */
interface Schema {
  required?: string[];
  properties?: Record<string, { title?: string; description?: string; [keyword: string]: unknown }>;
}

export interface ReadinessInput {
  draft: Pick<Draft, 'type' | 'facets' | 'provenance' | 'links' | 'classification'>;
  type: TypeDeclaration;
  schema: Schema;
  /** The validator's verdict on the current facets. Empty means the schema is satisfied. */
  issues: FacetIssue[];
  def: WorkspaceDefinition;
  labels: Labels;
}

export function draftReadiness(input: ReadinessInput): Readiness {
  const { draft, type, schema, issues, def, labels } = input;
  const blockers: Blocker[] = [];
  const property = (field: string) => schema.properties?.[field];
  const labelOf = (field: string) => property(field)?.title ?? humanise(field);

  // Missing required facets first, in schema order — that is the order the author should fill
  // them in, and it is the order an interview asks them.
  const missing = new Set(
    issues.filter((i) => i.rule === 'required' && !i.path.includes('.')).map((i) => i.path),
  );
  for (const field of schema.required ?? []) {
    if (!missing.has(field)) continue;
    blockers.push({
      kind: 'facet_missing',
      field,
      label: labelOf(field),
      ...(property(field)?.description ? { description: property(field)!.description } : {}),
      detail: 'Not yet filled in.',
    });
  }

  for (const issue of issues) {
    if (issue.rule === 'required' && missing.has(issue.path)) continue;
    const field = issue.path.split('.')[0] || '(root)';
    blockers.push({
      kind: 'facet_invalid',
      field,
      label: labelOf(field),
      detail: issue.path && issue.path !== field ? `${issue.path} ${issue.message}.` : `${issue.message}.`,
    });
  }

  for (const field of unconfirmedExtractions(draft.provenance)) {
    blockers.push({
      kind: 'facet_unconfirmed',
      field,
      label: labelOf(field),
      detail: 'Filled in by an agent and not yet confirmed by a person. Confirm it, or change it.',
    });
  }

  for (const field of facetsMissingProvenance(draft.facets, draft.provenance)) {
    blockers.push({
      kind: 'facet_unattributed',
      field,
      label: labelOf(field),
      detail: 'Set with no record of who set it. Save it again so it is attributed.',
    });
  }

  if (type.classification_required && !draft.classification) {
    blockers.push({
      kind: 'classification_missing',
      label: 'Data classification',
      detail:
        'This type must say whether it carries personal data, under what lawful basis, and for how long it is kept. Without that it can never be given a retention rule afterwards.',
    });
  }

  const pinned = type.links.find((l) => l.pinned);
  if (pinned && !draft.links.some((l) => l.type === pinned.id)) {
    blockers.push({
      kind: 'link_missing',
      label: labels.links[pinned.id] ?? humanise(pinned.id),
      detail: `A ${labels.types[type.id]?.title.toLowerCase() ?? type.id} must say which ${labels.types[pinned.to]?.title.toLowerCase() ?? pinned.to} it rests on. Acceptance freezes to that version.`,
    });
  }

  const gates: GateAhead[] = gatesDecidingOn(def, type.id).map((gate) => {
    const requirements: string[] = [];
    if (gate.requires.confirmed_facets) requirements.push('Every facet confirmed by a person.');
    for (const ev of gate.requires.evaluations) {
      const declared = def.evaluators.find((e) => e.id === ev);
      requirements.push(
        declared?.builtin === 'facet_schema'
          ? `The "${humanise(ev)}" check, which reads the facets against this type's schema — it runs when you propose.`
          : `The "${humanise(ev)}" check, run by an evaluator when you propose.`,
      );
    }
    if (gate.requires.catalogue_acceptances)
      requirements.push('Every referenced standard accepted and current.');
    if (gate.requires.questions_resolved)
      requirements.push('Every question on the version answered and closed.');
    const label = labels.gates[gate.id];
    return {
      gate: gate.id,
      title: label?.title ?? humanise(gate.id),
      ...(label?.description ? { description: label.description } : {}),
      requirements,
    };
  });

  // A proposal is refused for an invalid schema or a missing classification; the rest is what the
  // gate will refuse. Both are blockers to the author, but only the first kind stops `propose`.
  const proposable = !blockers.some(
    (b) => b.kind === 'facet_missing' || b.kind === 'facet_invalid' || b.kind === 'classification_missing',
  );

  return { proposable, blockers, gates };
}
