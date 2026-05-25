# standards

Machine-readable SDLC standards, injected into the agent crew's prompts on every task (see [principle 9](../docs/principles.md) and [ADR-0006](../docs/architecture/decisions/0006-spec-driven-sdlc.md)). This is how the SDLC stays standardised as the crew and the number of products grow — the rules are read by agents, not trusted to memory.

One file per concern. The reviewer agent checks generated work against these; the builder and test agents follow them.

| File | Concern |
|------|---------|
| `documentation.yaml` | Doc structure, frontmatter, EARS acceptance criteria |
| `testing.yaml` | Test coverage, spec-derived tests, the Definition of Done gates |
| `security.yaml` | SAST/secret/dependency floors, the hallucinated-dependency check, secrets handling |
| `naming.yaml` | Repo, branch, file, and identifier conventions |
| `git.yaml` | Branch namespace, commit and PR conventions, the no-merge rule |

A product may add stricter standards; it may not relax the floors marked `enforced: always`.
