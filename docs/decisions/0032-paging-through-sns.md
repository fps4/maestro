# ADR-0032 · Paging: work-service pages a route, an SNS topic whose subscribers are the rota; maestro's own failures page past maestro

**Status:** proposed · 2026-09-29 · amends [ADR-0023](0023-maestro-alerts-in-its-one-console.md) §1 and §4 (console only, push channels backlog); keeps its §2 (applications keep their own paging) and §3 (one console)

## Context

[ADR-0023](0023-maestro-alerts-in-its-one-console.md) made the console maestro's only alert. A SEV1 at night reaches nobody through maestro. The application's own paging covers it, and the item waits on Today. Push channels waited for a person's contact details, which identity-service holds and gives to no service.

Two things make that gap worth closing now:
- **Delegation raises the stakes.** [ADR-0031](0031-risk-appetite-delegates-decisions.md) lets an agent decide where an application's risk appetite delegates it. When a delegated decision goes wrong, someone who is not looking has to hear about it.
- **maestro reports its own failures through itself.** Every component's CloudWatch alarms (relay, sealer, API) go to the tenant's `ops-signals` topic, and work-service reads that topic. A stalled work-service would be reported to the component that has stalled.

The architect decided on 2026-09-29:
- start with plain SMS and email through SNS;
- a paging product (PagerDuty or similar) comes later;
- the foundation goes in place first.

## Decision

### 1. A page goes to a route, never to a person

A **page route** is a named destination in work-service's definition. It is the adapter plus its target: for SNS, a topic ARN.
- The topic's subscribers are the rota: email addresses and phone numbers.
- The subscriptions are declared only in the tenant repository's root module, which is private.
- **maestro never holds a contact.** work-service holds a topic ARN; identity-service still gives no one's contact details to any service.

Each application names its route, and a workspace default covers the rest. One more route, `maestro`, is for maestro's own health (§5). For fps4 today, both are one topic with one subscriber: the architect.

```yaml
paging:
  routes:
    oncall: { adapter: sns, topic: arn:aws:sns:<region>:<account>:<tenant>-maestro-page }
  default_route: oncall
  on_raise_at_or_above: sev2          # replaces alerts.slack_on_raise_at_or_above
  steps: [escalate_accountable, escalate_steward, breach]   # paged, at or above the same severity
```

### 2. What pages is policy, never typed

**These page:**
- an item raised at or above `on_raise_at_or_above`;
- for such an item, the ladder steps named in `steps`.

**Everything else** reaches a person on Today, as ADR-0023 has it.

**Severity sets both clocks.** Severity is resolved from policy, and the application's tier is part of it. So a SEV2 on a tier-3 tool does not page unless the tenant's own policy makes it one. There are no quiet hours in the first cut, because the severity threshold is the control.

### 3. A second port: the pager

The notifier reaches a principal, and a page reaches a route, so they are two ports. The **pager** port has two adapters:
- `log`, the laptop default;
- `sns`, which publishes to the route's topic with work-service's own role.

The work-service module grants `sns:Publish` on the routes' topics. A paging product's adapter is added behind the same port later. Its acknowledgement arrives as a webhook and maps to §4's claim.

**A page carries structure, never free text:**
- severity;
- application;
- item id;
- the ladder step;
- the console link.

It carries no title or body. SMS and email go through carriers, and free text stays in the application-data plane ([architecture.md](../architecture.md)). Example: `SEV1 app1 wrk-12 escalate_accountable https://<console>/items/wrk-12`.

### 4. A page is on the record; acknowledging it is a claim

- **On the record.** Every page is recorded on the `WorkItemChased` event it belongs to. On the raise, a `WorkItemPaged` event carries the route and the delivery outcome.
- **What `delivered` means.** For SNS it means SNS accepted the message, not that a phone received it. That is recorded as it is. SNS delivery-status logging for SMS can be turned on in the tenant's account; reading it back is not part of this decision.
- **Acknowledging.** SNS is one-way, so a person acknowledges by claiming the item in the console. The ladder runs until the item is claimed or resolved, as it does now. A paging product's acknowledgement later lands as the same claim.

### 5. maestro's own failures page past maestro

- **Direct alarm actions.** Every maestro component's `alarm_actions` holds two targets:
  - the tenant's `ops-signals` topic, as now, so the failure becomes an item;
  - the `maestro` route's topic **directly**, so the page does not depend on work-service being up.
- **Silence alarms.** The sweep and the relay each get an alarm on silence (`treat_missing_data = breaching`), so a component that stops running pages too. The relay's already exists.
- **The limit, stated.** If the account's SNS or CloudWatch is down, nothing pages. An external heartbeat, outside the tenant's account, is the step after this one.

### 6. The route is proven before anything relies on it

**Acceptance scenario W7:**
- a SEV2 raised on the fixture pages its route;
- the SMS or email arrives;
- the page is on the record;
- a claim in the console stops the ladder;
- a stopped sweep pages the `maestro` route with work-service out of the path.

**Two later steps depend on a route that passed W7:**
- **Retiring an application's own alert** ("one alert, one owner", ADR-0023 §2). Per application, opt-in, only after its route has passed W7.
- **Delegation.** An application's risk appetite may go beyond `cautious` ([ADR-0031](0031-risk-appetite-delegates-decisions.md)) only when its route has passed W7. When that delegation is built, an adverse delegated outcome pages the accountable human.

## Consequences

- **A SEV1 at night reaches a person through maestro.** It reaches them through the application's own paging too, until that alert is retired.
- **Contact details live in one private place**, the tenant repository. Changing the rota is a pull request there.
- **SNS setup in the tenant's account:**
  - leave the SMS sandbox, or verify each destination number;
  - raise the monthly SMS spend limit from its default of 1 USD;
  - confirm each email subscription from the mail it sends. Terraform leaves it pending.

  The tenant's runbook says so.
- **The Slack notifier stays in code, unconfigured**, as ADR-0023 left it. The `alerts` policy key is replaced by `paging`.
- **No rota, schedule or escalation to a next person inside maestro.** A route's subscribers are paged together. Rotas are the paging product's job when one is added.

## Reopen if

- A second person shares on-call. A rota then matters, which means a paging product, or schedules in maestro if none fits.
- SMS delivery proves unreliable in the tenant's country.
- A page route receives more than a person can act on. The threshold is then wrong, or the grouping is.
