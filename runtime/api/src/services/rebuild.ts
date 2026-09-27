/**
 * The rebuild: a workspace's ledger and register from the archive and the SBOM store alone (maestro
 * ADR-0027; the shape of ADR-0019 §4).
 *
 * Verify first — an archive the spine's verifier does not pass is not rebuilt from. Then replay every
 * event in `seq` order through the same `evolve` functions the live path uses. Heads and deploys are
 * derived from the events; an SBOM's components are read again from the store the build record
 * names, so what comes out reads identically to what was dropped.
 *
 * Not rebuilt: memberships (grants, re-applied from the tenant's configuration) and deliveries (an
 * idempotency cache with a TTL).
 */

import {
  parseEventLine,
  readDay,
  verifyRange,
  type ArchiveStore,
  type SpineEvent,
} from '@fps4/maestro-spine';
import type { Store } from '../db/client.js';
import { PROJECTION_VERSION, type OutboxRow } from '../db/handle.js';
import type { ComponentRow, DeployRow } from '../db/runtime.js';
import {
  evolveApplication,
  evolveArtifact,
  evolveInstance,
  type ApplicationHead,
  type ArtifactHead,
  type InstanceHead,
  type RuntimeEvent,
} from '../domain/events.js';
import { spineWorkspaceId } from '../domain/ids.js';
import { componentsOf } from '../domain/intake.js';
import type { SbomStore } from '../record/sbom-store.js';

export class RebuildRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RebuildRefused';
  }
}

export interface RebuildInput {
  workspace: string;
  archive: ArchiveStore;
  sboms: SbomStore;
  /** Drop a populated target first. Without it a populated target is refused. */
  force?: boolean;
  now?: () => string;
}

export interface RebuildReport {
  workspace: string;
  events: number;
  artifacts: number;
  instances: number;
}

const OUTBOX_BATCH = 500;

export class RebuildService {
  constructor(private readonly store: Store) {}

  async rebuild(input: RebuildInput): Promise<RebuildReport> {
    const now = input.now ?? (() => new Date().toISOString());
    const ws = spineWorkspaceId(input.workspace);

    const verdict = await verifyRange(input.archive, ws);
    if (!verdict.ok) {
      throw new RebuildRefused(
        `The archive for \`${ws}\` does not verify at ${verdict.period || '(no period)'}` +
          `${verdict.seq === null ? '' : `, seq ${verdict.seq}`}: ${verdict.reason}. ` +
          'A workspace is not rebuilt from an unverified archive.',
      );
    }

    if (input.force) await this.store.dropWorkspace(input.workspace);
    const populated = await this.store.populatedRecordKinds(input.workspace);
    if (populated.length > 0) {
      throw new RebuildRefused(
        `Workspace \`${input.workspace}\` is not empty (it holds ${populated.join(', ')} items). ` +
          'Pass --force to drop it and rebuild from the archive.',
      );
    }
    const handle = await this.store.handle(input.workspace);

    const artifacts = new Map<string, ArtifactHead>();
    const instances = new Map<string, InstanceHead>();
    const applications = new Map<string, ApplicationHead>();
    const deploys = new Map<string, DeployRow>();
    const rows: OutboxRow[] = [];
    let expected = 1;
    let last = 0;
    const deliveredAt = now();

    for (const day of await input.archive.listDays(ws)) {
      for (const line of await readDay(input.archive, ws, day)) {
        const event = parseEventLine(line);
        if (event.seq !== expected) {
          throw new RebuildRefused(
            `The archive for \`${ws}\` skips from seq ${expected - 1} to ${event.seq}.`,
          );
        }
        const e = runtimeEvent(event);
        let revision: number;
        try {
          revision = this.apply(e, artifacts, instances, applications, deploys);
        } catch (error) {
          throw refuse(event, (error as Error).message);
        }
        if (revision !== event.subject_seq) {
          throw refuse(
            event,
            `the subject is at revision ${revision}, but the event says ${event.subject_seq}`,
          );
        }
        rows.push({
          ...event,
          workspace: input.workspace,
          delivered: true,
          delivered_at: deliveredAt,
          attempts: 1,
        });
        if (rows.length >= OUTBOX_BATCH) await handle.outbox.insertMany(rows.splice(0));
        last = event.seq;
        expected += 1;
      }
    }
    if (rows.length > 0) await handle.outbox.insertMany(rows);

    await handle.artifacts.putMany([...artifacts.values()]);
    await handle.instances.putMany([...instances.values()], [...deploys.values()]);
    await handle.applications.putMany([...applications.values()]);
    const components: ComponentRow[] = [];
    for (const a of artifacts.values()) {
      if (!a.built || !a.sbom) continue;
      for (const c of componentsOf(await input.sboms.get(a.application, a.sbom))) {
        components.push({ ...c, application: a.application, digest: a.digest });
      }
    }
    await handle.components.putMany(components);
    if (last > 0) await handle.counters.putMany([{ name: 'outbox', value: last }]);
    await handle.meta.put({ projection_version: PROJECTION_VERSION });

    return { workspace: input.workspace, events: last, artifacts: artifacts.size, instances: instances.size };
  }

  /** Fold one event onto its subject's head; return the subject's revision after it. */
  private apply(
    e: RuntimeEvent,
    artifacts: Map<string, ArtifactHead>,
    instances: Map<string, InstanceHead>,
    applications: Map<string, ApplicationHead>,
    deploys: Map<string, DeployRow>,
  ): number {
    switch (e.type) {
      case 'ArtifactRecorded': {
        const head = evolveArtifact(artifacts.get(e.subject_id) ?? null, e);
        artifacts.set(e.subject_id, head);
        return head.revision;
      }
      case 'ArtifactDeployed':
      case 'DigestMismatchDetected': {
        const head = evolveInstance(instances.get(e.subject_id) ?? null, e);
        instances.set(e.subject_id, head);
        if (e.type === 'ArtifactDeployed') {
          deploys.set(`${e.subject_id}#${head.revision}`, {
            application: e.body.application,
            environment: e.body.environment,
            revision: head.revision,
            digest: e.body.digest,
            commit: e.body.commit,
            deployed_at: e.at,
            deployed_by: e.acting,
            ...(e.body.previous ? { previous: e.body.previous } : {}),
            mismatch: false,
          });
        } else {
          // The mismatch follows its deploy in the same transaction: it marks that deploy.
          const deploy = deploys.get(`${e.subject_id}#${head.revision - 1}`);
          if (deploy) deploy.mismatch = true;
        }
        return head.revision;
      }
      case 'InstanceLevelSet':
      case 'InstanceTierSet': {
        const head = evolveApplication(applications.get(e.subject_id) ?? null, e);
        applications.set(e.subject_id, head);
        return head.revision;
      }
    }
  }
}

/** The envelope as the fold reads it. */
function runtimeEvent(event: SpineEvent): RuntimeEvent {
  if (!['artifact', 'instance', 'application'].includes(event.subject_type)) {
    throw refuse(event, `subject type \`${event.subject_type}\` is not projected`);
  }
  return {
    type: event.type,
    subject_type: event.subject_type,
    subject_id: event.subject_id,
    at: event.occurred_at,
    accountable: event.accountable,
    acting: event.acting,
    seat: event.seat,
    oversight_level: event.oversight_level,
    body: event.body,
  } as RuntimeEvent;
}

function refuse(event: SpineEvent, why: string): RebuildRefused {
  return new RebuildRefused(`Cannot project seq ${event.seq} (${event.type}, ${event.subject_id}): ${why}`);
}
