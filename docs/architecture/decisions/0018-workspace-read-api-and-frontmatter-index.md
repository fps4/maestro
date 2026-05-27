---
title: "0018: The workspace read API + frontmatter spec index (the surface contract)"
status: proposed
date: 2026-05-27
related:
  - 0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - 0008-system-of-record-and-persistence.md
  - 0006-spec-driven-sdlc.md
  - 0010-public-engine-private-instance-data.md
  - 0011-multi-surface-human-control.md
  - 0017-github-app-and-webhook-ingestion.md
  - ../components/workspace-backend.md
  - ../webapp-concept.md
  - ../data-model.md
---

## Context

[ADR-0015](0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md) named a "webhook/REST contract" between
the workspace and the orchestrator but did not define it; the [webapp concept](../webapp-concept.md)
made the workspace the primary surface and listed **"Specs & designs (wiki) — repo-rendered, one-way"**
as a core view. The first step (**S1 — Read**) must render functional **and** technical specs
read-only, and — per the architect — show them **across branches with live status** (which branch,
which delivery task, which gate, draft/approved/merged).

That view is a **join of two authoritative sources**, each already decided:

- **Content** → the **product repo**, rendered one-way as-committed (ADR-0006/0008/0010). Never a second
  store; the workspace is a projection (the ADR-0015 invariant).
- **Status** → maestro's **event-log projection** (ADR-0008) — the delivery-task/gate state the engine
  spine already projects.

Two things are undecided and block S1: **(a)** how the workspace obtains the join (it must hold no
GitHub token and no authoritative state), and **(b)** how repo `docs/` files map to maestro's domain
(Feature / DeliveryTask, functional spec vs. technical design) — the "index."

## Decision

1. **The orchestrator exposes a read API; the workspace is a thin renderer.** A server-side **read API**
   joins the **event-log projection** (status) with **repo content fetched via the github adapter**
   ([ADR-0017](0017-github-app-and-webhook-ingestion.md), as-committed) and returns rendered-ready
   specs/designs with their status. The webapp calls this API only — it holds **no GitHub token** and
   **no authoritative state** (ADR-0015). This *is* the "webhook/REST contract" ADR-0015 deferred. See
   [`workspace-backend.md`](../components/workspace-backend.md) for the component shape.

2. **Frontmatter is the index — no separate manifest.** Each spec/design markdown declares its maestro
   identity in **YAML frontmatter** (extending the rich frontmatter already in `docs/`), e.g.:

   ```yaml
   maestro:
     feature: invoice-export        # the Feature this belongs to (ADR-0005)
     task: US-0042                  # optional: the DeliveryTask, when one owns it
     kind: functional_spec          # functional_spec | technical_design
   ```

   maestro builds the index by **reading frontmatter**, from three sources that agree:
   - crew-produced specs carry it, and the producing event records the ref (`{repo, branch, path, commit}`);
   - a **webhook `push` reconciler** (ADR-0017) re-reads frontmatter on changed `docs/**` files, so
     parallel/human edits on any branch stay reflected;
   - the API resolves `feature/task → status` from the projection.

   The repo stays the source of truth for content; frontmatter is co-located metadata, not a second store.

3. **One-way, read-only, no write path in S1.** Content renders read-only (ADR-0015 invariant);
   comments (S2) and decisions (S3) are later, additive write paths through the same contract. Editing a
   spec happens via the crew + PRs, never in the workspace.

4. **Per-product isolation is enforced server-side.** The API scopes every response to the caller's
   products (register membership; ADR-0010/0011). A reviewer never receives another product's specs,
   branches, or status — isolation is not a client concern.

5. **Renderer: in-app markdown for the content path.** S1 renders repo markdown **in the Next app**,
   resolving ADR-0015's open "wiki renderer" question *for the content path* as in-app (not a sibling
   static site). A static-site generator remains possible later for a published wiki but is not needed
   for the gated, status-annotated workspace view.

## Consequences

- **Defines the contract ADR-0015 deferred** and gives S1 a concrete data path: projection (status) +
  adapter (content) → read API → renderer.
- **The read API is the orchestrator's first HTTP surface.** It is read-only in S1; the write paths
  (S2/S3) extend the same service. (Framework — likely FastAPI, Python per `CODEBASE.md` — is an
  engineering detail.)
- **Frontmatter-as-index is lightweight and reconciling.** It fits existing doc conventions, needs no
  manifest to keep in sync, and the `push` reconciler keeps parallel-branch reality reflected. The cost:
  a frontmatter contract the crew (and humans) must honour — validated, with a clear error when a
  `docs/**` file is missing or has malformed `maestro:` frontmatter.
- **The workspace stays a pure projection** — no GitHub token in the browser, no authoritative state in
  the webapp; isolation server-side. The ADR-0015 invariant holds by construction.
- **Auth is deliberately out of scope here.** *How* the workspace authenticates the caller and maps them
  to a participant (Cloudflare Access + register vs. full `component-auth` OIDC) is settled in the
  webapp-auth slice (see Open questions); this ADR defines the data/isolation contract the API enforces
  *once a caller identity exists*.

## Open questions

- ~~**Caller auth handshake**~~ — **resolved by [ADR-0019](0019-workspace-identity-component-auth-google-sso.md)**:
  identity via `component-auth` (Google SSO) with Cloudflare Access as the perimeter; **authorization
  stays in the register** (this ADR's isolation contract). The thin slice renders against a dev/stub
  identity; component-auth OIDC is wired before the webapp is externally reachable.
- **Large docs / pagination** and **diagram rendering** (Mermaid in technical designs, ADR cross-links)
  — rendering details for the build slice.
- **Caching** repo content fetched via the adapter (ETag/commit-keyed) to stay inside rate limits — an
  engineering detail; the webhook keeps it fresh, so a commit-keyed cache is safe.
- **Frontmatter schema location** — co-document with `standards/` (a `docs` frontmatter contract) so the
  crew emits it consistently.
