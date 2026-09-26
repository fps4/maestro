/**
 * The catalogue — standards, read from the one workspace every tenant may read (ADR-0008).
 *
 * A standard is an artifact. It has a lineage, immutable versions, a publication gate with an
 * accountable human, a diff between 3.1.0 and 3.2.0, a body someone reads and facets a machine
 * evaluates. So the catalogue is not a second system: it is this one, with a different workspace
 * definition. What this file adds is the **read across the boundary** and the **acceptance state**
 * a tenant holds against what it reads.
 *
 * Two kinds of standard, and they are distinct types rather than one type with a flag:
 *
 * - `platform_standard` — ours. The body is the standard, carrying the know-how an agent needs.
 * - `external_standard` — ISO, NIST, a regulator. The body is our **summary and our reading**, and
 *   `licence_disposition` records what we are permitted to hold. ISO's licence forbids
 *   redistribution; the Bbl's does not. An auditor is entitled to know which they are reading, and
 *   a settable flag would not tell them reliably.
 */

import type { CatalogueHandle, WorkspaceHandle } from '../db/handle.js';
import { acceptanceStatus, forceStatusAt, type AcceptanceRecord } from '../domain/effective.js';
import type { AcceptanceState } from '../domain/gates.js';
import type { CatalogueRef, Materiality, Version } from '../domain/types.js';

export const PLATFORM_STANDARD = 'platform_standard';
export const EXTERNAL_STANDARD = 'external_standard';
export const CONSTRUCT = 'construct';

export interface StandardSummary {
  artifact: string;
  ordinal: number;
  type: string;
  title: string;
  /** The stable, human-quotable id: `FPS4-SUFF-BASELINE-002`, `ISO-27001-A-8-16`. */
  standard_id: string;
  pack: string;
  pack_version: string;
  tier?: string;
  authority: 'ours' | 'external';
  licence_disposition?: string;
  force: ReturnType<typeof forceStatusAt>;
  effective_from?: string;
  effective_to?: string | null;
  materiality?: Materiality;
  digest: string;
}

interface StandardFacets {
  standard_id?: string;
  pack?: string;
  pack_version?: string;
  tier?: string;
  licence_disposition?: string;
  [key: string]: unknown;
}

type Listed = Pick<
  Version,
  'artifact' | 'ordinal' | 'type' | 'title' | 'facets' | 'effective' | 'materiality' | 'digest' | 'state'
>;

function summarise(version: Listed, at: Date): StandardSummary {
  const facets = version.facets as StandardFacets;
  return {
    artifact: version.artifact,
    ordinal: version.ordinal,
    type: version.type,
    title: version.title,
    standard_id: facets.standard_id ?? version.artifact,
    pack: facets.pack ?? 'unknown',
    pack_version: facets.pack_version ?? 'unknown',
    ...(facets.tier ? { tier: facets.tier } : {}),
    authority: version.type === PLATFORM_STANDARD ? 'ours' : 'external',
    ...(facets.licence_disposition ? { licence_disposition: facets.licence_disposition } : {}),
    force: forceStatusAt(version.effective, at),
    ...(version.effective?.effective_from ? { effective_from: version.effective.effective_from } : {}),
    ...(version.effective?.effective_to !== undefined
      ? { effective_to: version.effective.effective_to }
      : {}),
    ...(version.materiality ? { materiality: version.materiality } : {}),
    digest: version.digest,
  };
}

export class CatalogueReader {
  constructor(private readonly catalogue: CatalogueHandle) {}

  /** Every accepted standard, by its stable id. Bodies excluded — this is a list query. */
  async list(options: { pack?: string; type?: string; at?: Date } = {}): Promise<StandardSummary[]> {
    const at = options.at ?? new Date();
    const types = options.type ? [options.type] : [PLATFORM_STANDARD, EXTERNAL_STANDARD];
    const versions = (await this.catalogue.versions.inStates(['accepted'])).filter((v) => {
      if (!types.includes(v.type)) return false;
      return !options.pack || (v.facets as StandardFacets).pack === options.pack;
    });
    return versions
      .sort((a, b) => standardIdOf(a).localeCompare(standardIdOf(b)) || a.ordinal - b.ordinal)
      .map((v) => summarise(v, at));
  }

