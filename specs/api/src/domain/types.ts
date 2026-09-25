/**
 * The core entities, as types.
 *
 * Nothing here knows what a business case, a Wkb standard or a sponsor is. Those words live in a
 * workspace definition (ADR-0001), and this file is deliberately readable end to end without ever
 * learning them.
 */

export type WorkspaceId = string; // ws-…
export type ArtifactId = string; // art-…
export type DraftId = string; // dft-…
export type PrincipalId = string; // prn-…
export type AttachmentId = string; // att-…
export type DecisionId = string; // dec-…
export type QuestionId = string; // qst-…

/** Declared in a workspace definition, never in code. */
export type TypeId = string;
export type GateId = string;
export type LinkTypeId = string;
export type PhaseId = string;
export type EvaluatorId = string;

/** A principal is human, agent, or service — and which one it is has consequences (ADR-0005). */
export type PrincipalKind = 'human' | 'agent' | 'service';

export interface Principal {
  id: PrincipalId;
  kind: PrincipalKind;
  display_name: string;
  /** The consumer's own identifier for this principal, if it keeps one. Never an issuer `sub`. */
  external_ref?: string;
  /**
   * Ids this service knew the same principal by before it read identity-service's `prn` (ADR-0022).
   * The records that name them are history and are not rewritten; a rule that asks "is this the
   * same person" — separation of duties, the proposer's withdrawal — asks it of these too.
   */
  supersedes?: PrincipalId[];
}

/** Whether `id` names this principal: its own id, or one it supersedes (ADR-0022). */
export function isPrincipal(
  principal: { id: PrincipalId; supersedes?: PrincipalId[] },
  id: PrincipalId,
): boolean {
  return principal.id === id || (principal.supersedes?.includes(id) ?? false);
}

/**
 * How a facet came to hold its value.
 *
 * `extracted` is the load-bearing one: an agent may propose a value, and until a human confirms it
 * the value cannot reach a gate. `reconstructed` marks something recovered after the fact, which
 * must never be presented as original.
 */
export type ProvenanceSource = 'declared' | 'extracted' | 'reconstructed';

export interface FacetProvenance {
  source: ProvenanceSource;
  by: PrincipalId;
  /** Required before an `extracted` facet may be evaluated or gated. */
  confirmed_by?: PrincipalId;
  confirmed_at?: string;
  at: string;
}

export type Facets = Record<string, unknown>;
export type ProvenanceMap = Record<string, FacetProvenance>;

export interface Body {
  format: string; // markdown/v1 · text/v1
  content: string;
}

export interface AttachmentRef {
  id: AttachmentId;
  filename: string;
  media_type: string;
  size: number;
  digest: string;
  key: string;
}

export interface Contributor {
  principal: PrincipalId;
  kind: PrincipalKind;
  first: string; // ISO timestamp of first contribution
  last: string;
}

/**
 * A typed edge between two artifacts in the same workspace.
 *
 * `pinned_to` is set once, at acceptance, and never again. A link that follows a lineage leaves it
 * null and always resolves to the latest accepted version.
 */
export interface Link {
  type: LinkTypeId;
  target: ArtifactId;
  pinned_to?: number | null;
}

/**
 * A reference to a standard in the catalogue workspace.
 *
 * Deliberately NOT a `Link`. A link is intra-workspace and participates in lineage; a catalogue
 * reference crosses a boundary and resolves read-only. Collapsing the two is how the isolation
 * model erodes, so they do not share a type (ADR-0008).
 */
export interface CatalogueRef {
  standard: string; // the standard's stable id, e.g. FPS4-SUFF-BASELINE-002
  ordinal: number; // the version referenced
  pack: string;
  pack_version: string;
}

export type VersionState = 'proposed' | 'accepted' | 'superseded' | 'rejected' | 'withdrawn' | 'expired';

/** A version is in force between two dates, which is a different question from whether it was accepted. */
export type LapseBehaviour = 'fail' | 'unregulated' | 'freeze_at_last';

