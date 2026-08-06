# specs-service documentation

Two planes: a **Docs** plane you read, and a **Delivery** plane you track.

## Docs plane

| Section | Holds |
|---|---|
| [`design/`](design/) | How it is built and why. [`architecture.md`](design/architecture.md) is the entry point; [`decisions/`](design/decisions/) holds the ADRs; [`ui/`](design/ui/) holds the approved console design |
| `reference/` | API, SDK, MCP tool, and configuration-schema reference. *Not yet written* |
| `guides/` | Setup, defining a workspace, integrating an evaluator. *Not yet written* |
| `product/` | Requirements and user stories. *Not yet written* |

## Start here

1. [`../README.md`](../README.md) — what the service is and what it refuses to do
2. [`design/architecture.md`](design/architecture.md) — the model, ports, isolation, build order
3. [`../GLOSSARY.md`](../GLOSSARY.md) — the vocabulary, and what each term maps to in a consumer
4. [`design/ui/`](design/ui/) — the approved console design, as a single browsable file

## Decisions

| # | Decision |
|---|---|
| [0001](design/decisions/0001-artifact-types-are-configuration.md) | Artifact types, links, gates and lifecycles are configuration, not code |
| [0002](design/decisions/0002-identity-service-is-the-only-dependency.md) | `identity-service` is the only required dependency; everything else is a port with a local default |
| [0003](design/decisions/0003-immutable-versions-mutable-drafts.md) | Drafts are mutable, versions are immutable; proposing snapshots one into the other |
| [0004](design/decisions/0004-facets-are-evaluated-bodies-are-read.md) | Facets are evaluated; bodies are authored, rendered and diffed but never evaluated |
| [0005](design/decisions/0005-agents-may-author-never-decide.md) | Agents author and propose; only a named human decides; no decision surface on MCP |
| [0006](design/decisions/0006-workspace-isolation-by-database.md) | Workspace isolation is database-per-workspace, bound once per request |
| [0007](design/decisions/0007-mongodb-with-inline-bodies.md) | MongoDB, with bodies inline and blobs in object storage |

All seven are `status: proposed` — nothing is implemented, so they are still a design under review
rather than a record of commitments made.

## Conventions

- **An ADR records a decision with a cost.** If there was no alternative worth stating, it is
  architecture, not a decision — put it in `design/`.
- **Docs change in the same pull request as the code they describe.**
- An ADR is revisable while `proposed`. **Once `accepted` it is immutable** — a later ADR supersedes
  or refines it and says so in its front matter, and the original is never rewritten.
