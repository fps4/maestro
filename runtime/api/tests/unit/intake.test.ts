import { describe, expect, it } from 'vitest';
import { componentsOf, fromEventBridge, fromQueue, purlWithoutVersion } from '../../src/domain/intake.js';

const digest = `sha256:${'a'.repeat(64)}`;
const event = (source: string, detail: unknown) => ({
  id: '1f2e3d4c-0000-4000-8000-000000000001',
  source,
  'detail-type': 'deploy',
  time: '2026-09-27T08:01:12.345Z',
  detail,
});

describe('what the bus carries', () => {
  it('reads a build and a deploy, the time normalised', () => {
    expect(
      fromEventBridge(
        event('maestro.build', { application: 'app1', digest, commit: 'c1', version: '1.2.3' }),
      ),
    ).toEqual({
      kind: 'build',
      delivery: '1f2e3d4c-0000-4000-8000-000000000001',
      at: '2026-09-27T08:01:12Z',
      detail: { application: 'app1', digest, commit: 'c1', version: '1.2.3' },
    });
    expect(
      fromQueue(
        JSON.stringify(
          event('maestro.deploy', { application: 'app1', environment: 'prod', digest, commit: 'c1' }),
        ),
      ).kind,
    ).toBe('deploy');
  });

  it('reads a detail EventBridge carried as a string', () => {
    const e = event(
      'maestro.deploy',
      JSON.stringify({ application: 'app1', environment: 'prod', digest, commit: 'c1' }),
    );
    expect(fromEventBridge(e).kind).toBe('deploy');
  });

  it('ignores a source that is not this service’s, and refuses a malformed detail', () => {
    expect(fromEventBridge(event('aws.ecr', {}))).toMatchObject({ kind: 'ignored' });
    expect(() =>
      fromEventBridge(event('maestro.deploy', { application: 'app1', digest, commit: 'c' })),
    ).toThrow();
    expect(() =>
      fromEventBridge(event('maestro.build', { application: 'app1', digest: 'latest', commit: 'c' })),
    ).toThrow();
    // A detail with a field it does not know is refused: nothing a pipeline says is dropped silently.
    expect(() =>
      fromEventBridge(event('maestro.build', { application: 'app1', digest, commit: 'c', tier: 'tier1' })),
    ).toThrow();
  });
});

describe('an SBOM’s components', () => {
  it('strips the version, qualifiers and subpath from a package URL', () => {
    expect(purlWithoutVersion('pkg:npm/semver@7.5.2')).toBe('pkg:npm/semver');
    expect(purlWithoutVersion('pkg:npm/%40scope/name@1.0.0?arch=x#sub')).toBe('pkg:npm/%40scope/name');
    expect(purlWithoutVersion('pkg:pypi/requests')).toBe('pkg:pypi/requests');
  });

  it('walks nested components, each once, the version from the component or its purl', () => {
    const sbom = {
      components: [
        { purl: 'pkg:npm/a@1.0.0', version: '1.0.0', components: [{ purl: 'pkg:npm/b@2.0.0' }] },
        { purl: 'pkg:npm/a@1.0.0', version: '1.0.0' },
        { name: 'no purl' },
        { purl: 'not-a-purl' },
      ],
    };
    expect(componentsOf(sbom)).toEqual([
      { purl: 'pkg:npm/a', version: '1.0.0' },
      { purl: 'pkg:npm/b', version: '2.0.0' },
    ]);
    expect(componentsOf(null)).toEqual([]);
  });
});
