# ADR-0022 · One MVP, built whole: no milestones, one acceptance

**Status:** proposed · 2026-09-26 · amends [ADR-0013](0013-intake-agent-and-customer-tenants-are-post-mvp.md) (how the MVP is phased; its scope stands)

## Context

[ADR-0013](0013-intake-agent-and-customer-tenants-are-post-mvp.md) made the MVP four milestones, M1–M4, each ending at a gate. Each one was run on the first tenant and then called closed, which reads as four releases of four partial products. Nobody outside the build uses any of them, and nobody will until the whole engine works: a commitment tracker with no agent, or an agent with no analysis gate, is not what maestro is for.

The words collided with the domain's too. In [CONTEXT.md](../../CONTEXT.md), a **milestone** is a dated objective a work item rolls up to, and a **gate** is where a person decides a version. The plan used both words for something else, so a sentence like "the M2 gate" meant neither.

## Decision

1. **There is one target: the MVP.** Its scope is unchanged: the components, the use cases and the seams in [mvp.md](../mvp.md) and [use-cases.md](../use-cases.md). There are no milestones. No part is released to anyone before the MVP is done. What runs on the first tenant while it is being built is assembly and testing, not a release.
2. **The MVP is done when every acceptance scenario passes, live, on the first tenant.** The scenarios are the checks the four milestones' gates held, gathered into one list in [roadmap.md](../roadmap.md). A scenario that passed earlier is run again before the MVP is called done, because later work can break it.
3. **The plan is [roadmap.md](../roadmap.md): the acceptance scenarios, and the build list that reaches them.** Items are ordered by what depends on what, and marked built, building or to build. There are no dates and no durations.
4. **Words.** An **acceptance scenario** is one of the checks that says the MVP is done (added to [CONTEXT.md](../../CONTEXT.md)). **Gate** keeps its domain meaning only: where a person decides. **Milestone** keeps its domain meaning only: an objective items roll up to. Current documents stop using M1–M4. Earlier decision records keep their words, since a record is not edited.
5. **Release tags stay.** `v*` tags on `fps4/maestro` are what a tenant pins ([ADR-0020](0020-maestros-own-services-live-in-one-repository.md)). A tag is a build the tenant runs, not a product release.

## Consequences

- The work already done keeps its record. The foundation's scenarios (a workspace rebuilt from the archive alone, and the chain verified with every service off) passed on the first tenant on 2026-09-22. That is recorded in the plan as a pass, and is rerun at the end like every other scenario.
- Order still matters, but it is the order of dependencies, not of dates. An agent's run needs a work item to claim; an analysis gate needs the run that proposes the analysis.
- Nothing is "closed" halfway. A component is built when its part of the build list is in code and deployed on the first tenant; the MVP is done only at the end of the list.
- The component pages' "Build gates" sections become "Acceptance": the same checks, named for what they are.

## What would reopen it

Someone outside the build who needs part of the MVP before the whole: a first customer, say, who wants only the advisory lane. That would be a release defined on purpose, with its own scope, and not a milestone numbered after the fact.
