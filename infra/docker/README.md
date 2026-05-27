# maestro infra (Docker)

maestro's deployment stack, sibling to the other fps4 stacks on **ds1** (`copilot`,
`sovereign-llm-gateway`). Environment-agnostic [`compose.yml`](compose.yml) + a gitignored per-site
overlay (`config/<site>/.env` — ADR-0010).

## Services

| Service | Role | Port |
|---------|------|------|
| **web** (`maestro-web`) | the reviewer surface — read specs, discuss, decide gates (ADR-0015 / US-0030) | 3034 |
| **orchestrator** (`maestro-orchestrator`) | the workspace read API — specs/designs × status, read-only (S1, ADR-0018) | 8800 (loopback) |

Joining later as they're built: the rest of the orchestrator (delivery loop), the ArtifactStore (MinIO,
ADR-0012), and auth (`component-auth`). The web app is a **surface**; maestro's event-sourced store
stays authoritative (ADR-0008).

> **Specs view (S1) wiring.** `web` reads specs **server-side** from `MAESTRO_API_URL`, defaulting to
> `http://orchestrator:8800` (the service name on the `maestro` network — `127.0.0.1` would only reach
> the web container itself). `MAESTRO_DEV_IDENTITY` stands in for the component-auth identity in dev
> (ADR-0019); leave it empty in production.

> **The orchestrator needs two instance things** (ADR-0010): the **private register** and a
> **`GITHUB_TOKEN`**. Over a remote `DOCKER_HOST` (ds1) bind mounts resolve on the *daemon host*, so the
> register file must exist **on ds1** — set `MAESTRO_REGISTER_HOST_PATH` to its absolute ds1 path:
>
> ```bash
> ssh ds1 'mkdir -p /opt/maestro/config'
> scp config/products.yaml ds1:/opt/maestro/config/products.yaml   # from the repo root
> # then in config/ds1/.env: MAESTRO_REGISTER_HOST_PATH=/opt/maestro/config/products.yaml, GITHUB_TOKEN=…
> ```
>
> `MAESTRO_DEFAULT_BRANCH` selects which git ref a product's docs render from (default `main`); point it
> at a feature branch to preview specs before they merge.

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
