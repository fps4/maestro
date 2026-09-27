// One CycloneDX SBOM per Lambda bundle (maestro build-standards §4), beside the zip it describes.
// The bundles are built from one lockfile, so each SBOM is the production dependency tree of this
// package; they are written per bundle so each deployed artifact carries its own.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const bundles = readdirSync('bundle')
  .filter((f) => f.endsWith('.zip'))
  .map((f) => f.slice(0, -4));
if (bundles.length === 0) throw new Error('No bundles: run `npm run bundle` first.');
for (const name of bundles) {
  execFileSync(
    'npx',
    [
      'cyclonedx-npm',
      '--omit',
      'dev',
      '--output-format',
      'JSON',
      '--output-reproducible',
      '--output-file',
      `bundle/${name}.cdx.json`,
    ],
    { stdio: 'inherit' },
  );
  console.log(`bundle/${name}.cdx.json`);
}
