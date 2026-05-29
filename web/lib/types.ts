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

// --- task-detail shapes (workspace-write-api.md + workspace-read-api.md §get-task) --------------
//
// The discuss + decide page is one round-trip: GET /api/products/{p}/tasks/{t} returns everything
// the screen needs — current stage, open gates with the seq the workspace echoes back as
// If-Match on a decision, comments by anchor, and the refinement-loop trail.

export type GateType = 'functional' | 'technical_design' | 'technical_merge';

export type DecisionAction = 'approve' | 'request_changes' | 'reject';

export interface ResolvedGate {
  gate: GateType | string;
  decision: DecisionAction | 'pending';
  resolved_by: string | null;
  resolved_at: number | null;
  seq: number;
}

// One pending gate the architect can decide. The `seq` round-trips as `If-Match` on the decision
// write (workspace-write-api.md §optimistic-concurrency).
export interface OpenGate {
  gate_id: string;
  type: GateType | string;
  seq: number;
  opened_at: number;
}

// Anchored or unanchored remark on a task. Comments are append-only (events are immutable;
// supersession is by a new comment, not an edit — workspace-write-api.md §POST-comments).
export interface CommentAnchorLocator {
  criterion_id?: string;
  heading?: string;
  path?: string;
  side?: 'old' | 'new';
  line?: number;
}

export interface CommentAnchor {
  artefact: { kind: SpecKind | 'pull_request_diff'; ref: SpecRef };
  locator: CommentAnchorLocator;
}

export interface Comment {
  comment_id: string;
  author: string | null;
  body: string;
  anchor: CommentAnchor | null;
  in_reply_to: string | null;
  created_at: number;
  seq: number;
}

// One per-anchor reply in a refinement-cycle closure (ADR-0022).
export interface Address {
  comment_id: string;
  action: 'addressed' | 'deferred' | 'rejected';
  note: string;
  ref_section: { locator: CommentAnchorLocator } | null;
}

export interface AgentResponse {
  bundle_id: string;
  agent: 'spec' | 'design';
  kind: SpecKind;
  summary_of_changes: string;
  addresses: Address[];
  ref: SpecRef;
  emitted_at: number;
  seq: number;
}

export interface TaskDetail {
  task_id: string;
  product_id: string;
  stage: string;
  status: 'active' | 'blocked' | 'cancelled' | 'done';
  branch: string | null;
  pr: { repo: string; number: number; url: string } | null;
  merged: boolean;
  gates: ResolvedGate[];
  open_gates: OpenGate[];
  comments: Comment[];
  agent_responses: AgentResponse[];
}

// --- write-API response shapes (workspace-write-api.md) ----------------------------------------

export interface DispatchResponse {
  task_id: string;
  product_id: string;
  stage: string;
  ref: { repo: string; branch: string | null; commit: string | null };
  event_seq: number;
  href: string;
}

export interface CommentResponse {
  comment_id: string;
  task_id: string;
  attributed_to: { email: string; role: string };
  created_at: string;
  event_seq: number;
}

export interface DecisionResponse {
  task_id: string;
  gate_id: string;
  gate: { type: GateType | string; decision: DecisionAction; seq: number };
  attributed_to: { email: string; role: string };
  decided_at: string;
  event_seq: number;
  feedback_bundle_id: string | null;
}
