---
title: "0005: Agents author and propose; only a named human decides; there is no decision surface on MCP"
summary: "Every write produces a draft or a proposed version. Only a gate decision accepts, and a decision requires a named human principal in the accountable field — enforced at write time. Agents edit drafts and propose through the API and MCP alike; neither surface exposes a way to decide."
status: proposed
last_updated: 2026-08-04
date: 2026-08-04
related:
  - ./0003-immutable-versions-mutable-drafts.md
  - ./0004-facets-are-evaluated-bodies-are-read.md
---

## Context

Both known consumers state the same rule in their own words. maestro v1: *"agents propose, humans
dispose"* — an agent produces artifacts, runs the gates, reports status, and never decides one. maestro:
a named human is accountable for every governed decision, and agents cannot hold accountability.

Both enforce it in their own application logic today. That is where such rules erode — the
enforcement is one refactor from becoming a convention, and a convention is indistinguishable from
the absence of a rule once an agent has write access.

The pressure is not hypothetical, and it has increased with authoring in scope. Agents are
increasingly the thing writing artifacts, and this service now hosts the writing. If the registry
cannot distinguish "an agent produced this" from "a human accepted this", the approval claim collapses
at exactly the moment it matters.

## Decision

**The service decides nothing.** It resolves who *may* decide, refuses everyone else, and records
what they decided.

**1. Every write produces a draft or a proposed version.** No path writes an accepted version.

**2. Only a gate decision accepts.** Acceptance exists in exactly one code path. Two would make this
a convention.

**3. A decision requires a named human.** The attribution profile declares which fields a decision
must carry and what each must resolve to; the default requires `accountable` to resolve to a
principal of kind `human`. **A decision naming an agent as accountable is a rejected write, and the
rejection is recorded.**

**4. `acting` and `accountable` are separate fields.** An agent may act — it may execute a decision an
authorised human made elsewhere — but the answerable party is recorded separately and is always
human. Raising automation moves work away from a human; it never moves accountability.

**5. Agents author under their own identity.** An agent edits drafts and proposes versions as a
principal of kind `agent`, distinct from the credential it authenticates with and from the human
accountable for its work. Draft contributors accumulate, so *"an agent drafted this and a human
proposed it"* is recorded rather than inferred.

**6. MCP carries authoring but no decision surface.** *Revised from v0.1, which made MCP read-only.*
Agent authoring is a first-class use case, so MCP exposes reads, draft writes and propose. It exposes
no decision tool, and none may be added. The invariant that matters was never "MCP does not write" —
it is **"nothing except a gate accepts, and no agent decides."** Read-only MCP protected that
property by accident; this states it directly.

**7. Separation of duties is a per-gate declaration.** `exclude_proposer` refuses a decision from the
principal who proposed the version. Declared rather than universal, because a small organisation
legitimately cannot honour it — in which case the exemption appears on the decision rather than being
silently permitted.

## Consequences

**"Who approved this" has one answer and it is a person.** Years later, without the approver present,
and without trusting the application that wrote it.

**Agent authority can be generous where it is cheap.** Because agent output cannot reach an accepted
state, an agent may draft freely, extract facets, and propose. The constraint sits at the point of
consequence rather than spread across everything an agent touches — which is what makes agent
authoring economical rather than a governance argument per feature.

**Automated approval is unavailable, at all.** No service account approving low-risk changes, no
"auto-approve if checks pass". This is the deliberate cost. A consumer wanting proportionality
declares a gate non-blocking or omits it — an explicit statement that no approval is required, which
is honest — rather than manufacturing a fake approver, which is not.

**Opening MCP to writes widens the attack surface**, and the mitigation is that everything reachable
through it is either mutable-and-worthless (a draft) or immutable-and-unaccepted (a proposed
version). Neither carries authority. A compromised agent can create noise and cannot create an
approval.

**The service inherits its consumers' trust problem.** It can prove a named human was recorded as
accountable. It cannot prove that human read anything. Rubber-stamping is a consumer's problem, and
claiming otherwise would overstate what any registry can offer.