export interface EffectiveWindow {
  effective_from?: string;
  effective_to?: string | null;
  lapse_behaviour?: LapseBehaviour;
}

/** Whether a change to a catalogue version invalidates acceptances resting on the previous one. */
export type Materiality = 'material' | 'immaterial';

export interface Classification {
  lawful_basis: string;
  retention: string;
  personal_data: boolean;
  subject_refs?: string[];
}

export interface Draft {
  id: DraftId;
  workspace: WorkspaceId;
  artifact?: ArtifactId;
  type: TypeId;
  title: string;
  revision: number;
  facets: Facets;
  provenance: ProvenanceMap;
  body: Body;
  attachments: AttachmentRef[];
  links: Link[];
  catalogue_refs?: CatalogueRef[];
  classification?: Classification;
  effective?: EffectiveWindow;
  contributors: Contributor[];
  based_on?: number;
  /** Set when a gate returned request_changes, so the reviewer's reasoning travels with the work. */
  reopened_from_decision?: DecisionId;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

export interface Version {
  workspace: WorkspaceId;
  artifact: ArtifactId;
  type: TypeId;
  title: string;
  ordinal: number;
  state: VersionState;
  digest: string;
  supersedes?: number;
  definition_version: number;
  facets: Facets;
  provenance: ProvenanceMap;
  body: Body;
  attachments: AttachmentRef[];
  links: Link[];
  catalogue_refs?: CatalogueRef[];
  classification?: Classification;
  effective?: EffectiveWindow;
  materiality?: Materiality;
  proposed_by: PrincipalId;
  contributors: Contributor[];
  proposed_at: string;
  decided_at?: string;
  /** Set only by a redaction. The digest deliberately no longer matches afterwards. */
  redacted_at?: string;
}

export interface Artifact {
  id: ArtifactId;
  workspace: WorkspaceId;
  type: TypeId;
  title: string;
  phase: PhaseId;
  latest_ordinal: number;
  accepted_ordinal?: number;
  created_at: string;
  updated_at: string;
}

export interface EvaluationResult {
  evaluator: EvaluatorId;
  artifact: ArtifactId;
  ordinal: number;
  verdict: 'pass' | 'fail' | 'not_applicable';
  /** Per-standard detail, when the evaluator reports one. The service records; it never computes. */
  findings?: Array<{
    standard?: string;
    outcome: 'met' | 'unmet' | 'not_applicable' | 'unsupported';
    detail?: string;
  }>;
  recorded_at: string;
  /** The digest the verdict was reached against — a verdict on other bytes is not a verdict. */
  subject_digest: string;
}

export interface Attribution {
  accountable: PrincipalId;
  acting: PrincipalId;
  [field: string]: string | undefined;
}

/**
 * A question asked of an immutable version.
 *
 * Not a comment and not a mutation. A question is a fact *about* a version — attributed, dated,
 * answerable, and closed by a human — and it never changes the bytes it is about. It is the one
 * channel a reviewer has short of `request_changes`, and it is on the record so that "what did the
 * sponsor not understand" is answerable years later.
 */
export interface Answer {
  id: string;
  text: string;
  by: PrincipalId;
  kind: PrincipalKind;
  at: string;
}

export interface Question {
  id: QuestionId;
  workspace: WorkspaceId;
  artifact: ArtifactId;
  ordinal: number;
  text: string;
  asked_by: PrincipalId;
  asked_kind: PrincipalKind;
  asked_at: string;
  answers: Answer[];
  /** Set once, by a human. A resolved question stays readable; nothing is deleted. */
  resolved_at?: string;
  resolved_by?: PrincipalId;
}

export interface Decision {
  id: DecisionId;
  workspace: WorkspaceId;
  gate: GateId;
  artifact: ArtifactId;
  ordinal: number;
  subject_digest: string;
  outcome: string;
  reasoning?: string;
  attribution: Attribution;
  evaluations: EvaluationResult[];
  decided_by: PrincipalId;
  decided_at: string;
}
