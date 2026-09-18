# ADR-0009 · One severity scale, SEV1–4; policy lives in work-service's definition

**Status:** accepted · 2026-09-18

## Context

The first application classifies its own failures P1–P4. An ops engine that carried a second scale would need a person to translate at every incident. Response and resolution clocks, agent ceilings and chase ladders need a home before any standards registry exists.

## Decision

The engine's scale is **SEV1–4**. An application's own scale is mapped once, in the tenant's policy (`P1 → SEV1` … by default). Severity is **resolved from policy** — signal kind × application tier — never typed in; an agent may propose a reclassification, a person confirms it as a recorded fact.

**Policy lives in work-service's workspace definition**: severity × tier → `respond_by` / `resolve_by`; ceilings per agent per remediation class; chase ladders; the mapping. Fields exist from the first build so a registry can take them over later.

## Consequences

- Breach is computed from the original severity and `opened_at`, never from current state.
- Policy is tenant configuration in `maestro-config-<tenant>`, never code.

## What would reopen it

A standards registry that supplies effective-dated policy; the fields move, the scale does not.
