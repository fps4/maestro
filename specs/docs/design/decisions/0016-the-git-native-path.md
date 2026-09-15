---
title: "0016: A specification may be authored as a file next to the code; proposing is a command and a workflow step; deciding stays a person's act under their own token"
summary: "A markdown file with YAML front-matter is a complete authoring surface: `specs propose` turns it into a proposed version (withdrawing the lineage's earlier undecided proposal, checking readiness first, running the gate's evaluations), and a composite GitHub Action does the same from a pull request and posts the decider's packet. There is deliberately no decide step in CI: `accountable` resolves from the token, the profile refuses a non-human, so a pipeline's credential cannot decide. A version with no pinned link is now refused at the gate, not only a pin with nothing to freeze to."
status: proposed
last_updated: 2026-09-15
date: 2026-09-15
related:
  - ./0003-immutable-versions-mutable-drafts.md
  - ./0005-agents-may-author-never-decide.md
  - ./0013-the-decision-page-is-the-product.md
  - ./0015-the-evaluator-port-has-a-floor.md
  - ../guides/git-native-specs.md
---

## Context

The console is one way to author. For the people who write specifications for services — the
platform's own descriptive specifications above all, which the maestro design wants for every
platform service — it is the wrong way: the specification belongs next to the code it describes,
reviewed in the pull request that changes the code, by the people who review code. Forcing that
into a console and a database is friction, and a second copy of the truth to keep in sync.

The service also lacked a way to take a proposal back. The state machine had `withdraw` since v0.2;
no route reached it. Re-proposing on every push would have left a lineage with three versions all
awaiting the same decision.

And a gap surfaced while testing the path: a specification with no `justified_by` link at all
could be accepted. The pin refuses to freeze to nothing accepted, but a version with no pin had
nothing to refuse — the trail's guarantee could be bypassed by omission.

## Decision

**The file is an authoring surface, not a store.** Front-matter carries `type`, `title`, the
lineage to revise, classification, links and facets; the body is the body. `specs propose` reads
it, asks the draft's readiness and refuses before a 422, proposes, and runs the gate's evaluations.
The version, digest, evaluations, questions and decision live in the service; the file cannot
change any of them afterwards.

**One live proposal per lineage.** Proposing against an existing artifact withdraws the versions of
it this principal proposed that nobody decided on. `withdraw` is the proposer's act, before any
decision; the withdrawn version stays in the record with the reason. `--keep-proposed` opts out.

**A composite GitHub Action proposes and reads the packet; nothing in CI decides.** The workflow
proposes on every push to the pull request and comments the decider's packet and the decision-page
link. The person accountable decides on the page or with `specs decide` under their own token.
This is not a gap: `accountable` is resolved from the session, the attribution profile refuses a
non-human, and a credential a runner holds is not a person. The token in CI should be an agent
principal, so the pipeline's facets are marked `extracted` and a person confirms them.

**Provenance follows the token.** The CLI marks facets `declared` under a person's token and
`extracted` under an agent's. It is the same principal as its token, never someone else.

**A version whose type declares a pin must carry the pin.** `pinned_link` joins the gate's
requirements: blocking, computed once for the gate view and the decision so they cannot disagree,
in the workspace's words — *rests on a business case*.

## Consequences

**The platform can carry its own specifications the way D39 intends.** A descriptive specification
of `identity-service` or of this service is a file in that repository, proposed by its pipeline,
decided by its owner, and the record holds every version anyone decided on.

**Git and the record can disagree, and the record wins.** A file edited without a new propose is
the file being wrong. The one a named human accepted is the specification.

**The trail is now honest by construction on both sides of the pin.** Nothing to freeze to is
refused at acceptance; no pin at all is refused at the gate. Two fixtures in the test suite had
been relying on the gap, and now rest on an accepted case.

**The CLI is not published.** It runs from a checkout of this repository — `npm run specs` here,
a second checkout in the Action. Publishing it is a packaging decision for when a second
repository outside the estate needs it.