  /** One standard, with its body — which is the full text for ours and a summary for an external one. */
  async read(artifact: string, ordinal?: number): Promise<Version | null> {
    return ordinal === undefined
      ? this.catalogue.versions.accepted(artifact)
      : this.catalogue.versions.get(artifact, ordinal);
  }

  /** Resolve stable standard ids to the versions a tenant artifact references (gsi2, one read each). */
  async resolveRefs(refs: CatalogueRef[]): Promise<Map<string, Listed>> {
    const byId = new Map<string, Listed>();
    for (const ref of refs) {
      const match = await this.catalogue.versions.byStandardRef(ref.standard, ref.ordinal);
      if (match) byId.set(ref.standard, match);
    }
    return byId;
  }

  /** Every published version of a standard, for deciding whether an acceptance still stands. */
  async publishedVersions(
    standardId: string,
  ): Promise<Array<{ ordinal: number; materiality?: Materiality }>> {
    const versions = await this.catalogue.versions.byStandard(standardId);
    return versions
      .filter((v) => v.state === 'accepted' || v.state === 'superseded')
      .map((v) => ({
        ordinal: v.ordinal,
        ...(v.materiality ? { materiality: v.materiality } : {}),
      }));
  }
}

const standardIdOf = (v: Listed): string => (v.facets as StandardFacets).standard_id ?? '';

export interface StoredAcceptance extends AcceptanceRecord {
  status: 'active' | 'lapsed' | 'overridden';
  lapsed_at_ordinal?: number;
  /** Product tier only. A regulatory standard has no override control at all. */
  override?: { justification: string; accepted_by: string; expires: string };
}

/**
 * A tenant's acceptances — the answer to "which standards do we comply with, and who said so".
 *
 * This lives in the *tenant's* workspace, not the catalogue, and that is the whole reason it exists
 * separately: a service shared across tenants may hold no tenant runtime data, and every field here
 * is precisely that.
 */
export class AcceptanceService {
  constructor(
    private readonly handle: WorkspaceHandle,
    private readonly reader: CatalogueReader,
  ) {}

  async list(): Promise<StoredAcceptance[]> {
    return this.handle.acceptances.list<StoredAcceptance>();
  }

  /**
   * Recompute every acceptance's status against what the catalogue has published since.
   *
   * A lapse is a **state**, not a notification: it survives being ignored, which is the difference
   * between a control and a message. This is idempotent and safe to run on a schedule or on demand.
   */
  async refresh(): Promise<{ checked: number; lapsed: string[] }> {
    const acceptances = await this.list();
    const lapsed: string[] = [];

    for (const acceptance of acceptances) {
      if (acceptance.status === 'overridden') continue;
      const published = await this.reader.publishedVersions(acceptance.standard);
      const status = acceptanceStatus(acceptance, published);
      if (status.status !== acceptance.status) {
        // An acceptance is keyed by (standard, scope, project) — Wkb acceptance is per project
        // (§3.6), so the tenant-scoped and project-scoped rows for one standard are different
        // acceptances by different parties and must not overwrite each other.
        await this.handle.acceptances.setStatus(
          {
            standard: acceptance.standard,
            scope: acceptance.scope,
            ...(acceptance.project ? { project: acceptance.project } : {}),
          },
          status.status,
          status.lapsed_at_ordinal,
        );
      }
      if (status.status === 'lapsed') lapsed.push(acceptance.standard);
    }

    return { checked: acceptances.length, lapsed };
  }

  /**
   * The acceptance state a gate reads for one version's catalogue references.
   *
   * `absent` is deliberately distinct from `lapsed`: never accepted and no-longer-accepted are
   * different situations with different remedies, and collapsing them would hide which.
   */
  async statesFor(refs: CatalogueRef[] | undefined): Promise<AcceptanceState[]> {
    if (!refs || refs.length === 0) return [];
    const stored = await this.list();
    return refs.map((ref) => {
      const acceptance = stored.find((a) => a.standard === ref.standard);
      if (!acceptance) return { standard: ref.standard, status: 'absent' as const };
      return {
        standard: ref.standard,
        status: acceptance.status,
        accepted_by: acceptance.accepted_by,
        pack_version: acceptance.pack_version,
      };
    });
  }
}
