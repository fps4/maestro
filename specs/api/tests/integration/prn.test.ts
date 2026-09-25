/**
 * The principal id is identity-service's `prn` (ADR-0022).
 *
 * A token that carries one is registered under it on first sight; an identity this service first
 * saw before it read `prn` — when it minted its own id — is refused until an operator aligns it
 * with `principal:adopt`, which moves the grants and leaves the record alone. After it, the rules
 * that ask "the same person?" still see the old id as the same person.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adoptPrincipal, parseArgs, UsageError } from '../../src/cli/adopt.js';
import { grantMembership as grant } from '../../src/cli/member.js';
import { call, grantMembership, startHarness, token, type Harness } from './helpers.js';

let harness: Harness;
const base = () => `/v1/workspaces/${harness.tenant}`;

/** `dev:<name>:<kind>:<roles>:<prn>` — the development token with identity-service's claim. */
const withPrn = (name: string, roles: string, prn: string, kind = 'human') =>
  `${token(name, kind, roles)}:${prn}`;

const facets = {
  declared_outcome: {
    statement: 'Materiaalstaat sneller samenstellen',
    baseline: 14.2,
    target: 8,
    unit: 'days',
    baseline_source: 'measured',
    method: 'Six projects of planning history',
  },
  beneficiary: { role: 'werkvoorbereider', count_estimate: 6 },
  personal_data_in_scope: true,
  consequence_class: 'c3',
  decider: 'usr-j-dekker',
};

async function proposedCase(as: string, title: string) {
  const created = await call<{ draft: { id: string } }>(harness, 'POST', `${base()}/drafts`, {
    as,
    body: {
      type: 'business_case',
      title,
      facets,
      provenance: Object.fromEntries(
        Object.keys(facets).map((f) => [
          f,
          { source: 'declared', by: 'unused', at: new Date().toISOString() },
        ]),
      ),
      body: { format: 'markdown/v1', content: '## Scope\n\nDe generator stelt de materiaalstaat samen.' },
      classification: { lawful_basis: 'legitimate_interest', retention: '7y', personal_data: true },
    },
  });
  expect(created.status).toBe(201);
  const proposed = await call<{ version: { artifact: string; ordinal: number; proposed_by: string } }>(
    harness,
    'POST',
    `${base()}/drafts/${created.body.draft.id}/propose`,
    { as },
  );
  expect(proposed.status).toBe(201);
  return proposed.body.version;
}

beforeAll(async () => {
  harness = await startHarness('prn');
}, 60_000);

afterAll(async () => {
  await harness?.stop();
});

describe('a token with a prn', () => {
  it('is registered under it on first sight: the id on the record is the one identity-service minted', async () => {
    const prn = 'prn-h-newcomer00001';
    const granted = await grant(harness.app.store, {
      workspace: harness.tenant,
      issuer: 'dev',
      subject: 'n-bakker',
      prn,
      roles: ['author'],
      kind: 'human',
    });
    expect(granted).toEqual({ principal: prn, created: true });

    const version = await proposedCase(withPrn('n-bakker', 'author', prn), 'Named by its prn');
    expect(version.proposed_by).toBe(prn);
  });

  it('refuses a prn whose letter is not the token kind', async () => {
    const response = await call(harness, 'GET', `${base()}/register`, {
      as: withPrn('x-kind', 'author', 'prn-a-notahuman0001'),
    });
    expect(response.status).toBe(401);
  });

  it('refuses a prn registered here for another identity', async () => {
    const response = await call<{ message: string }>(harness, 'GET', `${base()}/register`, {
      as: withPrn('someone-else', 'author', 'prn-h-newcomer00001'),
    });
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/registered here for another identity/);
  });

  it('the grant command needs a prn for an identity it has not seen, except the development issuer’s', async () => {
    await expect(
      grant(harness.app.store, {
        workspace: harness.tenant,
        issuer: 'https://id.example',
        subject: 'u-unseen',
        roles: ['author'],
        kind: 'human',
      }),
    ).rejects.toThrow(/--prn/);
  });
});

