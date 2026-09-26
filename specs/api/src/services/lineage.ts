/**
 * Lineage and diff, as service operations rather than something a client assembles.
 *
 * *What changed and who accepted it* is the primary audit question, and *why does this exist* is
 * the second. Both are first-class here so every surface — console, API, MCP — gets the same
 * answer, rather than three clients each walking links slightly differently.
 */

import type { WorkspaceHandle } from '../db/handle.js';
import {
  bodyDiff,
  facetDiff,
  linkDiff,
  type BodyDiff,
  type FacetDiff,
  type LinkDiff,
} from '../domain/diff.js';
import { resolveLinks, type ResolvedLink } from '../domain/links.js';
import { typeIn } from '../domain/workspace-definition.js';
import type { Decision } from '../domain/types.js';
import { NotFound } from './artifacts.js';
import type { LoadedWorkspace } from './workspaces.js';

export interface VersionDiff {
  artifact: string;
  from: { ordinal: number; digest: string };
  to: { ordinal: number; digest: string };
  facets: FacetDiff;
  links: LinkDiff;
  body: BodyDiff;
}

export interface LineageNode {
  artifact: string;
  type: string;
  title: string;
  phase: string;
  accepted_ordinal?: number;
  latest_ordinal: number;
}

export interface LineageEdge {
  from: string;
  to: string;
  type: string;
  /** A frozen pin reports the ordinal it froze to; a following link reports what it resolves to now. */
  pinned: boolean;
  ordinal?: number;
  resolution: ResolvedLink['resolution'];
}

export interface Lineage {
  root: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export class LineageService {
  constructor(
    private readonly handle: WorkspaceHandle,
    private readonly workspace: LoadedWorkspace,
  ) {}

  async diff(artifact: string, from: number, to: number): Promise<VersionDiff> {
    const [a, b] = await Promise.all([
      this.handle.versions.get(artifact, from),
      this.handle.versions.get(artifact, to),
    ]);
    if (!a) throw new NotFound(`Version \`${artifact}@${from}\``);
    if (!b) throw new NotFound(`Version \`${artifact}@${to}\``);

    return {
      artifact,
      from: { ordinal: a.ordinal, digest: a.digest },
      to: { ordinal: b.ordinal, digest: b.digest },
      facets: facetDiff(a.facets, b.facets, a.provenance, b.provenance),
      links: linkDiff(a.links, b.links),
      body: bodyDiff(a.body, b.body),
    };
  }

  /**
   * Walk the link graph from an artifact, in both directions.
   *
   * Breadth-first with a visited set, because links are many-to-many and a cycle between two
   * artifacts that reference each other is legal — a lineage query that hangs on legal data is a
   * lineage query nobody runs twice.
   */
  async lineage(root: string, depth = 4): Promise<Lineage> {
    const start = await this.handle.artifacts.get(root);
    if (!start) throw new NotFound(`Artifact \`${root}\``);

    // Every accepted or proposed version of the workspace, once: the outgoing edges of each level
    // and the incoming ones — which a client cannot compute without reading every artifact — both
    // come from this one bounded read.
    const live = await this.handle.versions.inStates(['accepted', 'proposed']);

    const nodes = new Map<string, LineageNode>();
    const edges: LineageEdge[] = [];
    const seen = new Set<string>();
    let frontier = [root];

    for (let level = 0; level <= depth && frontier.length > 0; level++) {
      const unseen = frontier.filter((id) => !seen.has(id));
      unseen.forEach((id) => seen.add(id));
      if (unseen.length === 0) break;

      const records = await this.handle.artifacts.getMany(unseen);
      for (const record of records) {
        nodes.set(record.id, {
          artifact: record.id,
          type: record.type,
          title: record.title,
          phase: record.phase,
          ...(record.accepted_ordinal ? { accepted_ordinal: record.accepted_ordinal } : {}),
          latest_ordinal: record.latest_ordinal,
        });
      }

      // Outgoing: the links this artifact's most authoritative version declares. An accepted
      // version is what the trail is made of; a proposal is shown only when nothing is accepted.
      const outgoing = live.filter((v) => unseen.includes(v.artifact)).sort((a, b) => b.ordinal - a.ordinal);

      const authoritative = new Map<string, (typeof live)[number]>();
      for (const version of outgoing) {
        const held = authoritative.get(version.artifact);
        if (!held || (held.state !== 'accepted' && version.state === 'accepted')) {
          authoritative.set(version.artifact, version);
        }
      }

      const next: string[] = [];
      for (const version of authoritative.values()) {
        const type = typeIn(this.workspace.definition, version.type);
        if (!type) continue;
        const targets = version.links.map((l) => l.target);
        const acceptedByArtifact = await this.handle.artifacts.acceptedOrdinals(targets);

        for (const link of resolveLinks(version.links, type, (a) => acceptedByArtifact.get(a))) {
          edges.push({
            from: version.artifact,
            to: link.target,
            type: link.type,
            pinned: link.pinned,
            ...(link.ordinal !== undefined ? { ordinal: link.ordinal } : {}),
            resolution: link.resolution,
          });
          next.push(link.target);
        }
      }

      // Incoming: who points *at* these. This is the direction that answers "what happened to my
      // idea".
      const incoming = live.filter((v) => v.links.some((l) => unseen.includes(l.target)));
      for (const version of incoming) {
        for (const link of version.links) {
          if (!unseen.includes(link.target)) continue;
          if (
            edges.some((e) => e.from === version.artifact && e.to === link.target && e.type === link.type)
          ) {
            continue;
          }
          edges.push({
            from: version.artifact,
            to: link.target,
            type: link.type,
            pinned: link.pinned_to != null,
            ...(link.pinned_to != null ? { ordinal: link.pinned_to } : {}),
            resolution: link.pinned_to != null ? 'frozen' : 'follows_lineage',
          });
          next.push(version.artifact);
        }
      }

      frontier = next;
    }

    return { root, nodes: [...nodes.values()], edges };
  }

  /** The decisions taken on an artifact, newest first — the "who accepted it" half of the question. */
  async decisions(artifact: string): Promise<Decision[]> {
    return this.handle.decisions.ofArtifact(artifact);
  }
}
