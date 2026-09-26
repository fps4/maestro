/**
 * The attribution profile — the one place a consumer's vocabulary reaches a decision record (§2.8).
 *
 * The generic rule underneath every profile: **a named human is answerable, and an agent can never
 * occupy that field.** Enforced at write time, because a rule checked at read time is a report
 * rather than a control.
 *
 * A decision missing a required field is rejected, and the rejection is itself recorded — silence
 * about a refused write is how a control becomes invisible.
 */

import type { AttributionProfile } from './workspace-definition.js';
import type { Attribution, Principal, PrincipalId } from './types.js';

export interface AttributionIssue {
  field: string;
  message: string;
}

export class AttributionRefused extends Error {
  constructor(readonly issues: AttributionIssue[]) {
    super(`This decision cannot be recorded:\n${issues.map((i) => `  ${i.field}: ${i.message}`).join('\n')}`);
    this.name = 'AttributionRefused';
  }
}

export type PrincipalResolver = (id: PrincipalId) => Principal | undefined;

export function checkAttribution(
  profile: AttributionProfile,
  attribution: Attribution,
  resolve: PrincipalResolver,
): AttributionIssue[] {
  const issues: AttributionIssue[] = [];
  const known = new Set([...profile.required, ...profile.optional]);

  for (const field of profile.required) {
    const value = attribution[field];
    if (!value) {
      issues.push({ field, message: 'is required by this profile and was not supplied' });
    }
  }

  for (const [field, value] of Object.entries(attribution)) {
    if (!value) continue;
    if (!known.has(field)) {
      // Not an error. A profile declares what it *requires*; extra context is recorded rather than
      // discarded, because a record that silently drops what someone supplied is worse than a
      // verbose one.
      continue;
    }
    const rule = profile.rules[field];
    if (!rule) continue;

    const principal = resolve(value);
    if (!principal) {
      issues.push({ field, message: `must resolve to a known principal; \`${value}\` does not` });
      continue;
    }
    if (rule.kind && principal.kind !== rule.kind) {
      issues.push({
        field,
        message:
          rule.kind === 'human'
            ? `must be a human. \`${value}\` is ${indefinite(principal.kind)} ${principal.kind}, and an agent can never be answerable for a decision`
            : `must be a principal of kind \`${rule.kind}\`; \`${value}\` is \`${principal.kind}\``,
      });
    }
  }

  return issues;
}

export function assertAttribution(
  profile: AttributionProfile,
  attribution: Attribution,
  resolve: PrincipalResolver,
): void {
  const issues = checkAttribution(profile, attribution, resolve);
  if (issues.length > 0) throw new AttributionRefused(issues);
}

function indefinite(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}
