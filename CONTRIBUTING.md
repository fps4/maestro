# Contributing to maestro

maestro is built the way it builds: **spec-driven, gated, and tested**. Whether you are a human or an AI coding agent, the same rules apply.

## The short version

1. **Start from a spec, not a diff.** Significant work needs an approved functional spec and technical design before code. See [`docs/guides/sdlc.md`](docs/guides/sdlc.md).
2. **Work on a branch, open a pull request.** Don't push directly to `main`. (Agents never merge the *products maestro builds* — ADR-0004; for **this engine repo**, the maintainer/owner merges PRs.)
3. **Green before review.** Tests, linters, and security/dependency scans must pass before a human is asked to look.
4. **Docs change with the code.** A behaviour change that leaves docs stale is incomplete. See [`docs/guides/documentation-standards.md`](docs/guides/documentation-standards.md).

## Workflow

```
open/claim an issue  →  spec (if non-trivial)  →  branch  →  implement + tests
   →  PR (green CI)  →  review  →  human merge
```

- **Branches:** feature branches only; agent branches use the `maestro/*` prefix.
- **Commits:** present-tense, imperative subject lines that say what changed and why.
- **Pull requests:** describe what changed, link the issue/spec, and note which acceptance criteria are covered.

## Definition of Done

A change is done when:

- [ ] It satisfies its acceptance criteria (and there are tests proving it).
- [ ] Unit / integration / e2e tests pass with coverage maintained.
- [ ] SAST, dependency, and secret scans are clean (no new high-severity findings).
- [ ] Added dependencies actually exist and are the intended packages.
- [ ] Licenses are compatible and the SBOM is updated.
- [ ] Docs affected by the change are updated in the same PR.
- [ ] A human has reviewed and merged.

## Code of conduct

Be precise, be kind, assume good faith. Disagree on the design in the spec or the PR, not in the abstract.

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
