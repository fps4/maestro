// Bundle each Lambda entry point into one ESM file and zip it, reproducibly: fixed mtimes, no
// extra attributes, so the same source gives the same bytes and Terraform's source_code_hash only
// changes when the code does. Output: bundle/<name>/index.mjs and bundle/<name>.zip — outside dist/,
// which is the npm package; the bundle is what Terraform deploys, not what a consumer imports.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, utimes } from 'node:fs/promises';
import { resolve } from 'node:path';

const FUNCTIONS = { sealer: 'src/lambda/sealer.ts' };
const EPOCH = new Date('2020-01-01T00:00:00Z');

for (const [name, entry] of Object.entries(FUNCTIONS)) {
  const dir = resolve('bundle', name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await build({
    entryPoints: [entry],
    outfile: resolve(dir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'warning',
  });
  await utimes(resolve(dir, 'index.mjs'), EPOCH, EPOCH);
  const zip = resolve('bundle', `${name}.zip`);
  await rm(zip, { force: true });
  execFileSync('zip', ['-X', '-q', '-j', zip, resolve(dir, 'index.mjs')]);
  console.log(`${zip}`);
}
