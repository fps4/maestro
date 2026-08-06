/**
 * Facets — the only thing a gate or an evaluator reads (ADR-0004).
 *
 * Two jobs live here and they are different. **Validation** answers whether a facet set satisfies
 * the type's declared JSON Schema. **Provenance** answers whether a value may be believed: an agent
 * may extract a facet, and until a named human confirms it that extraction cannot reach a gate.
 *
 * The second is what makes generous agent authority safe. Draft freely, extract freely — the
 * constraint sits at the point of consequence rather than spread across everything an agent touches.
 */

import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
// Both packages are CommonWJS with `exports.default`, so TypeScript under NodeNext resolves a
// default import to the module object rather than the function. Reaching through `.default` is
// correct in both worlds: at runtime the function carries a self-referential `.default`.
import addFormatsModule from 'ajv-formats';
import type { Facets, FacetProvenance, PrincipalId, ProvenanceMap } from './types.js';

const addFormats = addFormatsModule.default;

export interface FacetIssue {
  /** The failing path inside the facet set, e.g. `declared_outcome.target`. */
  path: string;
  message: string;
  /** The schema rule that rejected it, e.g. `required`, `type`, `minimum`. */
  rule: string;
}

export class FacetValidationError extends Error {
  constructor(
    readonly issues: FacetIssue[],
    readonly type: string,
  ) {
    super(
      `Facets do not satisfy the schema for type \`${type}\`:\n` +
        issues.map((i) => `  ${i.path || '(root)'}: ${i.message} [${i.rule}]`).join('\n'),
    );
    this.name = 'FacetValidationError';
  }
}

/**
 * One Ajv instance per process, with schemas compiled once per type.
 *
 * Compilation is the expensive part and facet validation happens on every draft save, so a fresh
 * compile per request would make autosave the slowest thing in the service.
 */
export class FacetValidator {
  private readonly ajv: Ajv;
  private readonly compiled = new Map<string, ValidateFunction>();

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      strict: false, // a workspace's schema is authored data; we validate against it, not it
      allowUnionTypes: true,
    });
    addFormats(this.ajv);
  }

  register(typeId: string, schema: object): void {
    this.compiled.set(typeId, this.ajv.compile(schema));
  }

  has(typeId: string): boolean {
    return this.compiled.has(typeId);
  }

  /** Returns the issues rather than throwing, because a draft may legitimately be invalid. */
  check(typeId: string, facets: Facets): FacetIssue[] {
    const validate = this.compiled.get(typeId);
    if (!validate) {
      return [{ path: '', message: `no facet schema registered for type \`${typeId}\``, rule: 'schema' }];
    }
    if (validate(facets)) return [];
    return (validate.errors ?? []).map(describeError);
  }

  /** Throws with the failing path named. Used at propose, where an invalid facet set is refused. */
  assert(typeId: string, facets: Facets): void {
    const issues = this.check(typeId, facets);
    if (issues.length > 0) throw new FacetValidationError(issues, typeId);
  }
}

function describeError(error: ErrorObject): FacetIssue {
  // Ajv reports `/declared_outcome/target`; a human reads `declared_outcome.target`.
  const instancePath = error.instancePath.replace(/^\//, '').replace(/\//g, '.');
  const missing =
    error.keyword === 'required' ? (error.params as { missingProperty?: string }).missingProperty : null;
  const path = missing ? [instancePath, missing].filter(Boolean).join('.') : instancePath;
  const message = missing ? 'is required' : (error.message ?? 'is invalid');
  return { path, message, rule: error.keyword };
}

// --- provenance ---

/**
 * The facets an agent proposed that no human has confirmed.
 *
 * A gate declaring `confirmed_facets: true` refuses to open while this is non-empty, and the
 * editor disables propose and names them — the rule is enforced where it is felt, not only where
 * it is checked.
 */
export function unconfirmedExtractions(provenance: ProvenanceMap): string[] {
  return Object.entries(provenance)
    .filter(([, p]) => p.source === 'extracted' && !p.confirmed_by)
    .map(([field]) => field)
    .sort();
}

/**
 * Facets with no provenance at all.
 *
 * A value nobody claims is worse than one an agent claims: `extracted` is at least honest about
 * needing confirmation. This is checked at propose, so provenance cannot be quietly dropped.
 */
export function facetsMissingProvenance(facets: Facets, provenance: ProvenanceMap): string[] {
  return Object.keys(facets)
    .filter((field) => !provenance[field])
    .sort();
}

export function confirmFacet(
  provenance: ProvenanceMap,
  field: string,
  by: PrincipalId,
  at: string,
): ProvenanceMap {
  const existing = provenance[field];
  if (!existing) throw new Error(`Cannot confirm \`${field}\`: it carries no provenance`);
  if (existing.source !== 'extracted') {
    throw new Error(
      `Cannot confirm \`${field}\`: only an extracted facet needs confirmation, this is \`${existing.source}\``,
    );
  }
  return { ...provenance, [field]: { ...existing, confirmed_by: by, confirmed_at: at } };
}

/**
 * Confirmation is void when the value changes.
 *
 * Otherwise an agent could extract a value, a human could confirm it, and a later extraction pass
 * could replace the value while the confirmation stayed attached — which is exactly the drift
 * confirmation exists to prevent.
 */
export function invalidateConfirmations(
  before: Facets,
  after: Facets,
  provenance: ProvenanceMap,
): ProvenanceMap {
  const next: ProvenanceMap = { ...provenance };
  for (const [field, p] of Object.entries(provenance)) {
    if (p.source !== 'extracted' || !p.confirmed_by) continue;
    if (!valuesEqual(before[field], after[field])) {
      const { confirmed_by: _c, confirmed_at: _a, ...rest } = p;
      next[field] = rest as FacetProvenance;
    }
  }
  return next;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Whether every facet may be believed for the purposes of a gate.
 *
 * Returns the reasons rather than a boolean, because "this cannot be decided yet" is only useful
 * to the person holding it if it says which fields and why.
 */
export function gateReadiness(
  facets: Facets,
  provenance: ProvenanceMap,
): { ready: boolean; unconfirmed: string[]; unattributed: string[] } {
  const unconfirmed = unconfirmedExtractions(provenance);
  const unattributed = facetsMissingProvenance(facets, provenance);
  return { ready: unconfirmed.length === 0 && unattributed.length === 0, unconfirmed, unattributed };
}
