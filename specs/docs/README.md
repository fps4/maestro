# specs-service documentation

Two planes: a **Docs** plane you read, and a **Delivery** plane you track.

## Docs plane

| Section | Holds |
|---|---|
| [`design/`](design/) | How it is built and why. [`architecture.md`](design/architecture.md) is the entry point; [`decisions/`](decisions/) holds the ADRs; [`ui/`](design/ui/) holds the approved console design — its tokens and treatments; its screen content predates the MVP workspace |
| `reference/` | API, SDK, MCP tool, and configuration-schema reference. *Not yet written* |
| `guides/` | [`git-native-specs.md`](guides/git-native-specs.md) — a specification as a file next to the code. Setup, defining a workspace, integrating an evaluator: *not yet written* |
| `product/` | Requirements and user stories. *Not yet written* |

## Start here

1. [`../README.md`](../README.md) — what the service is and what it refuses to do
2. [`design/architecture.md`](design/architecture.md) — the model, ports, isolation, build order
3. [`../GLOSSARY.md`](../GLOSSARY.md) — the vocabulary, and what each term maps to in a consumer
4. [`design/ui/`](design/ui/) — the approved console design, as a single browsable file
5. [`../../docs/components/specs-service.md`](../../docs/components/specs-service.md) — what maestro's MVP uses this service for, and how it deploys

## Decisions

| # | Decision |
|---|---|
| [0001](decisions/0001-artifact-types-are-configuration.md) | Artifact types, links, gates and lifecycles are configuration, not code |
| [0002](decisions/0002-identity-service-is-the-only-dependency.md) | `identity-service` is the only required dependency; everything else is a port with a local default |
| [0003](decisions/0003-immutable-versions-mutable-drafts.md) | Drafts are mutable, versions are immutable; proposing snapshots one into the other |
| [0004](decisions/0004-facets-are-evaluated-bodies-are-read.md) | Facets are evaluated; bodies are authored, rendered and diffed but never evaluated |
| [0005](decisions/0005-agents-may-author-never-decide.md) | Agents author and propose; only a named human decides; no decision surface on MCP |
| [0006](decisions/0006-workspace-isolation-by-database.md) | Workspace isolation is one prefix per workspace, bound once per request — amended by 0021 (was database-per-workspace) |
| [0007](decisions/0007-mongodb-with-inline-bodies.md) | MongoDB, with bodies inline and blobs in object storage — **superseded** by 0021 |
| [0008](decisions/0008-the-catalogue-is-a-workspace.md) | The catalogue is a workspace, reached through a read-only handle |
| [0009](decisions/0009-external-and-platform-standards-are-distinct-types.md) | External and platform standards are distinct types, not one type with a flag |
| [0010](decisions/0010-effective-dating-and-acceptance-lapse.md) | Versions may be effective-dated, and a *material* change lapses an acceptance |
| [0011](decisions/0011-password-grant-first-pkce-later.md) | The console ships with the password grant; PKCE is the follow-up |
| [0012](decisions/0012-labels-not-identifiers.md) | Every identifier a workspace declares has a label, and no surface shows the identifier |
| [0013](decisions/0013-the-decision-page-is-the-product.md) | The decision page is the product; the decider's packet is one call, shared by console and MCP |
| [0014](decisions/0014-questions-on-a-version.md) | A question on a version is a fact about it, not a comment; asked by anyone, answered by anyone, closed by a human |
| [0015](decisions/0015-the-evaluator-port-has-a-floor.md) | The evaluator port has a floor — the facet schema, as findings — and an outbound call; a draft can ask what it still needs |
| [0016](decisions/0016-the-git-native-path.md) | A specification may be a file next to the code; proposing is a command and a workflow step; deciding stays a person's act |
| [0017](decisions/0017-one-document.md) | One document is the artifact; the facets are a projection of it, derived at save; typed blocks are declared, not coded |
| [0018](decisions/0018-openspec-interoperate-not-adopt.md) | specs-service stays the record; OpenSpec is interoperated with (a block shape, one notation), not adopted — **accepted** |
| [0019](decisions/0019-the-outbox-holds-spine-envelopes.md) | The outbox holds maestro's spine envelope, built and validated in the transaction; an agent acts under a seat occupancy that names the answerable human; free text leaves the body; principal ids carry the kind — **accepted** |
| [0020](decisions/0020-the-payload-store-and-the-rebuild.md) | What the record cannot say goes to the payload store; a workspace is rebuilt from the archive and the payloads alone — **accepted** |
| [0021](decisions/0021-the-store-is-dynamodb.md) | The store is DynamoDB (maestro ADR-0018): one table, a prefix per workspace, every query a key or an index, the outbox one transaction — **accepted** |

0001–0017 are `status: proposed`: the builds exist, but nothing has run against real content yet,
so they remain a design under review rather than a record of commitments made (0007 is
superseded). 0018–0021 are `accepted` — taken explicitly by the architect, and constraining work
rather than describing a design.

## Conventions

- **An ADR records a decision with a cost.** If there was no alternative worth stating, it is
  architecture, not a decision — put it in `design/`.
- **Docs change in the same pull request as the code they describe.**
- An ADR is revisable while `proposed`. **Once `accepted` it is immutable** — a later ADR supersedes
  or refines it and says so in its front matter, and the original is never rewritten.
