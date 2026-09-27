/**
 * The ledger, the register and what hangs off them, in the table (maestro ADR-0027 §1). One method
 * per access pattern. A head is staged on the condition that its revision is the one read, so two
 * deploys to one instance cannot both win: the loser re-reads and is decided again.
 */

import type { ApplicationHead, ArtifactHead, InstanceHead } from '../domain/events.js';
import type { Bound } from './handle.js';
import { strip, type Item, type Transaction } from './items.js';
import { KINDS } from './keys.js';
import { PK } from './table.js';

/** Stage a head: created on the condition it does not exist, moved on the condition its revision is the one read. */
function stageHead(tx: Transaction, row: Item, before: { revision: number } | null, what: string): void {
  tx.put(row, {
    condition: (e) =>
      before ? `${e.n('revision')} = ${e.v(before.revision)}` : `attribute_not_exists(${e.n(PK)})`,
    onConflict: `${what} moved while this was decided.`,
    retry: true,
  });
}

export class ArtifactRepository {
  constructor(private readonly b: Bound) {}

  private row(head: ArtifactHead): Item {
    return {
      ...this.b.keys.artifact(head.application, head.digest),
      kind: KINDS.artifact,
      ...head,
      ...this.b.keys.builtKey(head.recorded_at, head.application, head.digest),
    };
  }

  async get(application: string, digest: string): Promise<ArtifactHead | null> {
    const row = await this.b.items.get(this.b.keys.artifact(application, digest));
    return row ? strip<ArtifactHead>(row) : null;
  }

  async getMany(keys: Array<{ application: string; digest: string }>): Promise<ArtifactHead[]> {
    if (keys.length === 0) return [];
    const rows = await this.b.items.batchGet(keys.map((k) => this.b.keys.artifact(k.application, k.digest)));
    return rows.map((r) => strip<ArtifactHead>(r));
  }

  stage(tx: Transaction, before: ArtifactHead | null, after: ArtifactHead): void {
    stageHead(tx, this.row(after), before, `Artifact \`${after.application}@${after.digest}\``);
  }

  /** A rebuild's: the heads as the fold left them. */
  async putMany(heads: ArtifactHead[]): Promise<void> {
    await this.b.items.batchWrite(heads.map((h) => this.row(h)));
  }
}

/** One deploy on an instance, beside its head: what went out, by whom, and what it replaced. */
export interface DeployRow {
  application: string;
  environment: string;
  revision: number;
  digest: string;
  commit: string;
  deployed_at: string;
  deployed_by: string;
  previous?: string;
  /** The digest had no build record when it was deployed. */
  mismatch: boolean;
}

export class InstanceRepository {
  constructor(private readonly b: Bound) {}

  private row(head: InstanceHead): Item {
    return {
      ...this.b.keys.instance(head.application, head.environment),
      kind: KINDS.instance,
      ...head,
      ...this.b.keys.estateKey(head.application, head.environment),
    };
  }

  private deployRow(d: DeployRow): Item {
    return { ...this.b.keys.deploy(d.application, d.environment, d.revision), kind: KINDS.deploy, ...d };
  }

  async get(application: string, environment: string): Promise<InstanceHead | null> {
    const row = await this.b.items.get(this.b.keys.instance(application, environment));
    return row ? strip<InstanceHead>(row) : null;
  }

  /** The estate: every instance, by application and environment. */
  async estate(): Promise<InstanceHead[]> {
    const rows = await this.b.items.query(this.b.keys.estate, { index: 'gsi1' });
    return rows.map((r) => strip<InstanceHead>(r));
  }

  /** An instance's deploys, newest first. */
  async deploys(application: string, environment: string): Promise<DeployRow[]> {
    const rows = await this.b.items.query(this.b.keys.instancePartition(application, environment), {
      sk: { beginsWith: 'deploy#' },
      forward: false,
    });
    return rows.map((r) => strip<DeployRow>(r));
  }

