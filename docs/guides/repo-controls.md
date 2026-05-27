---
title: Repo controls — the merge boundary (ADR-0016)
status: draft
last_updated: 2026-05-27
owners: [architect]
related:
  - docs/architecture/decisions/0016-merge-after-workspace-approval.md
  - docs/architecture/decisions/0009-audit-logging-and-observability.md
  - docs/architecture/decisions/0010-public-engine-private-instance-data.md
  - standards/git.yaml
  - .github/CODEOWNERS
---

# Repo controls

Where the merge boundary lives, and what you set up on a product repo. Under
[ADR-0016](../architecture/decisions/0016-merge-after-workspace-approval.md) the boundary is
**maestro-internal**, not a GitHub configuration: maestro executes a merge **only** against a recorded,
role-authorized, unconsumed merge-approval event, and the append-only WORM, hash-chained event log
([ADR-0009](../architecture/decisions/0009-audit-logging-and-observability.md)) makes every merge
attributable and tamper-evident.

This is the **single-layer** model the architect chose: GitHub-side branch protection, required
reviews, CODEOWNERS, and a merge-less token are **not** relied upon as the lock. It reverses ADR-0004's
three-layer, GitHub-enforced approach (see the ADR-0004 → ADR-0016 supersede).

## The boundary (maestro-internal)

1. The orchestrator opens the **merge gate** only once the Definition-of-Done gates are green.
2. The architect **approves in the workspace**; the decision is appended to the event log as a
   role-authorized, attributed **merge-approval event** (ADR-0008/0009/0011).
3. The **github adapter** merges **only** when handed a valid approval event — one that exists, is
   typed merge-approval, matches this task + PR, was made by a participant holding the gate's role for
   the product, and has not already been consumed (anti-replay). Otherwise it **refuses and logs**.
4. That event is the **sole authority**. There is no GitHub-side backstop.

First run verifies the boundary *negatively* (US-0001): an unapproved / forged / replayed merge is
refused and logged.

## What you set up on a repo

| Item | Setting | Why |
|---|---|---|
| **Runtime credential** | **Contents: write** (branch + commit) + **Pull requests: write** + **merge** | so the adapter can open PRs and execute the merge *after* a recorded approval. Lives in the maestro instance's secrets, not this repo ([`setup.md`](setup.md)) |
| **Definition-of-Done CI** | [`.github/workflows/dod.yml`](../../.github/workflows/dod.yml) on PRs | the **quality signal** the orchestrator reads before opening the merge gate — not a GitHub-required status check (branch protection is not the lock) |
| **CODEOWNERS / PR template** *(optional)* | [`.github/CODEOWNERS`](../../.github/CODEOWNERS), `pull_request_template.md` | review-request hygiene and readability only; **not** enforcement under the single-layer model |

## Definition-of-Done checks

[`.github/workflows/dod.yml`](../../.github/workflows/dod.yml) runs the DoD gates that apply to a
docs/config repo today — a secret scan and the ADR-0010 register-privacy guard — and carries commented
stubs for the code-dependent gates (tests, SAST, dependency scan, hallucinated-dep, license/SBOM) to
add when engine code lands. SAST, secret, and dependency scans are floors and are never disabled
(`standards/security.yaml`). DoD-green gates the *opening* of the merge gate; the merge itself is
authorized by the approval event.

## Residual risk (single-layer)

Defence is now one maestro-internal layer, not two independent ones. If maestro itself were compromised,
there is no separate GitHub-side control to prevent an unapproved merge — the WORM event log (ADR-0009)
gives **tamper-evident detection and attribution**, not prevention. Two notes:

- The integrity of the approval event and the adapter's verification *is* the boundary — both are
  covered by acceptance tests (US-0001 / US-0020).
- The boundary is an **engine capability** (the event-gated adapter). Until the engine exists, a manual
  pilot relies on human discipline (work on `maestro/*`, open PRs, a human approves the merge). If you
  want an enforced interim gate before the engine lands, branch protection can be kept temporarily — but
  it is not part of the ADR-0016 target model.
