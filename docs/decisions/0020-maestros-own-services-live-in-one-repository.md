# ADR-0020 · maestro's own services live in `fps4/maestro`; a repository is earned by a consumer outside maestro

**Status:** accepted · 2026-09-26 · amends [ADR-0015](0015-repositories-and-licence.md) (its first rule; licence and visibility stand)

## Context

[ADR-0015](0015-repositories-and-licence.md) gave a component its own repository when it had a consumer, and counted specs-service and work-service among those that did. Two milestones in, neither has a consumer but maestro itself — its other components and a tenant's pipeline. What the split has cost, observed while building M2:

- **One change, four repositories.** Relaying work-service's events needed a sealer change in `fps4/maestro` (the spine), a tag and an npm release, a module input in `fps4/maestro-work`, and new pins in the tenant repository — four PRs merged in order, each waiting on the last.
- **Copied code.** work-service's store layer is specs-service's, copied: `db/items.ts` (483 lines) differs by sixteen lines of diff, and the handle, the expression builder, the table check, the code-vs-grant test, the public guards and the CI workflows are copies too. A fix made in one does not reach the other.
- **Pins that can disagree.** The tenant pins each component at its own ref; nothing records that a set of refs was built and tested together.
- **The design and the code apart.** The component pages and ADRs live here and the code they govern elsewhere, so most slices end in a second PR here to bring the docs level.

identity-service is the case ADR-0015's rule was written for: it has consumers outside maestro — fps4's other products sign in through it — and a release cycle of its own.

## Decision

1. **A repository is earned by a consumer outside maestro.** Consumers inside maestro — its components, its tenants' pipelines — do not earn one. ADR-0015's first rule is amended to this; everything else in it stands.
2. **specs-service and work-service move into `fps4/maestro`**, with their history, beside the spine, the signals module and the console:

   ```
   fps4/maestro/
    ├── docs/            the design, CONTEXT.md, the decision log            (as today)
    ├── spine/           @fps4/maestro-spine, still published to npm        (as today)
    ├── signals/  console/                                                   (as today)
    ├── specs/           ← fps4/maestro-specs: api/, web/, terraform/, config/, infra/, docs/
    ├── work/            ← fps4/maestro-work:  api/, terraform/, config/, infra/
    └── scripts/         check-links, check-public, deploy, checkout-components
   ```

3. **identity-service stays in `fps4/identity-service`**, and every future component with an outside consumer gets its own repository, as ADR-0015 said.
4. **One ref names a set.** A tenant pins `maestro` at one tag, which names the spine, specs-service and work-service as built and tested together; `identity-service` keeps its own pin.
5. **Decision logs.** specs-service's own log moves with it to `specs/docs/decisions/` and is closed: its numbers are cited as they are today ("specs-service ADR-0021"). New decisions, whatever they are about, go in `docs/decisions/` here.
6. **The spine stays a published package.** identity-service's relay imports `@fps4/maestro-spine` from npm; inside this repository specs-service and work-service take it as an npm workspace, so a spine change and its first consumer land in one PR.
7. **Shared code becomes a package after the move, not during it.** The store layer both services copy is extracted into one package in its own PR once both live here — the move changes where files are, not what they do.

## How the move is made

One consolidation, at a slice boundary, with nothing open against either repository:

1. `git filter-repo --to-subdirectory-filter specs` over a clone of `fps4/maestro-specs`, the same with `work` for `fps4/maestro-work`; both merged into a branch of `fps4/maestro` with `--allow-unrelated-histories`. Every commit keeps its author, date and message.
2. CI: each service's workflows move to `.github/workflows/specs-*.yml` and `work-*.yml` with `paths:` filters; the public guards, gitleaks and `check-links` run once for the whole tree. The docs link check learns the new paths.
3. Paths: `Repository:` lines in the component pages, links in the docs and READMEs, the CODEBASE and CLAUDE files, the module sources in the examples (`github.com/fps4/maestro//work/terraform?ref=…`).
4. The tenant: `checkout-components.sh` finds packages one level deeper; `deploy.yml` pins `maestro` at the consolidation's tag and drops the two component pins; the root's module sources move to `components/maestro/specs/terraform` and `components/maestro/work/terraform`. The plan must show **no change** to deployed resources — the same bundles from the same code.
5. `fps4/maestro-specs` and `fps4/maestro-work` are archived with a README naming their new home. Their pull requests, issues and links keep working; nothing is deleted.
6. The `FORBIDDEN_PATTERNS` secret, npm's trusted publisher for the spine and the tenant's OIDC trust are unaffected: the first is set on `fps4/maestro` already, the second names this repository's workflow, the third names the tenant repository.

## Consequences

- A cross-cutting change is one PR, reviewed once, with the design beside the code it changes.
- CI on one repository runs more workflows; `paths:` filters keep a docs-only PR to the docs checks.
- The repository is larger and its history mixed; `git log -- work/` reads one service's history.
- An import lint keeps services apart inside the repository, as ADR-0015 already required for code living here: `specs/` and `work/` import from each other only through published contracts (the spine, HTTP), never from each other's source.
- A tenant's pipeline builds more than it deploys; the build is minutes, not a design concern.

## What would reopen it

specs-service or work-service acquiring a consumer outside maestro — a product that runs it without the rest of maestro. It earns its repository then, and moves back out with `git filter-repo`, as it moved in.
