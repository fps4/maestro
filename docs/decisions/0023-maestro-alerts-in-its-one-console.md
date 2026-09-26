# ADR-0023 · maestro alerts in its console, and a deployment has one console

**Status:** proposed · 2026-09-26 · amends [signals.md](../signals.md) ("one alert, one owner") and [ux.md](../ux.md) (one console per component)

## Context

The design had maestro reach people through a notifier port with Slack and SES adapters: an alert at raise, and every step of a chase ladder. Neither adapter can be finished cheaply. Email needs a principal's address, which identity-service holds and gives to no service. Slack needs a webhook and channel per tenant, and later the Slack↔principal link that is [post-MVP](../beyond-mvp.md). Neither is one of the MVP's acceptance scenarios.

[ux.md](../ux.md) gave each component its own console, tied together by one landing page. But **Today**, that landing page, already joins specs-service (decide, answer), work-service (owed) and agent-service (agents at work). A person should sign in once, to one address, and find everything that needs them.

## Decision

1. **In the MVP, maestro alerts in its console only.** A work item raised, a chase step, an escalation and a breach reach a person as the item standing on their **Today**, marked with why it is there ("escalated to you, step 3 of 5", "breached `resolve_by`"). The notifier port stays. Its MVP adapter records the step on the item (it is already on the record as `WorkItemChased` with the principal it names), and Today reads it. There is no Slack or email adapter in the MVP.
2. **Applications keep their own paging.** A console reaches only someone who looks at it. So an application's own alert — a pager, its Slack channel — is **not** retired when maestro subscribes to its signals. "One alert, one owner" ([signals.md](../signals.md)) waits for a push channel after the MVP.
3. **A deployment has one maestro console.** It is one Next.js application at one address with one sign-in. It holds every maestro surface in [ux.md](../ux.md): Today, the register, the document, the decision page, the frontier, the work item, the board, the run page and the estate. It calls each component's HTTP API with the person's token, and no component reads another's data through it. It grows from specs-service's console (`specs/web`) and is deployed through [`console/terraform`](../../console/README.md), once per deployment. identity-service's admin console stays its own: it is identity-service's product, for whoever administers the realm.
4. **Push channels are backlog.** Slack, email, and a mobile push, once a principal's contact is identity-service's to give. The Slack webhook adapter already in work-service stays in code, unconfigured.

## Consequences

- Acceptance scenario W3 ("every step's delivery is recorded") is met by the step recorded and shown on Today. There is no third party whose answer could be `failed`.
- A SEV1 at night reaches nobody through maestro. The application's own paging reaches them, and maestro's item is waiting on Today with its clocks already running. The MVP's first applications are fps4's own services and app1, and both keep their existing alerts.
- The console becomes the only way a person learns of anything, so it is on the MVP's critical path rather than a view added at the end.
- work-service's policy key `alerts` (`slack_on_raise_at_or_above`) has no reader in the MVP. It is read again when a push channel exists.
- `adapters.yaml` in a tenant repository keeps its notifier section for that day. The first tenant's has no values in it.

## What would reopen it

A person who must be reached by maestro without looking: an on-call rota that maestro, not the application, owns. That is a push channel, and it needs the principal's contact from identity-service first.
