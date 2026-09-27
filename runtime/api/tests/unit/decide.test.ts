import { describe, expect, it } from 'vitest';
import * as decide from '../../src/domain/decide.js';
import { parseWorkspaceDefinition } from '../../src/domain/definition.js';
import { evolveArtifact, evolveInstance } from '../../src/domain/events.js';

const definition = parseWorkspaceDefinition({
  workspace: 'aannemer-x',
  definition_version: 1,
  consequence_class: 'c2',
  applications: [{ id: 'app1', accountable: 'prn-h-owner', environments: ['staging', 'prod'] }],
});
const intake: decide.Actor = { principal: 'prn-w-intake', kind: 'workload', roles: ['intake'] };
const env = (actor: decide.Actor = intake): decide.Env => ({
  definition,
  actor,
  now: '2026-09-27T08:00:00Z',
});
const d = (c: string) => `sha256:${c.repeat(64)}`;
const AT = '2026-09-27T08:00:00Z';

describe('a deploy', () => {
  it('names the application’s accountable human and the intake seat on every event', () => {
    const built = decide.build(env(), AT, { application: 'app1', digest: d('a'), commit: 'c' }, null);
    expect('events' in built && built.events[0]).toMatchObject({
      accountable: 'prn-h-owner',
      acting: 'prn-w-intake',
      seat: 'intake',
      oversight_level: 'O2',
      subject_type: 'artifact',
      subject_id: `app1@${d('a')}`,
      body: { built: true },
    });
  });

  it('copies the previous digest into the rollback target, and keeps it on a redeploy', () => {
    const recorded = decide.build(env(), AT, { application: 'app1', digest: d('b'), commit: 'c' }, null);
    if (!('events' in recorded)) throw new Error('the build was ignored');
    const artifact = evolveArtifact(null, recorded.events[0]!);
    const running = evolveInstance(null, {
      type: 'ArtifactDeployed',
      subject_type: 'instance',
      subject_id: 'ins-app1-prod',
      at: AT,
      accountable: 'prn-h-owner',
      acting: 'prn-w-intake',
      seat: 'intake',
      oversight_level: 'O2',
      body: { application: 'app1', environment: 'prod', digest: d('a'), commit: 'c' },
    });
    const next = decide.deploy(
      env(),
      AT,
      { application: 'app1', environment: 'prod', digest: d('b'), commit: 'c' },
      artifact,
      running,
    );
    expect('instance' in next && next.instance[0]!.body).toMatchObject({ previous: d('a') });
    expect('mismatch' in next && next.mismatch).toBe(false);

    const moved = evolveInstance(running, (next as decide.DeployDecision).instance[0]!);
    const again = decide.deploy(
      env(),
      AT,
      { application: 'app1', environment: 'prod', digest: d('b'), commit: 'c' },
      artifact,
      moved,
    );
    expect('instance' in again && again.instance[0]!.body).toMatchObject({ previous: d('a') });
  });

  it('records an unbuilt digest and its mismatch; a mismatch before any deploy is not a fold', () => {
    const decided = decide.deploy(
      env(),
      AT,
      { application: 'app1', environment: 'prod', digest: d('c'), commit: 'c' },
      null,
      null,
    );
    expect('artifact' in decided && decided.artifact.map((e) => e.body.built)).toEqual([false]);
    expect('instance' in decided && decided.instance.map((e) => e.type)).toEqual([
      'ArtifactDeployed',
      'DigestMismatchDetected',
    ]);
    expect(() => evolveInstance(null, (decided as decide.DeployDecision).instance[1]!)).toThrow(
      /before any deploy/,
    );
  });
});

describe('level and tier', () => {
  it('are a person’s, holding owner', () => {
    const person = { principal: 'prn-h-owner', kind: 'human' as const, roles: ['owner'] };
    expect(decide.setLevel(env(person), 'app1', 'n2', null)[0]).toMatchObject({
      type: 'InstanceLevelSet',
      subject_type: 'application',
      subject_id: 'app1',
      seat: 'owner',
      oversight_level: 'O0',
      body: { application: 'app1', onboarding_level: 'n2' },
    });
    expect(
      decide.setTier(env(person), 'app1', 'tier2', { application: 'app1', tier: 'tier2', revision: 1 }),
    ).toEqual([]);
    expect(() => decide.setLevel(env({ ...intake, roles: ['owner'] }), 'app1', 'n2', null)).toThrow(
      /a workload/,
    );
  });
});

describe('the definition', () => {
  it('refuses a tier or a level: those are a person’s act, not configuration', () => {
    expect(() =>
      parseWorkspaceDefinition({
        workspace: 'x',
        definition_version: 1,
        consequence_class: 'c2',
        applications: [{ id: 'app1', accountable: 'prn-h-o', environments: ['prod'], tier: 'tier1' }],
      }),
    ).toThrow(/tier/);
  });

  it('refuses a repository naming an environment its application does not have', () => {
    expect(() =>
      parseWorkspaceDefinition({
        workspace: 'x',
        definition_version: 1,
        consequence_class: 'c2',
        applications: [
          {
            id: 'app1',
            accountable: 'prn-h-o',
            environments: ['prod'],
            repositories: [{ repository: 'acme/app1', environment: 'staging' }],
          },
        ],
      }),
    ).toThrow(/staging/);
  });
});
