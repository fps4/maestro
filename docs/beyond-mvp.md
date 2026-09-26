# Beyond the MVP

Two backlog items and one branch. Kept here so they are not forgotten and not planned.

## Backlog

### The intake agent

A Slack-facing agent that takes a request in a thread, interviews the requester against the application's own end-user documentation and configuration schema until every required key has an answer, writes the configuration folder, runs the application's own validation, and opens a draft PR — with a specification proposed into specs-service so the request has a decision page. It authors and proposes; it never merges and never decides.

Needs: a Slack app; the Slack↔principal link in identity-service (a Slack user is a principal, minted on first sight, only the maestro id reaching any record); an `integration_spec` artifact type; the OpenSpec block shape in specs-service (app1 already runs OpenSpec — the condition in `maestro-specs` ADR-0018 is met); a versioned guideline corpus per run kind, so an intake that went wrong can be traced to the guideline it followed.

### Customer-facing tenants

A customer signs in to their own deployment, sees exactly which documents are at which version, decides at a gate that is theirs, and watches an agent's progress on their item without seeing its reasoning.

Needs: one Terraform module that stands up a tenant as a product; an external reader role and population in identity-service, honoured by every console and MCP tool, with drafts, transcripts and internal annotations excluded by construction; customer-safe run summaries; the board and Today for a customer. Tenant configuration then splits from `maestro-<tenant>` into a repository the customer can be given.

## Branch R — the regulated domain

Forks after M4. Adds a pack registry (standards, ceilings, chase ladders and clocks as versioned, effective-dated content), a standards engine behind specs-service's evaluator port, assurance and drift detection, classification enforced on every payload and transcript, a conformance dossier per application, and ceilings derived from consequence class.

The MVP keeps four seams open for it, and nothing else:

1. The archive is the only record.
2. Every write attributed; every decision names a human.
3. `consequence_class` on every work item and instance.
4. Classification on every payload and transcript.

Everything the branch adds reads those four; none of them can be added to a sealed archive later.
