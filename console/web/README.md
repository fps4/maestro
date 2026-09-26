# The console

maestro's one console per deployment ([ADR-0023](../../docs/decisions/0023-maestro-alerts-in-its-one-console.md)):
Next.js, built by OpenNext and deployed through [`../terraform`](../terraform/). It grew from
specs-service's console and holds specs-service's screens today (the register, the document, the
decision page); work-service's (Today, Owed, the work item, the board) join it next, then the run page
and the estate ([ux.md](../../docs/ux.md)).

It reads each component's HTTP API with the signed-in person's token and holds no data of its own.

```bash
npm ci
npm run dev        # :8021, against specs-service's local loop (specs/: make up)
npm test && npm run lint && npm run typecheck
```

CI builds `../infra/docker/web.Dockerfile`, whose build stage runs the same checks and the production
build (`.github/workflows/console.yml`).
