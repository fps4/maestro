# @fps4/maestro-signals

The application-side half of maestro's [signals contract](../../docs/signals.md) as a CDK
construct: the `ops-signals` topic and its policy, the tag schema, an alarm-action helper, and an
optional heartbeat so silence is detectable. The Terraform module beside it creates the same
things; [`../README.md`](../README.md) documents both.

```ts
import { OpsSignals } from '@fps4/maestro-signals';

const signals = new OpsSignals(this, 'Signals', {
  application: 'app1',
  environment: 'production',
  tier: 'tier1',
  maestroAccountId: this.node.getContext('maestroAccountId'), // never a literal in a repository
});

signals.wireAlarm(myAlarm); // ALARM and OK to the topic
```

**Not yet published.** The package is `private`; whether it goes to npm, GitHub Packages or is
vendored is a later decision. Until then, consume it from a checkout of this repository.

```sh
npm ci
npm run lint && npm run typecheck && npm test && npm run build
```
