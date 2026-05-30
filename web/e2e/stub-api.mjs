// A tiny stub of the orchestrator read API for the Playwright smoke (US-0033). It serves just enough
// for the task page to render the artefacts panel — the product list, the task detail (with
// stored_artefacts), and the artefact endpoint (302 → a fake presigned URL). No persistence, no auth
// beyond echoing that an identity header was sent. Started by playwright.config.ts as a webServer.

import { createServer } from 'node:http';

const port = Number(process.argv[2] || 8811);
const ARCH = 'arch@example.com';

const PRODUCT = { id: 'maestro', name: 'maestro', product_type: 'technical', role: 'architect' };

const TASK = {
  task_id: 'task-smoke-1',
  product_id: 'maestro',
  stage: 'merge_gate',
  status: 'active',
  branch: 'maestro/task-smoke-1',
  pr: { repo: 'fps4/maestro', number: 42, url: 'https://github.com/fps4/maestro/pull/42' },
  merged: false,
  gates: [],
  open_gates: [],
  comments: [],
  agent_responses: [],
  artefacts: [],
  stored_artefacts: [
    {
      kind: 'pr_diff',
      name: 'pr-diff.patch',
      key: 'tasks/task-smoke-1/pr-diff.patch',
      content_type: 'text/x-diff',
      size: 2048,
      sha256: 'a'.repeat(64),
      source: { event: 'pr.opened', seq: 5 },
      stored_at: 1_700_000_000,
      seq: 7,
      href: '/api/products/maestro/artifacts/tasks/task-smoke-1/pr-diff.patch',
    },
  ],
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const path = url.pathname;

  // The "presigned" target carries its own auth (an S3 signature) — the browser follows the redirect
  // to it WITHOUT the maestro identity header, exactly as it would a real presigned URL.
  if (path === '/fake-presigned') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('--- a\n+++ b\n@@ fake presigned artefact body @@\n');
  }

  // Every read-API route requires the caller identity (the dev-stub forwards it as X-Maestro-Identity).
  const identity = req.headers['x-maestro-identity'];
  if (!identity) return json(res, 401, { error: { code: 'unauthenticated', message: 'no identity' } });
  if (identity !== ARCH) return json(res, 404, { error: { code: 'not_found', message: 'no products' } });

  if (path === '/api/products') return json(res, 200, [PRODUCT]);

  if (path === '/api/products/maestro/tasks/task-smoke-1') return json(res, 200, TASK);

  if (path.startsWith('/api/products/maestro/artifacts/')) {
    // The real endpoint 302s to a presigned URL; the stub points at itself so the redirect resolves.
    res.writeHead(302, {
      Location: `http://127.0.0.1:${port}/fake-presigned?expires=9999999999`,
      'Cache-Control': 'no-store',
    });
    return res.end();
  }

  return json(res, 404, { error: { code: 'not_found', message: `no route ${path}` } });
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`stub-api listening on :${port}`);
});
