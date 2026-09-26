/**
 * The evaluator port's local default.
 *
 * ADR-0002 made the evaluator a port with no default: standalone, a gate that required an
 * evaluation could never open. ADR-0015 gives the port a floor the service can carry honestly —
 * the type's own facet schema, reported one finding per required facet, in the schema's own words.
 * It is not a standards engine and says so in its findings' ids: `schema:<field>`, never a
 * standard's id.
 */

import type { FacetIssue } from './facets.js';
import { humanise } from './labels.js';
import type { EvaluationResult, Facets } from './types.js';

/** The little of JSON Schema this reads: `required`, and each property's `title` and `description`. */
interface Schema {
  required?: string[];
  properties?: Record<string, { title?: string; description?: string; [keyword: string]: unknown }>;
}

export interface BuiltinVerdict {
  verdict: EvaluationResult['verdict'];
  findings: NonNullable<EvaluationResult['findings']>;
}

/** One finding per required facet: met when present and valid, unmet with the schema's question when not. */
export function facetSchemaEvaluation(schema: Schema, facets: Facets, issues: FacetIssue[]): BuiltinVerdict {
  const failing = new Set(issues.map((i) => i.path.split('.')[0]).filter(Boolean));
  const findings: BuiltinVerdict['findings'] = (schema.required ?? []).map((field) => {
    const property = schema.properties?.[field];
    const label = property?.title ?? humanise(field);
    const question = property?.description ? ` — ${property.description}` : '';
    const present = field in facets && !failing.has(field);
    return {
      standard: `schema:${field}`,
      outcome: present ? 'met' : 'unmet',
      detail: present ? `${label}${question}: answered.` : `${label}${question}: not answered.`,
    };
  });
  for (const issue of issues) {
    const field = issue.path.split('.')[0];
    if (field && (schema.required ?? []).includes(field)) continue;
    findings.push({
      standard: `schema:${field || 'root'}`,
      outcome: 'unmet',
      detail: `${issue.path || 'The facets'} ${issue.message}.`,
    });
  }
  return { verdict: findings.every((f) => f.outcome === 'met') ? 'pass' : 'fail', findings };
}