describe('principal:adopt', () => {
  const PRN = 'prn-h-identity00001';
  let old: string;
  let agent: string;
  let version: { artifact: string; ordinal: number };
  let created: { artifact: string; ordinal: number };

  beforeAll(async () => {
    // First seen before this service read `prn`: a locally minted id, a grant, an agent answerable
    // to it, and two versions it proposed — which the record will go on naming.
    old = await grantMembership(harness, harness.tenant, 'f-legacy', ['author', 'sponsor']);
    agent = await grantMembership(harness, harness.tenant, 'agt-legacy', ['author'], old);
    const legacy = token('f-legacy', 'human', 'author');
    version = await proposedCase(legacy, 'Proposed under the old id');
    created = await proposedCase(legacy, 'Created under the old id');
  }, 60_000);

  it('the old identity with a prn is refused, and the refusal names the command', async () => {
    const response = await call<{ message: string }>(harness, 'GET', `${base()}/register`, {
      as: withPrn('f-legacy', 'author', PRN),
    });
    expect(response.status).toBe(403);
    expect(response.body.message).toContain(
      `principal:adopt -- --issuer dev --subject f-legacy --prn ${PRN}`,
    );
  });

  it('a dry run says what it would do and writes nothing', async () => {
    const report = await adoptPrincipal(harness.app.store, {
      issuer: 'dev',
      subject: 'f-legacy',
      prn: PRN,
      dryRun: true,
    });
    expect(report.applied).toBe(false);
    expect(report.superseded).toEqual([old]);
    expect(report.steps.map((s) => [s.what, s.from, s.to]).sort()).toEqual([
      ['accountable', old, PRN],
      ['membership', old, PRN],
      ['register', old, PRN],
    ]);
    expect(await harness.app.store.control.principals.get(PRN)).toBeNull();
  });

  it('adopts: the grant moves, the registry re-points and remembers, the record is left alone', async () => {
    const report = await adoptPrincipal(harness.app.store, {
      issuer: 'dev',
      subject: 'f-legacy',
      prn: PRN,
      dryRun: false,
    });
    expect(report.applied).toBe(true);

    const principals = harness.app.store.control.principals;
    expect((await principals.bySubject('dev', 'f-legacy'))?.id).toBe(PRN);
    expect((await principals.get(PRN))?.supersedes).toEqual([old]);
    expect((await principals.get(old))?.superseded_by).toBe(PRN);

    const handle = await harness.app.store.handle(harness.tenant);
    expect(await handle.memberships.get(old)).toBeNull();
    expect((await handle.memberships.get(PRN))?.roles).toEqual(['author', 'sponsor']);
    expect((await handle.memberships.get(agent))?.accountable).toBe(PRN);

    const read = await call<{ version: { proposed_by: string } }>(
      harness,
      'GET',
      `${base()}/artifacts/${version.artifact}/versions/${version.ordinal}`,
      { as: withPrn('f-legacy', 'author', PRN) },
    );
    expect(read.status).toBe(200);
    expect(read.body.version.proposed_by).toBe(old);
  });

  it('is idempotent', async () => {
    const again = await adoptPrincipal(harness.app.store, {
      issuer: 'dev',
      subject: 'f-legacy',
      prn: PRN,
      dryRun: false,
    });
    expect(again.steps).toEqual([]);
  });

  it('the same person under the new id withdraws what the old id proposed', async () => {
    const response = await call<{ version: { state: string } }>(
      harness,
      'POST',
      `${base()}/artifacts/${version.artifact}/versions/${version.ordinal}/withdraw`,
      { as: withPrn('f-legacy', 'author', PRN), body: {} },
    );
    expect(response.status).toBe(200);
    expect(response.body.version.state).toBe('withdrawn');
  });

  it('and is still the creator separation of duties excludes', async () => {
    const decision = await call<{ message: string }>(harness, 'POST', `${base()}/gates/explore/decisions`, {
      as: withPrn('f-legacy', 'author,sponsor', PRN),
      body: {
        artifact: created.artifact,
        ordinal: created.ordinal,
        outcome: 'approve',
        attribution: { accountable: PRN, acting: PRN, seat: 'sponsor', oversight_level: 'O2' },
      },
    });
    expect(decision.status).toBeGreaterThanOrEqual(400);
    expect(decision.body.message).toMatch(/You created this artifact/);
  });
});

describe('principal:adopt arguments', () => {
  it('reads the identity, the prn and --dry-run', () => {
    expect(parseArgs(['--issuer', 'i', '--subject', 's', '--prn', 'prn-h-abc', '--dry-run'])).toEqual({
      issuer: 'i',
      subject: 's',
      prn: 'prn-h-abc',
      dryRun: true,
    });
  });

  it('refuses a missing flag, and an id that is not a principal id', () => {
    expect(() => parseArgs(['--issuer', 'i', '--subject', 's'])).toThrow(UsageError);
    expect(() => parseArgs(['--issuer', 'i', '--subject', 's', '--prn', 'usr-1'])).toThrow(UsageError);
  });
});
