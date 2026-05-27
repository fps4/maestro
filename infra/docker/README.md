# maestro infra (Docker)

maestro's deployment stack, sibling to the other fps4 stacks on **ds1** (`copilot`,
`sovereign-llm-gateway`). Environment-agnostic [`compose.yml`](compose.yml) + a gitignored per-site
overlay (`config/<site>/.env` — ADR-0010).

## Services

| Service | Role | Port |
|---------|------|------|
| **web** (`maestro-web`) | the reviewer surface — read specs, discuss, decide gates (ADR-0015 / US-0030) | 3034 |

Joining later as they're built: the **orchestrator read API** (`maestro serve`, :8800 — ADR-0018), the
ArtifactStore (MinIO, ADR-0012), and auth (`component-auth`). The web app is a **surface**; maestro's
event-sourced store stays authoritative (ADR-0008).

> **Specs view (S1) wiring.** The webapp reads specs/designs **server-side** from `MAESTRO_API_URL`
> (runtime env — no rebuild to change). It is empty until the orchestrator read-API service joins this
> stack; then set it to that service, e.g. `MAESTRO_API_URL=http://orchestrator:8800`. `127.0.0.1` will
> *not* work from the web container — it must be the service name on the `maestro` network. Until then
> the page shows a clear "read API unreachable" notice. `MAESTRO_DEV_IDENTITY` stands in for the
> component-auth identity in dev (ADR-0019); leave it empty in production.

## Run locally

```bash
cd infra/docker
cp .env.example config/ds1/.env       # or another site
docker compose --env-file config/ds1/.env -f compose.yml up -d --build
# → http://localhost:3034
```

## Deploy to ds1

Runs from the Mac against ds1's daemon over SSH (port 3034 is free; copilot uses 3033):

```bash
export DOCKER_HOST=ssh://ds1
docker compose --env-file config/ds1/.env -f compose.yml up -d --build
docker compose -f compose.yml ps
```

`WEB_BIND=0.0.0.0` exposes it on the LAN for evaluation; front it with the existing Cloudflare
Tunnel + Access (ADR-0012) for external reviewers.
