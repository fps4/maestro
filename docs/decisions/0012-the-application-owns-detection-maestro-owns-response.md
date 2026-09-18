# ADR-0012 · Signals: the application owns detection and publishes to its own topic; maestro owns response

**Status:** accepted · 2026-09-18

## Context

Alarm thresholds could live in the application's infrastructure code or be written by maestro into the tenant's account. The second needs write permission in every tenant account and couples maestro to each application's internals. The first is where the SLO knowledge already is.

## Decision

**The application owns detection**: alarms, DLQ and error-rate thresholds, its own monitor, resource tags, and **one SNS topic per application per environment (`ops-signals`)** that alarm and OK actions target and that admits the maestro account. Deploys and AWS-native findings reach maestro through **EventBridge**. **maestro owns response**: normalisation into one envelope, dedup and correlation, severity from policy, clocks, ceilings, routing to people, maintenance windows, and the detections an application cannot make about itself (silence, estate drift, advisories).

maestro ships the application side as a Terraform module and a CDK construct. Once maestro subscribes, the application's direct alert for the same signal retires — one alert, one owner.

## Consequences

- Onboarding at N1 is "apply the module"; nothing in the tenant account is written by maestro.
- Other subscribers (Chatbot, email, PagerDuty) can share the topic without touching maestro.
- The envelope is versioned and owned by maestro; every source adapter produces it.

## What would reopen it

An application that cannot publish (no IaC, no SNS) — then maestro polls, as a read-only adapter, and the split of ownership stays.
