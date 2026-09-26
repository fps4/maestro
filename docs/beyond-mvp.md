# Beyond the MVP

Two backlog items and one branch. Kept here so they are not forgotten and not planned.

## Backlog

### The intake agent

A Slack-facing agent that takes a request in a thread, interviews the requester against the application's own end-user documentation and configuration schema until every required key has an answer, writes the configuration folder, runs the application's own validation, and opens a draft PR — with a specification proposed into specs-service so the request has a decision page. It authors and proposes; it never merges and never decides.

Needs: a Slack app; the Slack↔principal link in identity-service (a Slack user is a principal, minted on first sight, only the maestro id reaching any record); an `integration_spec` artifact type; the OpenSpec block shape in specs-service (app1 already runs OpenSpec — the condition in `maestro-specs` ADR-0018 is met); a versioned guideline corpus per run kind, so an intake that went wrong can be traced to the guideline it followed.

### Customer-facing tenants

A customer signs in to their own deployment, sees exactly which documents are at which version, decides at a gate that is theirs, and watches an agent's progress on their item without seeing its reasoning.

Needs: one Terraform module that stands up a tenant as a product; an external reader role and population in identity-service, honoured by every console and MCP tool, with drafts, transcripts and internal annotations excluded by construction; customer-safe run summaries; the board and Today for a customer. Tenant configuration then splits from `maestro-<tenant>` into a repository the customer can be given.

### Push alerts

maestro alerts only in its console in the MVP ([ADR-0023](decisions/0023-maestro-alerts-in-its-one-console.md)). A push channel — Slack, email, a mobile push — lets maestro reach a person who is not looking, and lets an application retire its own alert for a signal maestro handles (one alert, one owner).

Needs: a principal's contact from identity-service, given to the notifier and to nothing else; the Slack↔principal link for Slack; an on-call rota in the workspace definition.

### Risk-graded change routing

Raised 2026-09-26, planned for the iteration after the MVP. The MVP routes by risk only at claim, from what an item was declared at raise: its remediation class against the application's onboarding level and the seat's ceiling ([governance-model.md](governance-model.md#authority-at-claim)). Nothing grades the change itself, and nothing but acceptance scenario A2 (a green patch-level bump on N2) lets a change take effect before a person approves it.

The next iteration:

- **A deterministic change classifier on the pull request.** Its inputs: the bump level, CI status, the paths touched (against CODEOWNERS and declared sensitive paths), the size, and whether the change can be reverted. Its output is the change's effective class, checked where the act lands, at merge. A pull request graded above its item's class goes to a person.
- **Automated approval by rule, never by agent.** A low tier is approved by a rule the tenant writes ("patch bump, CI green, N2, consequence ≤ c2 → merge"), recorded under the policy's version. Agents still never decide (specs-service ADR-0005): the tenant's rule does.
- **Consequence class read by the ceilings**, so one rule holds at c2 and tightens at c4.
- **The change-control kinds** (cosmetic, behavioural, assumption-breaking) become a field that routes, rather than a table in the governance model.
- specs-service gates stay human. Automated acceptance of low-consequence documents would be its own decision.

## Branch R — the regulated domain

Forks from the finished MVP. Adds a pack registry (standards, ceilings, chase ladders and clocks as versioned, effective-dated content), a standards engine behind specs-service's evaluator port, assurance and drift detection, classification enforced on every payload and transcript, a conformance dossier per application, and ceilings derived from consequence class.

The MVP keeps four seams open for it, and nothing else:

1. The archive is the only record.
2. Every write attributed; every decision names a human.
3. `consequence_class` on every work item and instance.
4. Classification on every payload and transcript.

Everything the branch adds reads those four; none of them can be added to a sealed archive later.
