/**
 * Propose, accept, supersede — the product (ADR-0003).
 *
 * A draft is mutable and is not a record. A version is an immutable snapshot of one, and **there is
 * no update operation anywhere**. A change is a new draft, then a new version. Everything in this
 * file is a pure function over states, so the rule that a version cannot be edited is expressible
 * as "no function here returns a modified version" and checkable by reading it.
 */

import { canonicalise, digestVersion } from './digest.js';
import { facetsMissingProvenance, unconfirmedExtractions } from './facets.js';
import type { Contributor, Draft, PrincipalId, Version, VersionState } from './types.js';

export class IllegalStateChange extends Error {
  constructor(
    readonly from: VersionState,
    readonly to: VersionState,
    reason: string,
  ) {
    super(`A version cannot move from \`${from}\` to \`${to}\`: ${reason}`);
    this.name = 'IllegalStateChange';
  }
}

/**
 * What is allowed to change a version's state, and nothing else is.
 *
 * `gate_decision` is the only cause that can produce `accepted` or `rejected`. That is the single
 * property that makes "every write proposes" true rather than conventional — so it is expressed as
 * a type the caller must construct, not as a string a route could pass through.
 */
export type StateChangeCause =
  | { kind: 'gate_decision'; outcome: 'accept' | 'reject' | 'reopen'; gate: string }
  | { kind: 'supersede'; by_ordinal: number }
  | { kind: 'withdraw'; by: PrincipalId }
  | { kind: 'system'; reason: string };

const TERMINAL: ReadonlySet<VersionState> = new Set(['superseded', 'rejected', 'withdrawn']);

/**
 * The state machine, stated once.
 *
 * MongoDB has no check constraints (§8.4), so a legal transition is enforced in one code path
 * rather than by the database. This is that path — every state change in the service goes through
 * it, and the compensating control is the record sink, which makes a divergence detectable.
 */
export function nextState(current: VersionState, cause: StateChangeCause): VersionState {
  if (TERMINAL.has(current)) {
    throw new IllegalStateChange(current, current, `\`${current}\` is terminal`);
  }

  switch (cause.kind) {
    case 'gate_decision': {
      if (current !== 'proposed') {
        throw new IllegalStateChange(current, 'accepted', 'only a proposed version can be decided on');
      }
      if (cause.outcome === 'accept') return 'accepted';
      // request_changes and reject both refuse the version. They differ in what happens next — a
      // reopen creates a draft — not in what becomes of the bytes that were refused.
      return 'rejected';
    }

    case 'supersede': {
      if (current !== 'accepted') {
        throw new IllegalStateChange(
          current,
          'superseded',
          'only an accepted version is superseded by a later one',
        );
      }
      return 'superseded';
    }

    case 'withdraw': {
      if (current !== 'proposed') {
        throw new IllegalStateChange(
          current,
          'withdrawn',
          'a version can only be withdrawn before a decision',
        );
      }
      return 'withdrawn';
    }

    case 'system': {
      // `expired` exists for types that describe something outside this service, which can rot
      // silently. It is set by a consumer through the system transition, never by a human hand
      // and never by a gate.
      if (current !== 'accepted') {
        throw new IllegalStateChange(current, 'expired', 'only an accepted version can expire');
      }
      return 'expired';
    }
  }
}

export class ProposalRefused extends Error {
  constructor(
    message: string,
    readonly reasons: string[],
  ) {
    super(message);
    this.name = 'ProposalRefused';
  }
}

export interface ProposeInput {
  draft: Draft;
  ordinal: number;
  supersedes?: number;
  definition_version: number;
  proposed_by: PrincipalId;
  at: string;
  /** Enforced at propose rather than discovered later (§8.2). */
  body_ceiling_bytes: number;
  classification_required: boolean;
}

/**
 * Snapshot a draft into an immutable version.
 *
 * A draft has no integrity obligations because it is not a record. A version has all of them, and
 * this function is where they are imposed — which is why the checks live here and not in the editor.
 */
