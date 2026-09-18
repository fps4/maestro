# ADR-0001 · maestro is an ops engine; idea-to-code is out of scope

**Status:** accepted · 2026-09-18

## Context

The earlier design described a platform that generates applications from specifications, hosts them, and governs them against regulated standards. Two components of it were built (identity-service, specs-service); the rest was design. The work that actually needs doing today is operating applications that already exist, in their owners' cloud accounts, with agents doing the routine part under human authority.

## Decision

The MVP is an **ops engine**: identity-service, specs-service, work-service, runtime-service (the instance register), agent-service (record half), and the spine. Applications run in their own accounts; maestro observes, commits, records and — within explicit authority — acts. It never generates and never hosts an application.

The composition plane, archetype engines, generated applications, execution of instances by the platform, the marketplace and the standards layer are out of scope. The earlier corpus is preserved at git tag `corpus-2026-09` and is not maintained.

## Consequences

- Every component must be useful on its own to someone operating an application; a component that is only useful once applications are generated is not built.
- Exit narrows to the export ([ADR-0004](0004-exit-is-the-portable-export.md)); the substrate can be managed services ([ADR-0002](0002-serverless-aws-is-the-substrate.md)).
- The regulated domain becomes a branch with four seams kept open ([ADR-0013](0013-intake-agent-and-customer-tenants-are-post-mvp.md)).

## What would reopen it

A consumer that needs applications built from specifications, once the ops engine runs for more than one application.
