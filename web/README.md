# maestro-web

The functional reviewer's surface (ADR-0015 / US-0030): read a product's spec, discuss it, and decide
the gate. **MIT/open base** — shadcn/ui + Next.js (App Router) + Tailwind — chosen over a commercial
template so it can live in the public open-core repo (ADR-0010). The webapp is a **surface**: comments
and decisions become events in maestro's own log; the repo and event store stay authoritative (ADR-0008).

> **Status:** scaffold. The pages are non-functional stubs; the orchestrator gate/event API and
> `component-auth` integration are later stories.

## Develop

```bash
cd web
npm install
cp .env.example .env.local   # edit as needed
npm run dev                  # http://localhost:3034
```

## Build / run

```bash
npm run build && npm start   # standalone server on :3034
```

Or via the stack: [`../infra/docker/`](../infra/docker/) builds and runs this as the `web` service.

## Adding components

shadcn/ui components are copied into `components/ui/` (you own the source). Add more with the shadcn
CLI or by hand, following `button.tsx` / `card.tsx`.

## Layout

- `app/` — routes (`/`, `/gates`) + `globals.css` (theme tokens)
- `components/ui/` — shadcn components
- `lib/utils.ts` — the `cn()` class-name helper
