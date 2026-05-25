# maestro

*An architect-directed agentic delivery platform.*

maestro is a crew of AI agents that build real software on real infrastructure — **GitHub** for the codebase, **Slack** as the human control surface, and **Claude** for reasoning — with a human architect (technical product owner) in the loop at every gate.

You describe a unit of work; the crew writes the spec, designs it, implements it on a branch, runs the full quality suite, and opens a pull request. You review and merge. Agents propose; **humans dispose**.

## Why maestro is different

Most agentic coding tools are repo-scoped and single-operator: one repo, one person, one PR. maestro organises work around a **product** — *one or more repositories* and *one or more human participants* — and splits review into two separately-owned gates:

- **Functional review** — *is this the right thing to build?* (a product reviewer, or you)
- **Technical review** — *is it designed and built right?* (always you, the architect)

That governance model — an architect-owned design gate, split functional/technical review, and a multi-repo multi-participant product — is the part no mainstream tool implements.

## How it works

maestro standardises a **spec-driven SDLC**: the specification is the source of truth, code is its expression. Every unit of work flows through four artifacts and two gates:

```
Charter (product, durable)
   │
   ▼  intent (Slack)
Functional spec  ──[ FUNCTIONAL GATE — pre-code ]──►   (product reviewer | architect)
   │  user stories + EARS acceptance criteria
   ▼
Technical design + tasks  ──[ TECHNICAL GATE — design ]──►   (architect)
   │
   ▼  crew builds on a maestro/* branch
Automated quality gates (must all pass)
   │  spec-tests · unit/integration/e2e · SAST · deps+secrets · hallucinated-dep · license/SBOM
   ▼
Pull request, annotated per requirement  ──[ TECHNICAL GATE — merge ]──►   (architect)
   │
   ▼  a human merges in GitHub  →  done
```

The merge gate is enforced **in GitHub** (branch protection, required checks, CODEOWNERS, a token without merge rights) — not by agent goodwill. See [`docs/guides/sdlc.md`](docs/guides/sdlc.md).

## Principles

- **Spec-driven** — nothing is built without an approved spec.
- **Human-in-the-loop by design** — the gates are the product, not friction.
- **Agents propose, humans merge** — agents open PRs on `maestro/*` branches; they never merge.
- **Fully automated testing** — every product has CI; tests and quality gates block merge.
- **Open-source as a value, private by default** — favour OSS and permissive licenses; repos are private until a deliberate decision opens them.
- **Deploy where the product needs** — lab servers by default; cloud (AWS / Azure / GCP) when the product's technology requires it.

Full text: [`docs/principles.md`](docs/principles.md).

## Documentation

| Doc | Purpose |
|---|---|
| [`docs/principles.md`](docs/principles.md) | The charter — the durable rules |
| [`docs/product/vision.md`](docs/product/vision.md) | Problem, users, goals, non-goals |
| [`docs/product/prd/`](docs/product/prd/) | Product requirements |
| [`docs/architecture/`](docs/architecture/) | System design, data model, ADRs |
| [`docs/guides/sdlc.md`](docs/guides/sdlc.md) | The spec-driven SDLC maestro runs and follows |
| [`docs/guides/documentation-standards.md`](docs/guides/documentation-standards.md) | How docs are structured |
| [`CODEBASE.md`](CODEBASE.md) · [`AGENTS.md`](AGENTS.md) · [`GLOSSARY.md`](GLOSSARY.md) | Repo orientation |

## Status

Founding scaffold — product and architecture docs only; no agent code yet. Start at [`docs/README.md`](docs/README.md).

## License

[MIT](LICENSE).