export function proposeVersion(input: ProposeInput): Version {
  const { draft } = input;
  const reasons: string[] = [];

  const unconfirmed = unconfirmedExtractions(draft.provenance);
  const unattributed = facetsMissingProvenance(draft.facets, draft.provenance);

  if (unattributed.length > 0) {
    reasons.push(`these facets carry no provenance: ${unattributed.join(', ')}`);
  }
  if (input.classification_required && !draft.classification) {
    reasons.push(
      'this type requires a classification, and a version written without one is unclassifiable rather than merely unclassified',
    );
  }
  const bodyBytes = Buffer.byteLength(draft.body.content, 'utf8');
  if (bodyBytes > input.body_ceiling_bytes) {
    reasons.push(`the body is ${bodyBytes} bytes, over the ${input.body_ceiling_bytes}-byte inline ceiling`);
  }
  if (!draft.title.trim()) {
    reasons.push('a version carries a title; an untitled record is unfindable');
  }

  if (reasons.length > 0) {
    throw new ProposalRefused(
      `This draft cannot be proposed:\n${reasons.map((r) => `  - ${r}`).join('\n')}`,
      reasons,
    );
  }

  const version: Version = {
    workspace: draft.workspace,
    artifact: draft.artifact!,
    type: draft.type,
    title: draft.title.trim(),
    ordinal: input.ordinal,
    state: 'proposed',
    digest: '',
    definition_version: input.definition_version,
    facets: draft.facets,
    provenance: draft.provenance,
    body: draft.body,
    attachments: draft.attachments,
    links: draft.links.map((l) => ({ ...l, pinned_to: l.pinned_to ?? null })),
    proposed_by: input.proposed_by,
    contributors: draft.contributors,
    proposed_at: input.at,
  };

  if (input.supersedes !== undefined) version.supersedes = input.supersedes;
  if (draft.catalogue_refs?.length) version.catalogue_refs = draft.catalogue_refs;
  if (draft.classification) version.classification = draft.classification;
  if (draft.effective) version.effective = draft.effective;

  version.digest = digestVersion(version);

  // Unconfirmed extractions do not block a proposal — they block a *gate*. Proposing a version with
  // an open extraction is how a reviewer is shown what an agent suggested, which is useful; the
  // refusal belongs at the point of consequence.
  void unconfirmed;

  // A version is stored in its canonical form — keys sorted, at every depth — because that is the
  // form the record carries (ADR-0020): the payload an event names is canonical JSON, and a
  // workspace rebuilt from it must read identically to one the service wrote. Key order is not
  // information; a draft keeps the author's, a version does not have one.
  return JSON.parse(canonicalise(version)) as Version;
}

/**
 * Record a contribution, accumulating rather than replacing.
 *
 * "An agent drafted this section and a human proposed it" is recorded rather than inferred, and it
 * carries onto the version — which is what provenance at the artifact level means.
 */
export function recordContribution(
  contributors: Contributor[],
  principal: PrincipalId,
  kind: Contributor['kind'],
  at: string,
): Contributor[] {
  const existing = contributors.find((c) => c.principal === principal);
  if (!existing) return [...contributors, { principal, kind, first: at, last: at }];
  return contributors.map((c) => (c.principal === principal ? { ...c, last: at } : c));
}

export class StaleRevision extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `This draft has moved on: you are editing revision ${expected}, and it is now at ${actual}. ` +
        'Reload to see what changed, then apply your edit again.',
    );
    this.name = 'StaleRevision';
  }
}

/**
 * Optimistic concurrency.
 *
 * A save carrying a stale revision is refused *with the current state*, so a human and an agent
 * editing the same draft resolve without silent loss. Real-time collaborative editing is out of
 * scope; the trigger for revisiting that is a conflict rate, not a request.
 */
export function assertRevision(expected: number, actual: number): void {
  if (expected !== actual) throw new StaleRevision(expected, actual);
}
