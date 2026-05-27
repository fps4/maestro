// The read-API wire shapes (S1) — see docs/architecture/contracts/workspace-read-api.md.
// Kept in lock-step with that contract; the webapp is a thin renderer over it (ADR-0015).

export type SpecKind = 'functional_spec' | 'technical_design';

export type GateDecision = 'approve' | 'request_changes' | 'reject' | 'pending';

export interface Product {
  id: string;
  name: string;
  product_type: string;
  role: string | null;
}

export interface SpecRef {
  repo: string;
  branch: string;
  path: string;
  commit: string;
}

export interface SpecStatus {
  task_id: string;
  stage: string;
  gate: { type: 'functional' | 'technical'; decision: GateDecision };
  branch: string | null;
  merged: boolean;
}

export interface SpecSummary {
  feature: string;
  task: string | null;
  kind: SpecKind;
  title: string;
  ref: SpecRef;
  status: SpecStatus | null;
  availability: 'indexed' | 'unavailable';
  href: string; // the API path; the webapp builds its own route links (see lib/links.ts)
}

export interface UnindexedDoc {
  ref: SpecRef;
  reason: string;
}

export interface SpecsIndex {
  product: { id: string; name: string };
  specs: SpecSummary[];
  unindexed: UnindexedDoc[];
}

export interface SpecDetail {
  feature: string;
  task: string | null;
  kind: SpecKind;
  title: string;
  ref: SpecRef;
  frontmatter: Record<string, unknown>;
  content: string;
  status: SpecStatus | null;
}
