/**
 * Links, and the pin.
 *
 * Links are typed, directional, many-to-many and mutable. **Exactly one link per type may be
 * pinned**, and a pinned link resolves to a specific *version* at acceptance and freezes there.
 *
 * That distinction is what makes the trail hold: a technical design pinned to functional spec `v4`
 * still reads against `v4` after the spec is superseded eleven times. An auditor reading a
 * five-year-old specification sees the case as it read when someone accepted it, not as it was
 * subsequently rewritten.
 */

import type { Link } from './types.js';
import type { TypeDeclaration } from './workspace-definition.js';

export class PinRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinRefused';
  }
}

export type AcceptedOrdinalResolver = (artifact: string) => number | undefined;

/**
 * Freeze the pinned link at acceptance.
 *
 * Called once, when a gate accepts a version, and never again. If the pin's target has no accepted
 * version there is nothing honest to freeze to, and the acceptance is refused rather than the pin
 * being left dangling — a pin pointing at a proposal is not a justification.
 */
export function freezePins(
  links: Link[],
  type: TypeDeclaration,
  resolveAccepted: AcceptedOrdinalResolver,
): Link[] {
  const pinnedType = type.links.find((l) => l.pinned);
  if (!pinnedType) return links;

  return links.map((link) => {
    if (link.type !== pinnedType.id) return link;
    if (link.pinned_to != null) return link; // already frozen; never repointed

    const ordinal = resolveAccepted(link.target);
    if (ordinal === undefined) {
      throw new PinRefused(
        `Cannot accept: the pinned link \`${link.type}\` points at \`${link.target}\`, which has no accepted version. ` +
          'A pin freezes to what was accepted, and there is nothing to freeze to.',
      );
    }
    return { ...link, pinned_to: ordinal };
  });
}

/**
 * Refuse any change to a frozen pin.
 *
 * MongoDB has no foreign keys and no check constraints (§8.4), so this is enforced in application
 * code — in one place, called before every write that could touch links.
 */
export function assertPinsUnchanged(before: Link[], after: Link[]): void {
  for (const b of before) {
    if (b.pinned_to == null) continue;
    const match = after.find((a) => a.type === b.type && a.target === b.target);
    if (!match) {
      throw new PinRefused(
        `The pinned link \`${b.type}\` → \`${b.target}@${b.pinned_to}\` cannot be removed. The audit chain is the product.`,
      );
    }
    if (match.pinned_to !== b.pinned_to) {
      throw new PinRefused(
        `The pinned link \`${b.type}\` is frozen to \`${b.target}@${b.pinned_to}\` and cannot be repointed to @${match.pinned_to}.`,
      );
    }
  }
}

/**
 * Refuse a link to a type the definition does not permit from here.
 *
 * A typed edge whose type is undeclared is not a link, it is a note — and it would silently escape
 * every lineage query, which is worse than being refused.
 */
export function assertLinksDeclared(links: Link[], type: TypeDeclaration): void {
  const declared = new Map(type.links.map((l) => [l.id, l]));
  for (const link of links) {
    if (!declared.has(link.type)) {
      throw new PinRefused(
        `Type \`${type.id}\` declares no link \`${link.type}\`. Declared: ${
          type.links.map((l) => l.id).join(', ') || '(none)'
        }.`,
      );
    }
  }
  // At most one instance of the pinned link type: two frozen references would make "the version
  // that justified this" ambiguous, which is the property the pin exists to provide.
  const pinnedType = type.links.find((l) => l.pinned);
  if (pinnedType) {
    const count = links.filter((l) => l.type === pinnedType.id).length;
    if (count > 1) {
      throw new PinRefused(
        `\`${pinnedType.id}\` is the pinned link for \`${type.id}\`, so there can be at most one; found ${count}.`,
      );
    }
  }
}

/**
 * How a link resolves for a reader.
 *
 * A pinned link reports the frozen ordinal; everything else reports the latest accepted one and
 * says so. The console shows the difference because it is the difference that matters.
 */
export interface ResolvedLink {
  type: string;
  target: string;
  pinned: boolean;
  ordinal?: number;
  resolution: 'frozen' | 'follows_lineage' | 'unresolved';
}

export function resolveLinks(
  links: Link[],
  type: TypeDeclaration,
  resolveAccepted: AcceptedOrdinalResolver,
): ResolvedLink[] {
  const pinnedType = type.links.find((l) => l.pinned)?.id;
  return links.map((link) => {
    if (link.type === pinnedType && link.pinned_to != null) {
      return {
        type: link.type,
        target: link.target,
        pinned: true,
        ordinal: link.pinned_to,
        resolution: 'frozen',
      };
    }
    const ordinal = resolveAccepted(link.target);
    return {
      type: link.type,
      target: link.target,
      pinned: link.type === pinnedType,
      ...(ordinal !== undefined ? { ordinal } : {}),
      resolution: ordinal === undefined ? 'unresolved' : 'follows_lineage',
    };
  });
}
