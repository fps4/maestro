# ADR-0028 · An application that cannot publish is watched from outside by a detector it names; maestro correlates a shared failure

**Status:** proposed · 2026-09-27 · amends [ADR-0012](0012-the-application-owns-detection-maestro-owns-response.md) (its "what would reopen it"); answers the first tenant's own record of its external probe, kept in its infrastructure repository

## Context

[ADR-0012](0012-the-application-owns-detection-maestro-owns-response.md) put detection with the application and response with maestro. It foresaw one exception, an application that cannot publish, and sketched *maestro polls, as a read-only adapter*.

The first tenant met that case on 2026-09-26. Two sites run as containers on one host, reachable only through a tunnel whose connector runs on a second host. Both hosts dropped off the network and nothing reported it.

The tenant's infrastructure chose differently from ADR-0012's sketch, in its own record:

- **An external probe.** A probe in the tenant's account checks each site hourly from outside. It raises a CloudWatch alarm per site (`<application>-production-unreachable`) and publishes it to `<application>-production-ops-signals`, exactly the shape the signals module produces. A missing probe counts as down.
- **A self-alarm.** The probe's own failures go to its own `ops-signals` topic.
- **No hint.** It sends no P1–P4 on purpose: severity is maestro's.
- **Three asks of maestro:**
  - correlate several sites failing together into one cause;
  - attribute site alarms to the probe while the probe itself is failing;
  - order by the alarm's time, not by arrival.

What maestro did on 2026-09-27:

- **Onboarding.** The three applications are onboarded (in the tenant's repository).
- **Severity.** A hintless signal's severity now comes from policy (v0.15.0, `signal_severity`).
- **Not handled yet:**
  - **Correlation.** Intake dedups by fingerprint only, so two sites down behind one tunnel are two SEV items, and a failing probe is three.
  - **An `OK` before its `ALARM`.** The `OK` arrives as a fact for an evidence entry not yet armed and is dropped. The `ALARM` then raises an item that never closes.

## Decision

### 1. A detector outside the application is a publisher like any other, and maestro does not poll

An application that cannot publish is watched by a detector it names, running outside the hosts it watches. The detector publishes to the application's own `ops-signals` topic, in the signals module's shape. Intake cannot tell it apart from the application's own alarms, and does not need to.

**maestro does not poll** an application a detector watches: one detector per signal. ADR-0012's *maestro polls* fallback remains only for an application with neither a signals module nor a detector. The detector's contract is the detector's to keep: stable topic, alarm name and payload.

### 2. A shared failure domain is declared, and an outage in it is one item

An application in work-service's definition may name a `failure_domain`, the thing its reachability rests on that it shares with others. On the first tenant:
- its two sites share one domain, named for the host and tunnel they sit behind;
- a domain may also name its `detector`, here the probe's own application.

Intake then correlates.

- **A domain's first alarm.** When a site's alarm arrives and the domain has no outage open within `correlation_window` (default 15 minutes), it raises the site's item as today. It also opens the domain's **outage**: a record naming that item as the domain's.
- **Further alarms in the domain.** While the outage is open, an alarm on another application in the domain **attaches** to the domain's item (`WorkItemSignalAttached`, the storm path intake already has) instead of raising its own. The item is about the first application. Its title and the signals attached to it name every application in the outage.
- **Closing.** The item's evidence becomes one `signal_ok` per attached fingerprint, all armed together, like a fold's findings. It closes `done` when every site in it is reachable again.
- **The detector's own alarm.** While it is open (the probe's own `ops-signals` alarm), every alarm in a domain it detects attaches to the detector's item instead: a site is not down because the probe that watches it is. Its `OK` does not close the sites' entries; each site's own `OK` does.

### 3. The alarm's own time orders it, not its arrival

A fingerprint's window keeps the last `OK`'s `occurred_at`.

- **A late `ALARM`.** An `ALARM` older than the `OK` already recorded for its fingerprint is recorded as stale and raises nothing.
- **An early `OK`.** An `OK` that arrives before the item it would close exists is kept on the window. When the `ALARM` then raises the item, an `OK` newer than it satisfies the item's evidence in the same transaction.

### 4. What stays

- ADR-0012's split of ownership is unchanged: the detector decides nothing about severity, clocks, people or incidents.
- The weekly advisory fold ([ADR-0025](0025-the-weekly-fold-is-per-application.md)) is not a failure domain. It groups by week, not by cause.

## Asked

1. **Where the failure domain is declared.**
   - *Recommended:* work-service's definition, `applications[].failure_domain` and `policy.failure_domains: { <domain>: { detector?: <application> } }`. Correlation is response, which is maestro's.
   - *Alternative:* runtime-service's register (hosts, substrates). Better placed in the long run, but the register holds no hosts today.
2. **Which application an outage item is about.**
   - *Recommended:* the first application to alarm, with the others named in its title and evidence.
   - *Alternative:* a subject of its own (`subject_type: failure_domain`). This is more exact, but it has no tier or onboarding level to resolve clocks from.
3. **The correlation window.**
   - *Recommended:* 15 minutes, a policy value.
   - Four probe intervals of an hourly probe would be too long for sites that fail independently.

## Consequences

- The first tenant's outage of 2026-09-26 would have been one SEV2 item naming both sites, not two. A probe failure would have been one item, not three.
- Intake gains a read per signal (the domain's open outage), still one transaction per signal.
- A detector's application is observed like any other. Its own silence reads as every site in its domains down, and §2 turns that into one item about the probe.

## What would reopen it

A tenant with many shared domains, or hosts maestro can observe directly. The domain then moves to runtime-service's register, and correlation reads it from there.
