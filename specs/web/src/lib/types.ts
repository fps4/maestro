/**
 * The shapes the api returns.
 *
 * Deliberately hand-written rather than generated: they are the contract this console reads against,
 * and writing them down is how a change to the api that would break a screen shows up as a type
 * error rather than as an empty table.
 */

export type VersionState = 'proposed' | 'accepted' | 'superseded' | 'rejected' | 'withdrawn' | 'expired';

export interface FacetProvenance {
  source: 'declared' | 'extracted' | 'reconstructed';
  by: string;
  confirmed_by?: string;
  confirmed_at?: string;
  at: string;
}

export interface Link {
  type: string;
  target: string;
  pinned_to?: number | null;
}

export interface CatalogueRef {
  standard: string;
  ordinal: number;
  pack: string;
  pack_version: string;
}

export interface Contributor {
  principal: string;
  kind: 'human' | 'agent' | 'service';
  first: string;
  last: string;
}

export interface Body {
  format: string;
  content: string;
}

export interface Version {
  workspace: string;
  artifact: string;
  type: string;
  title: string;
  ordinal: number;
  state: VersionState;
  digest: string;
  supersedes?: number;
  definition_version: number;
  facets: Record<string, unknown>;
  provenance: Record<string, FacetProvenance>;
  body: Body;
  links: Link[];
  catalogue_refs?: CatalogueRef[];
  classification?: { lawful_basis: string; retention: string; personal_data: boolean };
  effective?: { effective_from?: string; effective_to?: string | null; lapse_behaviour?: string };
  materiality?: 'material' | 'immaterial';
  proposed_by: string;
  contributors: Contributor[];
  proposed_at: string;
  decided_at?: string;
}

export interface Artifact {
  id: string;
  workspace: string;
  type: string;
  title: string;
  phase: string;
  latest_ordinal: number;
  accepted_ordinal?: number;
  created_at: string;
  updated_at: string;
}

export type RegisterRow = Artifact & {
  latest_state?: VersionState;
  latest_digest?: string;
  open_draft?: string;
};

export interface Draft {
  id: string;
  workspace: string;
  artifact?: string;
  type: string;
  title: string;
  revision: number;
  facets: Record<string, unknown>;
  provenance: Record<string, FacetProvenance>;
  body: Body;
  links: Link[];
  catalogue_refs?: CatalogueRef[];
  contributors: Contributor[];
  based_on?: number;
  reopened_from_decision?: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

export interface Decision {
  id: string;
  gate: string;
  artifact: string;
  ordinal: number;
  subject_digest: string;
  outcome: string;
  reasoning?: string;
  attribution: Record<string, string>;
  decided_by: string;
  decided_at: string;
}

export interface Requirement {
  id: string;
  satisfied: boolean;
  title: string;
  detail: string;
  blocking: boolean;
}

export interface GateView {
  gate: string;
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
  outcome_labels: Record<string, string>;
  attribution_profile: {
    id: string;
    required: string[];
    optional: string[];
    field_labels: Record<string, string>;
  };
}

export interface FacetChange {
  field: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

export interface VersionDiff {
  artifact: string;
  from: { ordinal: number; digest: string };
  to: { ordinal: number; digest: string };
  facets: {
    changes: FacetChange[];
    provenance: Array<{
      field: string;
      before?: { source: string; confirmed: boolean };
      after?: { source: string; confirmed: boolean };
    }>;
  };
  links: {
    added: Link[];
    removed: Link[];
    repointed: Array<{ type: string; before: Link; after: Link }>;
  };
  body: {
    format: string;
    format_changed: boolean;
    unchanged: boolean;
    hunks: Array<{ kind: 'context' | 'added' | 'removed'; lines: string[] }>;
  };
}

export interface Lineage {
  root: string;
  nodes: Array<{
    artifact: string;
    type: string;
    title: string;
    phase: string;
    accepted_ordinal?: number;
    latest_ordinal: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: string;
    pinned: boolean;
    ordinal?: number;
    resolution: 'frozen' | 'follows_lineage' | 'unresolved';
  }>;
}

export interface StandardSummary {
  artifact: string;
  ordinal: number;
  type: string;
  title: string;
  standard_id: string;
  pack: string;
  pack_version: string;
  tier?: string;
  authority: 'ours' | 'external';
  licence_disposition?: string;
  force: 'in_force' | 'pending' | 'lapsed' | 'undated';
  effective_from?: string;
  effective_to?: string | null;
  materiality?: 'material' | 'immaterial';
  digest: string;
}

export interface Acceptance {
  standard: string;
  standard_ordinal: number;
  pack_version: string;
  accepted_by: string;
  at: string;
  scope: 'tenant' | 'project';
  project?: string;
  status: 'active' | 'lapsed' | 'overridden';
  lapsed_at_ordinal?: number;
  override?: { justification: string; accepted_by: string; expires: string };
}

export interface TypeDeclaration {
  id: string;
  title?: string;
  description?: string;
  facet_schema: string;
  body_format: string;
  effective_dating: boolean;
  classification_required: boolean;
  catalogue_refs: boolean;
  draft_expiry?: string;
  links: Array<{ id: string; to: string; pinned: boolean; label?: string }>;
}

export interface GateDeclaration {
  id: string;
  title?: string;
  description?: string;
  decides_on: string;
  owner: Record<string, string>;
  outcomes: string[];
  outcome_labels: Record<string, string>;
  reopens_on?: string;
  requires: { confirmed_facets: boolean; evaluations: string[]; catalogue_acceptances: boolean };
  separation_of_duties?: string;
  attribution_profile: string;
  records_materiality: boolean;
}

export interface WorkspaceDefinition {
  workspace: string;
  definition_version: number;
  kind: 'tenant' | 'catalogue';
  title?: string;
  types: TypeDeclaration[];
  gates: GateDeclaration[];
  attribution_profiles: Array<{
    id: string;
    required: string[];
    optional: string[];
    field_labels: Record<string, string>;
  }>;
  lifecycle: {
    phases: string[];
    phase_labels: Record<string, string>;
    transitions: Array<{ from: string; to: string; via?: string; via_gate?: string; on?: string }>;
  };
  evaluators: Array<{ id: string; endpoint: string }>;
}

/**
 * Every identifier the definition declares, as the word a reader sees for it. Computed by the api
 * from the definition, with the humanised id wherever the definition gave no label.
 */
export interface Labels {
  types: Record<string, { title: string; description?: string }>;
  gates: Record<string, { title: string; description?: string; outcomes: Record<string, string> }>;
  phases: Record<string, string>;
  links: Record<string, string>;
  attribution: Record<string, string>;
}
