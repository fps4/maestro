/**
 * `workspace:member` — the operator's grant that admits a principal to a workspace.
 *
 * A token names who someone is; the membership names what the workspace lets them do. The command
 * resolves the principal exactly as the first request would, so what it writes is what that request
 * reads: before the grant the human is refused, after it they act.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantMembership, parseArgs, UsageError } from '../../src/cli/member.js';
import { call, startHarness, token, type Harness } from './helpers.js';

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness('member');
});

afterAll(async () => {
  await harness.stop();
});

describe('parseArgs', () => {
  it('reads the workspace, the identity and the grant', () => {
    expect(
      parseArgs([
        'ws',
        '--issuer',
        'https://id.example',
        '--subject',
        'u-1',
        '--roles',
        'author, decider',
        '--gates',
        'release',
      ]),
    ).toEqual({
      workspace: 'ws',
      issuer: 'https://id.example',
      subject: 'u-1',
      roles: ['author', 'decider'],
      kind: 'human',
      gates: ['release'],
    });
  });

  it('an agent needs the human answerable for it', () => {
    expect(() =>
      parseArgs(['ws', '--issuer', 'i', '--subject', 's', '--roles', 'author', '--kind', 'agent']),
    ).toThrow(UsageError);
    expect(
      parseArgs([
        'ws',
        '--issuer',
        'i',
        '--subject',
        's',
        '--roles',
        'author',
        '--kind',
        'agent',
        '--accountable',
        'prn-h-1',
      ]).accountable,
    ).toBe('prn-h-1');
  });

  it('refuses a missing identity, an unknown kind, a flag without a value', () => {
    expect(() => parseArgs(['ws', '--issuer', 'i'])).toThrow(UsageError);
    expect(() =>
      parseArgs(['ws', '--issuer', 'i', '--subject', 's', '--roles', 'r', '--kind', 'robot']),
    ).toThrow(UsageError);
    expect(() => parseArgs(['ws', '--issuer', 'i', '--subject'])).toThrow(UsageError);
    expect(() => parseArgs(['--issuer', 'i'])).toThrow(UsageError);
  });
});

describe('the grant', () => {
  it('admits a human the workspace did not know: refused before, acting after, one principal throughout', async () => {
    // The dev verifier reads `dev:<name>:<kind>:<roles>`; its issuer is `dev` and its subject the name.
    const bearer = token('newcomer', 'human', 'author');
    const before = await call(harness, 'GET', `/v1/workspaces/${harness.tenant}/register`, { as: bearer });
    expect(before.status).toBe(403);

    const first = await grantMembership(harness.app.store, {
      workspace: harness.tenant,
      issuer: 'dev',
      subject: 'newcomer',
      roles: ['author', 'reviewer'],
      kind: 'human',
      display_name: 'A newcomer',
    });
    // The refused request already minted the principal on first sight; the grant found it.
    expect(first.created).toBe(false);
    expect(first.principal).toMatch(/^prn-h-/);

    const after = await call(harness, 'GET', `/v1/workspaces/${harness.tenant}/register`, { as: bearer });
    expect(after.status).toBe(200);

    // The same identity again is the same principal, and the grant is replaced, not duplicated.
    const again = await grantMembership(harness.app.store, {
      workspace: harness.tenant,
      issuer: 'dev',
      subject: 'newcomer',
      roles: ['author'],
      kind: 'human',
    });
    expect(again.created).toBe(false);
    expect(again.principal).toBe(first.principal);
    const handle = await harness.app.store.handle(harness.tenant);
    expect((await handle.memberships.get(first.principal))?.roles).toEqual(['author']);
  });

  it('an identity never seen is minted by the grant itself, and the first request finds it', async () => {
    const granted = await grantMembership(harness.app.store, {
      workspace: harness.tenant,
      issuer: 'dev',
      subject: 'unseen',
      roles: ['reviewer'],
      kind: 'human',
    });
    expect(granted.created).toBe(true);
    const response = await call(harness, 'GET', `/v1/workspaces/${harness.tenant}/register`, {
      as: token('unseen', 'human', 'reviewer'),
    });
    expect(response.status).toBe(200);
  });
});
