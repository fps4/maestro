/**
 * The ledger and the register: every command is read → decide → evolve → one conditional
 * transaction (maestro ADR-0027; the shape of ADR-0019 §4).
 *
 * The heads are read inside the transaction's work, so a condition that fails — a deploy that lost
 * the race for an instance, a counter that moved — re-runs the whole thing against what won. The
 * delivery is inserted in the same transaction, so a redelivered event is answered with the first
 * result and never recorded twice.
 *
 * Two things happen after the commit, not in it: an SBOM's components are written (hundreds of rows,
 * idempotent by key), and a digest mismatch is sent to work-service as a signal.
 */

import { uuidv7 } from '@fps4/maestro-spine';
import { Forbidden, type RequestContext } from '../auth/context.js';
import type { Store } from '../db/client.js';
import { Conflict, type Transaction, type WorkspaceHandle } from '../db/handle.js';
import type { ComponentRow, DeployRow } from '../db/runtime.js';
import * as decide from '../domain/decide.js';
import type { Actor, Env } from '../domain/decide.js';
import {
  evolveApplication,
  evolveArtifact,
  evolveInstance,
  type ApplicationHead,
  type ArtifactHead,
  type InstanceHead,
  type OnboardingLevel,
  type RuntimeEvent,
  type Tier,
} from '../domain/events.js';
import { componentsOf, type Intake } from '../domain/intake.js';
import type { PrincipalKind } from '../domain/ids.js';
import { NotFound } from '../http/errors.js';
import type { SbomStore } from '../record/sbom-store.js';
import type { SignalSink } from '../signals/sink.js';
import { emit, type Recordable } from './recorder.js';
import type { WorkspaceRegistry } from './workspaces.js';

export interface RuntimeDeps {
  store: Store;
  sboms: SbomStore;
  signals: SignalSink;
  workspaces: WorkspaceRegistry;
  now: () => string;
}

/** Who acts, where: a request's caller, or the intake workload taking in the queue. */
export interface Scope {
  workspace: string;
  handle: WorkspaceHandle;
  actor: Actor;
}

export const scopeOf = (ctx: RequestContext): Scope => ({
  workspace: ctx.workspace,
  handle: ctx.handle,
  actor: { principal: ctx.caller.principal, kind: ctx.caller.kind, roles: ctx.caller.roles },
});

/**
 * The intake workload's scope: admitted to the workspace with `intake`, and with a human answerable
 * for it, as every workload and agent here must have.
 */
export async function intakeScope(store: Store, workspace: string, principal: string): Promise<Scope> {
  const handle = await store.handle(workspace);
  const membership = await handle.memberships.get(principal);
  if (!membership?.roles.includes('intake')) {
    throw new Forbidden(
      `\`${principal}\` holds no \`intake\` role in \`${workspace}\`; admit it with workspace:member.`,
    );
  }
  if (!membership.accountable) {
    throw new Forbidden(
      `\`${principal}\` is admitted to \`${workspace}\` with no answerable human; it cannot act.`,
    );
  }
  await store.control.principals.seen(
    principal,
    'workload',
    new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  );
  return { workspace, handle, actor: { principal, kind: 'workload', roles: membership.roles } };
}

/** What an arrival became. A redelivery answers with the first result, marked replayed. */
export interface IntakeResult {
  outcome: 'recorded' | 'known' | 'ignored';
  reason?: string;
  events: string[];
  /** The deploy named a digest with no build record. */
  mismatch?: boolean;
  /** What happened to the mismatch's signal to work-service. */
  signal?: 'delivered' | 'failed';
  replayed?: boolean;
}

/** An instance as the estate reads it: the head, with the level and tier a person last set. */
export type InstanceView = InstanceHead & Pick<ApplicationHead, 'onboarding_level' | 'tier'>;

export interface CarriesRow {
  instance_id: string;
  application: string;
  environment: string;
  digest: string;
  version: string;
}

const SOURCE = 'eventbridge';

export class RuntimeService {
  constructor(private readonly deps: RuntimeDeps) {}

  private async env(scope: Scope): Promise<Env> {
    return {
      definition: await this.deps.workspaces.current(scope.workspace),
      actor: scope.actor,
      now: this.deps.now(),
    };
  }

  private principals = async (ids: string[]): Promise<Map<string, PrincipalKind>> => {
    const found = await this.deps.store.control.principals.getMany(ids);
    return new Map(found.map((p) => [p.id, p.kind]));
  };

  /** Stage the events' outbox rows; each carries its subject's revision after it. */
  private async record(tx: Transaction, scope: Scope, env: Env, recordables: Array<[RuntimeEvent, number]>) {
    const rows: Recordable[] = recordables.map(([event, subject_seq]) => ({
      event,
      subject_seq,
      consequence_class: env.definition.consequence_class,
    }));
    await emit(
      tx,
      {
        handle: scope.handle,
        workspace: scope.workspace,
        correlation_id: uuidv7(),
        principals: this.principals,
      },
      rows,
    );
  }

