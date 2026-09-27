/**
 * Acceptance scenario T3 (maestro docs/roadmap.md): `carries(dependency)` returns every deployed
 * instance whose SBOM names it — the advisory lane's fan-out. What was built and never deployed, or
 * deployed and since replaced, is not carried by anything running.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, busEvent, demoWorkspace, digestOf, harness, uploadSbom, type Harness } from './helpers.js';

const WS = 'aannemer-x';
const OWNER = 'prn-h-demo-owner';
const INTAKE = 'prn-w-runtime-intake';

describe('carries(dependency) (T3)', () => {
  let h: Harness;
  const call = async (principal: string, method: 'GET' | 'POST', url: string, payload?: unknown) => {
    const res = await h.app.server.inject({
      method,
      url: `/v1/workspaces/${WS}${url}`,
      headers: bearer(principal),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.json() };
  };
  const take = (event: object) => call(INTAKE, 'POST', '/intake', event);
  const ship = async (application: string, environment: string, digest: string, purls: string[]) => {
    const sbom = await uploadSbom(
      h,
      application,
      digest,
      purls.map((purl) => ({ purl })),
    );
    await take(busEvent('maestro.build', { application, digest, commit: 'c1', sbom }));
    await take(busEvent('maestro.deploy', { application, environment, digest, commit: 'c1' }));
  };

  beforeAll(async () => {
    h = await harness('carries');
    await demoWorkspace(h.app, [
      { principal: OWNER, roles: ['owner'] },
      { principal: INTAKE, roles: ['intake'], accountable: OWNER },
    ]);
  });
  afterAll(async () => h.close());

  it('names every running instance whose artifact carries the package, at the version it carries', async () => {
    await ship('app1', 'prod', digestOf('p1'), ['pkg:npm/semver@7.5.2', 'pkg:npm/ms@2.0.0']);
    await ship('app1', 'staging', digestOf('s1'), ['pkg:npm/semver@7.6.3']);
    await ship('app2', 'prod', digestOf('q1'), ['pkg:npm/%40scope/semver@1.0.0', 'pkg:npm/debug@4.3.1']);
    // Built and never deployed: carried by nothing running.
    const sbom = await uploadSbom(h, 'app2', digestOf('q2'), [{ purl: 'pkg:npm/semver@7.5.2' }]);
    await take(
      busEvent('maestro.build', { application: 'app2', digest: digestOf('q2'), commit: 'c2', sbom }),
    );

    const carries = (await call(OWNER, 'GET', '/carries?dependency=pkg:npm/semver')).body;
    expect(
      carries.instances
        .map((r: { instance_id: string; version: string }) => `${r.instance_id} ${r.version}`)
        .sort(),
    ).toEqual(['ins-app1-prod 7.5.2', 'ins-app1-staging 7.6.3']);

    // A deploy that replaces the artifact takes its packages with it.
    await ship('app1', 'staging', digestOf('s2'), ['pkg:npm/ms@2.1.3']);
    const after = (await call(OWNER, 'GET', '/carries?dependency=pkg:npm/semver')).body;
    expect(after.instances.map((r: { instance_id: string }) => r.instance_id)).toEqual(['ins-app1-prod']);
    expect(
      (await call(OWNER, 'GET', `/carries?dependency=${encodeURIComponent('pkg:npm/%40scope/semver')}`)).body
        .instances,
    ).toHaveLength(1);
  });

  it('refuses a dependency with its version, and an SBOM under another application', async () => {
    expect((await call(OWNER, 'GET', '/carries?dependency=pkg:npm/semver@7.5.2')).status).toBe(400);
    const digest = digestOf('x9');
    const foreign = await uploadSbom(h, 'app1', digest, [{ purl: 'pkg:npm/semver@7.5.2' }]);
    const refused = await take(
      busEvent('maestro.build', { application: 'app2', digest, commit: 'c', sbom: foreign }),
    );
    expect(refused.status).toBe(422);
    expect((await call(OWNER, 'GET', `/artifacts/app2/${digest}`)).status).toBe(404);
  });
});