  stage(tx: Transaction, before: InstanceHead | null, after: InstanceHead): void {
    stageHead(tx, this.row(after), before, `Instance \`${after.instance_id}\``);
  }

  stageDeploy(tx: Transaction, d: DeployRow): void {
    tx.put(this.deployRow(d));
  }

  async putMany(heads: InstanceHead[], deploys: DeployRow[]): Promise<void> {
    await this.b.items.batchWrite([
      ...heads.map((h) => this.row(h)),
      ...deploys.map((d) => this.deployRow(d)),
    ]);
  }
}

export class ApplicationRepository {
  constructor(private readonly b: Bound) {}

  private row(head: ApplicationHead): Item {
    return { ...this.b.keys.application(head.application), kind: KINDS.application, ...head };
  }

  async get(application: string): Promise<ApplicationHead | null> {
    const row = await this.b.items.get(this.b.keys.application(application));
    return row ? strip<ApplicationHead>(row) : null;
  }

  async list(): Promise<ApplicationHead[]> {
    const rows = await this.b.items.query(this.b.keys.applications);
    return rows.map((r) => strip<ApplicationHead>(r));
  }

  stage(tx: Transaction, before: ApplicationHead | null, after: ApplicationHead): void {
    stageHead(tx, this.row(after), before, `Application \`${after.application}\``);
  }

  async putMany(heads: ApplicationHead[]): Promise<void> {
    await this.b.items.batchWrite(heads.map((h) => this.row(h)));
  }
}

/** A line of an SBOM: an artifact of this application carries this package at this version. */
export interface ComponentRow {
  purl: string;
  application: string;
  digest: string;
  version: string;
}

export class ComponentRepository {
  constructor(private readonly b: Bound) {}

  /** Every artifact whose SBOM names the package, at the version it names. */
  async carrying(purl: string): Promise<ComponentRow[]> {
    const rows = await this.b.items.query(this.b.keys.carries(purl));
    return rows.map((r) => strip<ComponentRow>(r));
  }

  /**
   * Written after the artifact's transaction, not in it: an SBOM names hundreds of packages and a
   * transaction holds a hundred items. Idempotent — each row is keyed by what it says — so a retry
   * of the same build writes the same rows, and a rebuild writes them again from the SBOM.
   */
  async putMany(rows: ComponentRow[]): Promise<void> {
    await this.b.items.batchWrite(
      rows.map((c) => ({
        ...this.b.keys.component(c.purl, c.application, c.digest, c.version),
        kind: KINDS.component,
        ...c,
      })),
    );
  }
}

/** A delivery already taken in, and what it became. Not record: an idempotency cache, seven days. */
export interface DeliveryRecord {
  source: string;
  delivery_id: string;
  outcome: string;
  reason?: string;
}

export const DELIVERY_TTL_SECONDS = 7 * 86_400;

export class DeliveryRepository {
  constructor(private readonly b: Bound) {}

  async get(source: string, id: string): Promise<DeliveryRecord | null> {
    const row = await this.b.items.get(this.b.keys.delivery(source, id));
    return row ? strip<DeliveryRecord>(row) : null;
  }

  private row(d: DeliveryRecord, now: string): Item {
    return {
      ...this.b.keys.delivery(d.source, d.delivery_id),
      kind: KINDS.delivery,
      ...d,
      expires_at: Math.floor(Date.parse(now) / 1000) + DELIVERY_TTL_SECONDS,
    };
  }

  /** In the recording transaction: a redelivery fails the condition and is answered with the first result. */
  stageInsert(tx: Transaction, d: DeliveryRecord, now: string): void {
    tx.insert(this.row(d, now), `Delivery \`${d.source}:${d.delivery_id}\` was already taken in.`);
  }

  /** For an arrival that recorded nothing: ignored, or already known. */
  async put(d: DeliveryRecord, now: string): Promise<void> {
    await this.b.items.put(this.row(d, now));
  }
}
