---
title: Repo controls — enforcing "agents propose, humans merge"
status: draft
last_updated: 2026-05-25
owners: [architect]
related:
  - docs/architecture/decisions/0004-agents-propose-via-pr-humans-merge.md
  - docs/architecture/decisions/0010-public-engine-private-instance-data.md
  - standards/git.yaml
  - .github/CODEOWNERS
---

# Repo controls

How-to for putting the merge boundary *in GitHub*, not just in docs. ADR-0004 specifies three
independent layers; none alone is trusted. This guide sets up all three on a repo (the commands
target `fps4/maestro`; swap the slug for any product repo).

## The three layers

| Layer | What it does | Where |
|---|---|---|
| **CODEOWNERS** | Forces a named reviewer (the architect) onto every PR | [`.github/CODEOWNERS`](../../.github/CODEOWNERS) |
| **Branch protection** | Requires review + green status checks before merge; blocks direct pushes to the default branch | GitHub setting (below) |
| **Merge-less token** | The maestro runtime credential is scoped to branch-create + PR-open, with **no merge rights** | the runtime's GitHub App / PAT (verified at first run — US-0001) |

## 1. CODEOWNERS

Already in the repo at `.github/CODEOWNERS`. It makes the architect a required reviewer on every
path and calls out the governance-critical areas (ADRs, `standards/`, `config/`, `.github/`).
Replace `@fgurbanov` with a team if review should fan out. CODEOWNERS only *enforces* once branch
protection turns on "require review from Code Owners" (next step).

## 2. Branch protection on the default branch

```bash
gh api -X PUT repos/fps4/maestro/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "required_pull_request_reviews[require_code_owner_reviews]=true" \
  -F "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=secret-scan" \
  -f "required_status_checks[contexts][]=register-privacy" \
  -F "enforce_admins=true" \
  -F "restrictions=null"
```

This requires a code-owner-approved PR and the green `dod` checks before any merge, and (with
`enforce_admins`) applies the rule to everyone — including you. Add more contexts as the
Definition-of-Done jobs in [`.github/workflows/dod.yml`](../../.github/workflows/dod.yml) grow.

Verify:

```bash
gh api repos/fps4/maestro/branches/main/protection --jq '{checks: .required_status_checks.contexts, code_owners: .required_pull_request_reviews.require_code_owner_reviews}'
```

## 3. The merge-less runtime token

The maestro runtime authenticates with a GitHub App (or PAT) scoped to **Contents: write**
(branch + commit) and **Pull requests: write** (open/update), but **without** the ability to
merge — no admin, no "allow merge" on protected branches. ADR-0004 makes this load-bearing:
the credential *cannot* merge, so the gate cannot be bypassed even if application code tries.
US-0001's acceptance test verifies this by asserting maestro can open a PR and **cannot** merge it.

> This token is a runtime/deployment concern — it lives in the maestro instance's secrets, not in
> this repo. Setup contracts are in [`setup.md`](setup.md).

## Definition-of-Done checks

[`.github/workflows/dod.yml`](../../.github/workflows/dod.yml) runs the DoD gates that apply to a
docs/config repo today — a secret scan and the ADR-0010 register-privacy guard — and carries
commented stubs for the code-dependent gates (tests, SAST, dependency scan, hallucinated-dep,
license/SBOM) to add when engine code lands. SAST, secret, and dependency scans are floors and are
never disabled (`standards/security.yaml`).
