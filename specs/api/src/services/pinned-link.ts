/**
 * The pinned-link requirement's input, computed once for both the gate view and the decision.
 *
 * Kept out of `domain/gates.ts` because it needs the definition's labels; kept out of both
 * services because two copies would drift, and the gate view and the decision must never disagree
 * about whether a gate is open.
 */

import { labelsFor } from '../domain/labels.js';
import type { GateInput } from '../domain/gates.js';
import type { Version } from '../domain/types.js';
import { pinnedLinkFor, typeIn, type WorkspaceDefinition } from '../domain/workspace-definition.js';

export function pinnedLinkInput(
  def: WorkspaceDefinition,
  version: Pick<Version, 'type' | 'links'>,
): Pick<GateInput, 'pinned_link'> {
  const type = typeIn(def, version.type);
  const pinned = type ? pinnedLinkFor(type) : undefined;
  if (!pinned) return {};
  const labels = labelsFor(def);
  return {
    pinned_link: {
      type: pinned.id,
      label: labels.links[pinned.id] ?? pinned.id,
      target_label: labels.types[pinned.to]?.title.toLowerCase() ?? pinned.to,
      present: version.links.some((l) => l.type === pinned.id),
    },
  };
}
