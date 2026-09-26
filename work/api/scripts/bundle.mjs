// Bundle each Lambda entry point into one ESM file and zip it, reproducibly: fixed mtimes, no
// extra attributes, so the same source gives the same bytes and Terraform's source_code_hash only
// changes when the code does. Output: bundle/<name>/ and bundle/<name>.zip — outside dist/, which
// is what `npm run build` emits for the container image; the bundle is what terraform/ deploys.
//
// Four functions (maestro ADR-0002, ADR-0016):
//   api    the Fastify server, unchanged, behind the Lambda Web Adapter. For a zip package on a
//          managed runtime the adapter is a layer, `AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap` starts
//          it, and the handler is a script that starts the server — `run.sh`, added here.
//   relay  the spine's relay over this service's outbox, on a schedule: `index.handler`.
//   sweep  the clocks over every workspace's open items, on a schedule: `index.handler`.
//   intake the adapters over the signals queue (SNS topics, EventBridge rules): `index.handler`.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const FUNCTIONS = {
  api: { entry: 'src/index.ts', extra: { 'run.sh': '#!/bin/bash\nexec node index.mjs\n' } },
  relay: { entry: 'src/relay/lambda.ts', extra: {} },
  sweep: { entry: 'src/sweep/lambda.ts', extra: {} },
  intake: { entry: 'src/intake/lambda.ts', extra: {} },
};
const EPOCH = new Date('2020-01-01T00:00:00Z');

// Optional peers a dependency `require`s only when asked for and that are neither installed nor
// needed; esbuild must leave the `require` in place rather than fail to resolve it.
const EXTERNAL = ['@aws-sdk/credential-providers'];

for (const [name, { entry, extra }] of Object.entries(FUNCTIONS)) {
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
    external: EXTERNAL,
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'warning',
  });
  const files = [resolve(dir, 'index.mjs')];
  for (const [file, content] of Object.entries(extra)) {
    const path = resolve(dir, file);
    await writeFile(path, content);
    await chmod(path, 0o755);
    files.push(path);
  }
  for (const file of files) await utimes(file, EPOCH, EPOCH);
  const zip = resolve('bundle', `${name}.zip`);
  await rm(zip, { force: true });
  execFileSync('zip', ['-X', '-q', '-j', zip, ...files]);
  console.log(zip);
}
