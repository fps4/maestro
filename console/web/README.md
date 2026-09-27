# The console

maestro's one console per deployment ([ADR-0023](../../docs/decisions/0023-maestro-alerts-in-its-one-console.md)):
Next.js, its standalone server packaged by `npm run bundle` and deployed through [`../terraform`](../terraform/) ([ADR-0026](../../docs/decisions/0026-the-console-behind-the-tenants-edge.md)). It grew from
specs-service's console. It holds work-service's screens — Today (its landing), Owed, the work item and
the board — and specs-service's: the register, the document, the decision page. The run page and the
estate join it next ([ux.md](../../docs/ux.md)).

It reads each component's HTTP API with the signed-in person's token and holds no data of its own.

```bash
npm ci
npm run dev        # :8021, against specs-service's local loop (specs/: make up) and work-service's (work/: make up, :8041)
npm test && npm run lint && npm run typecheck
```

## Against a tenant's deployed services

Until the console is deployed, run it on a laptop against a tenant's services. Keep the settings
outside the repository, since hostnames identify a tenant, e.g. `~/.config/maestro/console-<tenant>.env`:

```bash
NEXT_PUBLIC_AUTH_MODE=component-auth
NEXT_PUBLIC_IDENTITY_BASE_URL=<identity-service's issuer>   # terraform output issuer
NEXT_PUBLIC_IDENTITY_CLIENT_ID=maestro-web
NEXT_PUBLIC_DEFAULT_WORKSPACE=<workspace>
API_PROXY_TARGET=<specs-service's API>                      # terraform output specs_api_url
WORK_API_PROXY_TARGET=<work-service's API>                  # work-service module output api_url
```

Without `WORK_API_PROXY_TARGET` (outside dev mode) the work pages say work-service is not connected. In
dev mode they call `http://127.0.0.1:8041` with `WORK_DEV_TOKEN` (default
`dev:prn-h-demo-owner:owner,operations`), the shape work-service's development verifier reads.

then `set -a; source ~/.config/maestro/console-<tenant>.env; set +a; npm run dev` and open
http://127.0.0.1:8021. Sign-in and every API call go through the console's own server, so the
services need no CORS origin for it.

CI builds `../infra/docker/web.Dockerfile`, whose build stage runs the same checks and the production
build (`.github/workflows/console.yml`).
