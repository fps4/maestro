# maestro

**An ops engine for running applications, built from components you can use on their own.**

maestro watches applications that run in their own cloud accounts, turns what it sees into commitments with a named person answerable, lets agents do the work under ceilings a person set, and keeps a record an auditor can verify with every service switched off.

It is not a platform that builds applications. It observes, commits, records, and — within explicit authority — acts.

## The components

| Component | What it holds | Repository | Status |
|---|---|---|---|
| **identity-service** | who is acting: humans, agents, workloads; realms; delegated administration | [`fps4/identity-service`](https://github.com/fps4/identity-service) | built |
| **specs-service** | what was agreed: artifacts, versions, gates, decisions, questions | [`fps4/maestro-specs`](https://github.com/fps4/maestro-specs) | built |
| **work-service** | who owes what, by when, under whose authority — and whether it happened | `fps4/maestro-work` | next |
| **runtime-service** | what is deployed where: the artifact ledger and the instance register | `fps4/maestro-runtime` | next |
| **agent-service** | what agents did: runs, steps, transcripts | this repository, later | next |
| **the spine** | the record: an S3 archive every component's events flow into, with a verifier | this repository, later | next, first |

Each component runs alone: one required dependency (identity-service), every other integration a port with a local default, configuration as the domain model, a console, an API and an MCP server. Together they are maestro.

## Where to start

- [`docs/mvp.md`](docs/mvp.md) — what is being built, what is not, on what substrate. One page.
- [`docs/architecture.md`](docs/architecture.md) — how the components fit, the lines nothing crosses, the spine.
- [`docs/use-cases.md`](docs/use-cases.md) — the flows the MVP exists for, walked through the components.
- [`docs/roadmap.md`](docs/roadmap.md) — four milestones, each with a gate you can watch happen.
- [`docs/decisions/`](docs/decisions/) — the decision log.
- [`CONTEXT.md`](CONTEXT.md) — the vocabulary, for people and agents.

## Status

Design and decisions for the MVP live here. Two components are built and running (see the table). The rest follows the [roadmap](docs/roadmap.md). The earlier design corpus this work grew out of is preserved at git tag `corpus-2026-09` and is not maintained.

## Licence

MIT — see [LICENSE](LICENSE).
