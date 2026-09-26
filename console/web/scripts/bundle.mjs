// Package the console for Lambda behind the Web Adapter (maestro ADR-0026): Next's standalone server
// with its static files beside it, and `run.sh` to start it. Run after `next build`.
//
// Output: bundle/console/ and bundle/console.zip — what console/terraform deploys. The Next server
// serves /_next/static and public/ itself; the edge in front (Cloudflare) caches what is hashed.
// Entries are sorted and their times fixed, so the same build gives the same zip; a `next build`
// assigns a fresh build id, so every build is still a deploy.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat, utimes, writeFile, chmod } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const EPOCH = new Date('2020-01-01T00:00:00Z');
const out = resolve('bundle', 'console');
const zip = resolve('bundle', 'console.zip');

await rm(resolve('bundle'), { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp('.next/standalone', out, { recursive: true, verbatimSymlinks: true });
await cp('.next/static', join(out, '.next', 'static'), { recursive: true });
await cp('public', join(out, 'public'), { recursive: true });
await writeFile(join(out, 'run.sh'), '#!/bin/bash\nexec node server.js\n');
await chmod(join(out, 'run.sh'), 0o755);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else files.push(p);
  }
  return files;
}
const files = (await walk(out)).sort();
for (const f of files) await utimes(f, EPOCH, EPOCH);
execFileSync('zip', ['-X', '-q', '-y', zip, '-@'], {
  cwd: out,
  input: files.map((f) => relative(out, f)).join('\n'),
});
console.log(`${zip} ${((await stat(zip)).size / 1e6).toFixed(1)} MB`);
