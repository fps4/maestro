/**
 * Applying what an adapter translated (`domain/adapters.ts`), as the deployment's intake workload.
 *
 * The adapters authenticate their source, not a person: a GitHub webhook by its HMAC, an SQS record
 * by the queue's policy. What they record is attributed to the workload named by `INTAKE_PRINCIPAL`
 * — identity-service's id — which must be a member of the workspace in the `intake` seat, with the
 * human answerable for it on its membership, like any agent or workload that acts here.
 */

import { Forbidden } from '../auth/context.js';
import type { Store } from '../db/client.js';
import * as decide from '../domain/decide.js';
import type { Translation } from '../domain/adapters.js';
import { IntakeService, type IntakeResult } from './intake.js';
import type { Scope, WorkItemService } from './work-items.js';

export type AdapterResult =
  IntakeResult | { outcome: 'linked'; items: string[] } | { outcome: 'ignored'; reason: string; items: [] };

/** The intake workload's scope in a workspace, refused unless its membership lets it act there. */
export async function intakeScope(store: Store, workspace: string, principal: string): Promise<Scope> {
  const handle = await store.handle(workspace);
  const membership = await handle.memberships.get(principal);
  if (!membership?.roles.includes('intake')) {
    throw new Forbidden(
      `\`${principal}\` holds no \`intake\` seat in \`${workspace}\`; admit it with workspace:member.`,
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
  return {
    workspace,
    handle,
    actor: { principal, kind: 'workload', roles: membership.roles, accountable: membership.accountable },
  };
}

export class AdapterService {
  private readonly intake: IntakeService;

  constructor(private readonly items: WorkItemService) {
    this.intake = new IntakeService(items);
  }

  async apply(scope: Scope, t: Translation): Promise<AdapterResult> {
    switch (t.kind) {
      case 'ignored':
        return { outcome: 'ignored', reason: t.reason, items: [] };
      case 'signal':
        return this.intake.signal(scope, t.signal);
      case 'fact':
        return this.intake.fact(scope, t.fact);
      case 'link':
        return this.link(scope, t);
    }
  }

  /**
   * Dependabot opened the pull request that fixes an advisory: link it to every open advisory item
   * on that application for that package that has none yet — what arms its `merged_change`.
   */
  private async link(scope: Scope, t: Extract<Translation, { kind: 'link' }>): Promise<AdapterResult> {
    const suffix = `:${t.repository}:${t.package}`.toLowerCase();
    const open = (await scope.handle.items.ofApplication(t.application)).filter(
      (i) =>
        i.state !== 'closed' &&
        i.class === 'remediation' &&
        i.fingerprint?.toLowerCase().endsWith(suffix) &&
        !i.links?.pull_request,
    );
    const linked: string[] = [];
    for (const item of open) {
      const { result } = await this.items.act(scope, item.item_id, (env, head) => {
        const events = head.links?.pull_request ? [] : decide.link(env, head, 'pull_request', t.pull_request);
        return { events, result: events.length > 0 };
      });
      if (result) linked.push(item.item_id);
    }
    return { outcome: 'linked', items: linked };
  }
}
