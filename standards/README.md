# standards

Machine-readable SDLC standards, injected into the agent crew's prompts on every task (see [principle 9](../docs/principles.md) and [ADR-0006](../docs/architecture/decisions/0006-spec-driven-sdlc.md)). This is how the SDLC stays standardised as the crew and the number of products grow — the rules are read by agents, not trusted to memory.

One file per concern. The reviewer agent checks generated work against these; the builder and test agents follow them.

| File / dir | Concern |
|------|---------|
| `documentation.yaml` | Doc structure, frontmatter, EARS acceptance criteria |
| `testing.yaml` | Coverage, spec-derived tests, the Definition of Done gates, **+ the layered agent-testing model** (contract / behavioral / quality) |
| `security.yaml` | SAST/secret/dependency floors, the hallucinated-dependency check, secrets, **+ the runtime/container floor** |
| `naming.yaml` | Repo, branch (including per-task pattern), file, identifier, **and infrastructure** conventions |
| `git.yaml` | Branch namespace, commit and PR conventions, the no-merge rule |
| `reliability.yaml` | SLOs, golden signals, burn-rate alerts, incident response, and agent reliability contracts |
| `patterns.yaml` | Mandatory service + agent patterns (health, logging, idempotency, run-event logging, model-tier selection, the orchestrator boundary) |
| `prompts/` | One file per agent — the prompt the crew runs on every task; reviewed via PR diff like any other doc |

A product may add stricter standards; it may not relax the floors marked `enforced: always`.
