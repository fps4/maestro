# maestro-web

The functional reviewer's surface (ADR-0015 / US-0030): read a product's spec, discuss it, and decide
the gate. **MIT/open base** — shadcn/ui + Next.js (App Router) + Tailwind — chosen over a commercial
template so it can live in the public open-core repo (ADR-0010). The webapp is a **surface**: comments
and decisions become events in maestro's own log; the repo and event store stay authoritative (ADR-0008).

> **Status:** the **Specs view (S1)** is wired — the workspace lists a caller's products and renders
> their specs/designs read-only, joined with live status, from the orchestrator read API
> ([ADR-0018](../docs/architecture/decisions/0018-workspace-read-api-and-frontmatter-index.md)). Discussion
> (S2) and gate decisions (S3) — and the `/gates` page — are still stubs; `component-auth` is wired in
> the auth slice (S1 uses a dev identity, [ADR-0019](../docs/architecture/decisions/0019-workspace-identity-component-auth-google-sso.md)).

## Develop

```bash
# 1. start the read API (from the repo root) — serves on :8800
maestro serve            # needs GITHUB_TOKEN + config/products.yaml (or: maestro --example serve)

# 2. start the webapp
cd web
npm install
cp .env.example .env.local   # set MAESTRO_DEV_IDENTITY to a participant email from the register
npm run dev                  # http://localhost:3034
```

The webapp reads specs **server-side** from `MAESTRO_API_URL` and forwards the caller identity as
`X-Maestro-Identity` — so the browser holds no token and no identity (ADR-0015). Without the API
running, pages show a clear "read API unreachable" notice.

## Build / run

```bash
npm run build && npm start   # standalone server on :3034
```

Or via the stack: [`../infra/docker/`](../infra/docker/) builds and runs this as the `web` service.

## Adding components

shadcn/ui components are copied into `components/ui/` (you own the source). Add more with the shadcn
CLI or by hand, following `button.tsx` / `card.tsx`.

## Layout

- `app/` — routes: `/` (products), `/products/[productId]/specs` (the Specs index),
  `/products/[productId]/specs/[feature]/[kind]` (one rendered spec); `/gates` (S3 stub); `globals.css`
- `components/ui/` — shadcn components (`button`, `card`, `badge`)
- `components/` — `markdown` (in-app render), `spec-status` (status badges), `api-error-notice`
- `lib/` — `api.ts` (server-only read-API client), `types.ts` (the wire shapes), `links.ts`, `utils.ts`