  /** A build or a deploy from the bus, taken in once. */
  async intake(scope: Scope, arrival: Intake): Promise<IntakeResult> {
    if (arrival.kind === 'ignored') {
      if (arrival.delivery) {
        await scope.handle.deliveries.put(
          { source: SOURCE, delivery_id: arrival.delivery, outcome: 'ignored', reason: arrival.reason },
          this.deps.now(),
        );
      }
      return { outcome: 'ignored', reason: arrival.reason, events: [] };
    }
    const seen = await scope.handle.deliveries.get(SOURCE, arrival.delivery);
    if (seen) return this.replay(seen);
    try {
      return arrival.kind === 'build' ? await this.build(scope, arrival) : await this.deploy(scope, arrival);
    } catch (error) {
      // The same delivery raced itself, and the other one won: answer with what it recorded.
      if (error instanceof Conflict && !error.retry) {
        const won = await scope.handle.deliveries.get(SOURCE, arrival.delivery);
        if (won) return this.replay(won);
      }
      throw error;
    }
  }

  private replay(d: { outcome: string; reason?: string }): IntakeResult {
    return {
      outcome: d.outcome as IntakeResult['outcome'],
      ...(d.reason ? { reason: d.reason } : {}),
      events: [],
      replayed: true,
    };
  }

  private async unrecorded(scope: Scope, delivery: string, outcome: 'known' | 'ignored', reason?: string) {
    await scope.handle.deliveries.put(
      { source: SOURCE, delivery_id: delivery, outcome, ...(reason ? { reason } : {}) },
      this.deps.now(),
    );
    return { outcome, ...(reason ? { reason } : {}), events: [] };
  }

  private async build(scope: Scope, arrival: Extract<Intake, { kind: 'build' }>): Promise<IntakeResult> {
    const env = await this.env(scope);
    const { detail } = arrival;
    // Read before the transaction: a missing or foreign SBOM refuses the build record whole, and the
    // queue retries it — a build is not recorded without what it says it carries.
    const components: ComponentRow[] = detail.sbom
      ? componentsOf(await this.deps.sboms.get(detail.application, detail.sbom)).map((c) => ({
          ...c,
          application: detail.application,
          digest: detail.digest,
        }))
      : [];

    const result = await scope.handle.transaction(async (tx) => {
      const head = await scope.handle.artifacts.get(detail.application, detail.digest);
      const decided = decide.build(env, arrival.at, detail, head);
      if ('ignored' in decided) return { ignored: decided.ignored };
      if (decided.events.length === 0) return { known: true as const };
      let after = head;
      const recordables: Array<[RuntimeEvent, number]> = [];
      for (const event of decided.events) {
        after = evolveArtifact(after, event);
        recordables.push([event, after.revision]);
      }
      scope.handle.artifacts.stage(tx, head, after!);
      scope.handle.deliveries.stageInsert(
        tx,
        { source: SOURCE, delivery_id: arrival.delivery, outcome: 'recorded' },
        env.now,
      );
      await this.record(tx, scope, env, recordables);
      return { events: decided.events.map((e) => e.type) };
    });

    if ('ignored' in result) return this.unrecorded(scope, arrival.delivery, 'ignored', result.ignored);
    if ('known' in result) return this.unrecorded(scope, arrival.delivery, 'known');
    await scope.handle.components.putMany(components);
    return { outcome: 'recorded', events: result.events };
  }

  private async deploy(scope: Scope, arrival: Extract<Intake, { kind: 'deploy' }>): Promise<IntakeResult> {
    const env = await this.env(scope);
    const { detail } = arrival;
    const result = await scope.handle.transaction(async (tx) => {
      const artifact = await scope.handle.artifacts.get(detail.application, detail.digest);
      const instance = await scope.handle.instances.get(detail.application, detail.environment);
      const decided = decide.deploy(env, arrival.at, detail, artifact, instance);
      if ('ignored' in decided) return { ignored: decided.ignored };

      const recordables: Array<[RuntimeEvent, number]> = [];
      let ledger = artifact;
      for (const event of decided.artifact) {
        ledger = evolveArtifact(ledger, event);
        recordables.push([event, ledger.revision]);
      }
      if (ledger !== artifact) scope.handle.artifacts.stage(tx, artifact, ledger!);

      let head = instance;
      for (const event of decided.instance) {
        head = evolveInstance(head, event);
        recordables.push([event, head.revision]);
      }
      scope.handle.instances.stage(tx, instance, head!);
      const deployed = decided.instance[0]!;
      scope.handle.instances.stageDeploy(tx, {
        application: detail.application,
        environment: detail.environment,
        revision: (instance?.revision ?? 0) + 1,
        digest: detail.digest,
        commit: detail.commit,
        deployed_at: arrival.at,
        deployed_by: deployed.acting,
        ...(deployed.type === 'ArtifactDeployed' && deployed.body.previous
          ? { previous: deployed.body.previous }
          : {}),
        mismatch: decided.mismatch,
      });
      scope.handle.deliveries.stageInsert(
        tx,
        { source: SOURCE, delivery_id: arrival.delivery, outcome: 'recorded' },
        env.now,
      );
      await this.record(tx, scope, env, recordables);
      return {
        events: recordables.map(([e]) => e.type),
        mismatch: decided.mismatch,
        // A built digest deployed over a marked instance clears it: the mismatched digest's all-clear.
        cleared: !decided.mismatch && instance?.state === 'mismatched' ? instance.digest : undefined,
      };
    });

    if ('ignored' in result) return this.unrecorded(scope, arrival.delivery, 'ignored', result.ignored);
    const about = {
      workspace: scope.workspace,
      application: detail.application,
      environment: detail.environment,
      at: arrival.at,
      delivery: arrival.delivery,
    };
    if (result.cleared) {
      const signal = await this.deps.signals.mismatch({ ...about, digest: result.cleared, state: 'ok' });
      return { outcome: 'recorded', events: result.events, mismatch: false, signal };
    }
    if (!result.mismatch) return { outcome: 'recorded', events: result.events, mismatch: false };
    const signal = await this.deps.signals.mismatch({ ...about, digest: detail.digest });
    return { outcome: 'recorded', events: result.events, mismatch: true, signal };
  }

