---
title: Specifications next to the code
status: draft
last_updated: 2026-09-15
owners: [architect]
related:
  - ../design/decisions/0016-the-git-native-path.md
  - ../design/decisions/0005-agents-may-author-never-decide.md
---

# Specifications next to the code

A specification for a service lives most naturally beside the code it describes, as a markdown file,
reviewed in the pull request that changes the code. This guide is the whole of that path: a file
with front-matter, one command, one workflow step, and a decision that stays a person's.

## The file

```markdown
---
type: specification
title: Materiaalstaat generator
artifact: art-7q2k9…                        # after the first propose: revise this lineage
classification: { lawful_basis: contract, retention: 7y, personal_data: false }
links: [{ type: justified_by, target: art-c4se… }]
class: generative
personal_data_in_scope: false
consequence_class: c2
---
## Scope

When a project is selected, the system shall generate the materiaalstaat.

## Acceptance criteria

| id   | text                                                            | priority | verify |
|------|-----------------------------------------------------------------|----------|--------|
| AC-1 | When a project is selected, the system shall generate the staat | must     | test   |
```

Everything above the second `---` is what the api needs; everything below is the body. `type` and
`title` are required; `artifact` names the lineage to revise (omit it the first time, then paste
the id the command prints); `classification`, `links`, `catalogue_refs` and `effective` are passed
through. Every other top-level key, and everything under `facets:`, is a facet.

**The acceptance criteria are a table, not front-matter.** The `specification` type declares that
the table under the heading *Acceptance criteria* is the facet `acceptance_criteria`
([ADR-0017](../design/decisions/0017-one-document.md)): header cells become keys, rows become the
objects the gate reads. Write them once, as prose a reviewer can read; there is no second form.

## The command

```bash
export SPECS_URL=https://specs.example.com
export SPECS_TOKEN=…                        # your token, or an agent's

cd maestro-specs/api
npm run specs -- propose ../../my-service/docs/spec.md --workspace maestro-platform
```

```
proposed art-7q2k9…@3 (sha256:9f2c…)
  conformance: unavailable — endpoint names `EVALUATOR_BASE`, which this deployment does not set
{"artifact":"art-7q2k9…","ordinal":3,"digest":"sha256:9f2c…"}
```

What it does, in order: reads the file; if `artifact` is set, **withdraws any earlier version of
that lineage you proposed that nobody has decided on** (one live proposal per lineage — pass
`--keep-proposed` to leave them); creates a draft with the facets marked `declared` under your
token or `extracted` under an agent's; asks the draft's **readiness** and refuses, naming what is
missing, before it would hit a 422; proposes; runs the evaluations the gate requires and reports
each as recorded or unavailable. The last line is JSON, for a workflow step to pick up.

Then, when you are the one deciding:

```bash
npm run specs -- packet specification_gate art-7q2k9…@3 --workspace maestro-platform
npm run specs -- decide specification_gate art-7q2k9…@3 --workspace maestro-platform \
  --outcome approve --reasoning "Reviewed in PR #42." --attr seat=owner --attr oversight_level=O2
```

`packet` prints the same thing the decision page shows, as markdown. `decide` records the decision
under **your** token: `accountable` is resolved from the session and cannot be set to anyone else,
and the attribution profile refuses a non-human — so an agent's token, or a service credential a
CI runner holds, cannot decide. That is the point, not a limitation.

## The workflow

In the repository that holds the spec:

```yaml
# .github/workflows/spec.yml
name: spec
on:
  pull_request:
    paths: [docs/spec.md]

permissions:
  contents: read
  pull-requests: write

jobs:
  propose:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: propose
        uses: fps4/maestro-specs/.github/actions/specs@main
        with:
          command: propose
          url: ${{ vars.SPECS_URL }}
          token: ${{ secrets.SPECS_TOKEN }}        # the proposing principal — see below
          workspace: maestro-platform
          file: docs/spec.md
      - id: packet
        uses: fps4/maestro-specs/.github/actions/specs@main
        with:
          command: packet
          url: ${{ vars.SPECS_URL }}
          token: ${{ secrets.SPECS_TOKEN }}
          workspace: maestro-platform
          gate: specification_gate
          artifact: ${{ steps.propose.outputs.artifact }}
          ordinal: ${{ steps.propose.outputs.ordinal }}
      - uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.createComment({
              ...context.repo, issue_number: context.issue.number,
              body: `Proposed \`${{ steps.propose.outputs.artifact }}@${{ steps.propose.outputs.ordinal }}\`.\n\n` +
                    `${{ vars.SPECS_URL }}/gates/specification_gate/${{ steps.propose.outputs.artifact }}/${{ steps.propose.outputs.ordinal }}\n\n` +
                    process.env.PACKET,
            });
        env:
          PACKET: ${{ steps.packet.outputs.packet }}
```

Every push to the pull request proposes a new version and withdraws the previous proposal; the
comment carries the decider's packet and the link to the decision page. **There is no `decide`
step.** The person accountable decides on the decision page, or with `specs decide` under their own
token, and the merge follows the decision rather than standing in for it.

### Whose token proposes

`SPECS_TOKEN` in the workflow is the principal every proposal is attributed to. Make it an **agent
principal** registered for the repository — not a person's token in a secret. Its facets are then
marked `extracted`, a person confirms them before the gate opens, and the record says truthfully
that a pipeline proposed and a person stood behind it. A person's token in CI would claim the
opposite.

## What this is not

It is not a second store. The file is the authoring surface; the version, its digest, the
evaluations, the questions and the decision are in the service, and the file has no way to change
any of them after the fact. Git history and the record can disagree — a file edited without a new
propose — and when they do, the record is right, because it is the one a named human accepted.
