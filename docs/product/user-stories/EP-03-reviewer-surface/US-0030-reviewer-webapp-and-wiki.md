---
title: "US-0030: Read, discuss, and decide a gate in the maestro reviewer webapp (with a repo-linked spec wiki)"
persona: functional reviewer
status: draft
complexity: L
milestone: M0–M3   # spans the webapp steps S1–S6 (S1 shipped in M0; S2–S3 in M1) — to be split per step
last_updated: 2026-05-27
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - docs/architecture/decisions/0011-multi-surface-human-control.md
  - docs/architecture/decisions/0008-system-of-record-and-persistence.md
  - docs/architecture/decisions/0010-public-engine-private-instance-data.md
  - docs/architecture/decisions/0012-artifact-storage-and-sharing.md
---

## Story

As a functional reviewer,
I want to read a product's spec, discuss it, and approve / request-changes / reject the gate in one maestro web app,
so that I can sign off on *what* is being built — without GitHub or a chat tool — while my decision is attributed to me and scoped to my product.

## Context

Implements [ADR-0015](../../../architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md): the functional reviewer's surface is a **maestro-owned web app** (built on an
MIT/open base — shadcn/ui + Next.js, identity via `component-auth`, reasoning via the `sovereign-llm-gateway`,
exposed over the Cloudflare Tunnel — ADR-0012) plus a **docs wiki rendered one-way from the product
repo**. The webapp is a **surface/projection**; maestro's event-sourced store stays the system of
record ([ADR-0008](../../../architecture/decisions/0008-system-of-record-and-persistence.md)). Replaces ADR-0013's Google-Docs document surface; refines [ADR-0011](../../../architecture/decisions/0011-multi-surface-human-control.md)
(adds a `webapp` surface; Telegram becomes optional).

## Acceptance criteria (EARS)

- WHEN maestro opens a functional gate for a product, THE SYSTEM SHALL present the reviewer a page
  showing the gate context and the spec **rendered one-way from the product repo** (as-committed),
  not an editable copy — the repo remains the source of truth (ADR-0008/0006).
- WHEN a reviewer posts a comment on a gate, THE SYSTEM SHALL record it in a per-gate chat thread and
  forward it to the orchestrator via the webhook/REST contract, which appends it to the event log
  (ADR-0008); the webapp SHALL hold no authoritative gate state of its own.
- WHEN a reviewer decides a gate (approve / request-changes / reject), THE SYSTEM SHALL accept the
  decision only from a participant holding that gate's role for that product (ADR-0011), SHALL record
  the deciding identity (ADR-0009), and SHALL resolve the gate through the orchestrator.
- THE SYSTEM SHALL scope each reviewer's visibility to the products they participate in (per-product
  isolation — ADR-0010/0011); a reviewer SHALL NOT see another product's gates, specs, or threads.
- THE SYSTEM SHALL authenticate reviewers (internal and external) through the shared auth building
  block (`component-auth`) and SHALL be reachable only over the Cloudflare Tunnel + Access (ADR-0012),
  never an open inbound port.
- IF the orchestrator is unavailable, THEN THE SYSTEM SHALL show gate state read-only and SHALL NOT
  accept a decision it cannot record — no decision is lost or fabricated.

## Out of scope

- The orchestrator's gate/event APIs and the agent-comms bridge implementation (engine-foundation work;
  this story consumes the contract, it does not build the orchestrator).
- LLM-generated chat replies (a later story); here the chat thread captures human discussion + agent
  messages relayed by the orchestrator.
- The wiki rendering mechanism — in-app MDX vs. a sibling static site (MkDocs / Docusaurus / Backstage
  TechDocs) — a build-time choice left open by ADR-0015.
- Where the webapp **source** lives given maestro is a public/open-core repo (a hosting/licensing
  decision, tracked separately — see ADR-0015 follow-up).

## Notes

The webapp is a surface, never the system of record — every decision and comment becomes an event in
maestro's own log (ADR-0008), authorized by product role (ADR-0011) and attributed for audit
(ADR-0009). This is the capability ADR-0013 sought (read + discuss + approve for mixed internal/external
reviewers) without operating a second document store.