  /** A person sets an application's onboarding level: recorded, and projected by work-service. */
  async setLevel(ctx: RequestContext, application: string, level: OnboardingLevel): Promise<ApplicationHead> {
    return this.setOnApplication(ctx, application, (env, head) =>
      decide.setLevel(env, application, level, head),
    );
  }

  /** A person sets an application's tier: recorded, and projected by work-service. */
  async setTier(ctx: RequestContext, application: string, tier: Tier): Promise<ApplicationHead> {
    return this.setOnApplication(ctx, application, (env, head) =>
      decide.setTier(env, application, tier, head),
    );
  }

  private async setOnApplication(
    ctx: RequestContext,
    application: string,
    command: (env: Env, head: ApplicationHead | null) => Array<Parameters<typeof evolveApplication>[1]>,
  ): Promise<ApplicationHead> {
    const scope = scopeOf(ctx);
    const env = await this.env(scope);
    return scope.handle.transaction(async (tx) => {
      const head = await scope.handle.applications.get(application);
      const events = command(env, head);
      if (events.length === 0) return head!;
      let after = head;
      const recordables: Array<[RuntimeEvent, number]> = [];
      for (const event of events) {
        after = evolveApplication(after, event);
        recordables.push([event, after.revision]);
      }
      scope.handle.applications.stage(tx, head, after!);
      await this.record(tx, scope, env, recordables);
      return after!;
    });
  }

  /** The estate: every instance, with its application's level and tier. */
  async estate(ctx: RequestContext): Promise<InstanceView[]> {
    const [instances, applications] = await Promise.all([
      ctx.handle.instances.estate(),
      ctx.handle.applications.list(),
    ]);
    const byApp = new Map(applications.map((a) => [a.application, a]));
    return instances.map((i) => withApplication(i, byApp.get(i.application)));
  }

  async instance(
    ctx: RequestContext,
    application: string,
    environment: string,
  ): Promise<{ instance: InstanceView; artifact: ArtifactHead | null; deploys: DeployRow[] }> {
    const head = await ctx.handle.instances.get(application, environment);
    if (!head)
      throw new NotFound(`No instance of \`${application}\` in \`${environment}\` has been deployed.`);
    const [app, artifact, deploys] = await Promise.all([
      ctx.handle.applications.get(application),
      ctx.handle.artifacts.get(application, head.digest),
      ctx.handle.instances.deploys(application, environment),
    ]);
    return { instance: withApplication(head, app ?? undefined), artifact, deploys };
  }

  async artifact(ctx: RequestContext, application: string, digest: string): Promise<ArtifactHead> {
    const head = await ctx.handle.artifacts.get(application, digest);
    if (!head) throw new NotFound(`No artifact \`${digest}\` of \`${application}\` is in the ledger.`);
    return head;
  }

  /** Every deployed instance whose running artifact's SBOM names the package, at the version it names. */
  async carries(ctx: RequestContext, purl: string): Promise<CarriesRow[]> {
    const [rows, instances] = await Promise.all([
      ctx.handle.components.carrying(purl),
      ctx.handle.instances.estate(),
    ]);
    const versions = new Map<string, string[]>();
    for (const r of rows) {
      const k = `${r.application}#${r.digest}`;
      versions.set(k, [...(versions.get(k) ?? []), r.version]);
    }
    return instances.flatMap((i) =>
      (versions.get(`${i.application}#${i.digest}`) ?? []).map((version) => ({
        instance_id: i.instance_id,
        application: i.application,
        environment: i.environment,
        digest: i.digest,
        version,
      })),
    );
  }
}

function withApplication(i: InstanceHead, app: ApplicationHead | undefined): InstanceView {
  return {
    ...i,
    ...(app?.onboarding_level ? { onboarding_level: app.onboarding_level } : {}),
    ...(app?.tier ? { tier: app.tier } : {}),
  };
}
