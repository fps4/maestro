---
title: "0013: The decision page is the product; the decider's packet is one call, in plain language, shared by console and MCP"
summary: "A person deciding at a gate reads one page, in one column, built from one api call: what am I being asked, what is this, what changed since anyone last decided, what the checks found, what each outcome would do — then the buttons. The same object is the `decision_packet` MCP tool, so an agent explaining a decision to a sponsor reads exactly what the sponsor's screen reads. The accepting outcome becomes declarative (`accepts_on`) because the packet has to know it."
status: proposed
last_updated: 2026-09-15
date: 2026-09-15
related:
  - ./0001-artifact-types-are-configuration.md
  - ./0005-agents-may-author-never-decide.md
  - ./0012-labels-not-identifiers.md
  - ../architecture.md
---

## Context

The console was an auditor's console. Its decision screen showed the gate's requirements, the
digest, the attribution profile and an outcome radio — assembled in the browser from four requests
— and left the reader to open the version, open the diff, and work out for themselves what
"approve" would supersede. A sponsor with no training, on a phone, could not use it. Neither could
an agent asked "what am I being asked to approve?": it had to make the same four calls and the same
joins, and every client made them slightly differently.

The service already refused to *decide* anything (ADR-0005). It had never committed to *showing* a
decision well.

Two smaller defects surfaced on the way. The console guessed each outcome's consequence from its
name (`approve`, `accept`, `publish`, `request_changes`) — client-side domain vocabulary, the leak
ADR-0001 exists to prevent. And the service itself hard-coded `approve` and `accept` as the outcomes
that accept a version, so the catalogue's publication gate — outcomes `publish`, `request_changes`,
`withdraw` — would have recorded a published standard as `rejected`.

## Decision

**One page, one column, one call.** The decision page is built entirely from the **decider's
packet**, `GET /gates/:gate/:artifact/:ordinal/packet`, which returns in plain language and in
reading order:

1. what the gate asks (its `description`) and what kind of thing this is (the type's);
2. the rendered document and the facts the checks read, each with the schema's label and
   description, and whether a human has confirmed it;
3. **what changed since the last version anyone decided on** — not since the previous ordinal,
   because a reviewer who asked for changes at @2 wants to know what moved since @2, and @3 may have
   been withdrawn unread;
4. what the checks found, with per-standard findings where the evaluator reported them;
5. **what each outcome would do**: what becomes accepted, what is superseded, what a pin freezes to,
   where the artifact moves — computed by the service from the definition and the stored state, and
   flagged when an outcome would be refused (a pin with nothing to freeze to);
6. whether this principal may decide, and why;
7. every decision already taken on the artifact.

**The packet is the `decision_packet` MCP tool**, unchanged. An agent reads what the sponsor reads.
It can explain, summarise, draft reasoning, or answer "what changed" — and the packet carries no way
to decide, as nothing on MCP does. The lint rule that keeps `DecisionService` off the MCP import
graph is extended to the packet and to the read-only `gate-view.ts` it reads through.

**The accepting outcome is declared, not assumed.** A gate says `accepts_on: publish`; when it does
not, `approve` or `accept` in its outcomes is taken as the convention; a gate for which neither
resolves is refused at apply, with the fix named. `decisions.ts` and the packet read the same
resolver. The catalogue's three publication gates now declare it.

## Consequences

**The console stops knowing what outcomes mean.** `consequence()` is deleted from the form; every
sentence under an outcome came from the service. A workspace that renames or adds an outcome gets
correct consequences without a console change.

**"Since" costs one more read** — the last decided version's body and facets — on a page that is
opened once per decision. The diff is computed against that version and the full line diff stays
one link away.

**Attachment URLs are not signed over MCP.** The packet's `document.html` on MCP leaves
`attachment:` references unresolved and lists them; an agent has no business forwarding a signed
URL. The console's copy resolves them as before.

**What this does not do yet.** The page cannot yet *ask* anything — a reviewer with a question still
has no channel but `request_changes`. That is the next decision, and the packet has a slot for it.

**The build gate this adds:** *a sponsor with no training approves a business case on a phone in
under two minutes without asking anyone.* It is a usability gate, not an audit one, and it is the
first of its kind in this service.
