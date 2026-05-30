---
title: "M2 — Build → merge (the MVP)"
status: accepted
last_updated: 2026-05-29
accepted_on: 2026-05-29
accepted_by: "@farid (architect)"
owners: [architect]
related:
  - docs/roadmap.md
  - docs/roadmap/m1-spec-to-design.md
  - docs/product/prd/0001-architect-directed-delivery-loop.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0011-implement-and-open-pr.md
  - docs/product/user-stories/EP-01-delivery-loop/US-0014-generate-spec-derived-tests.md
  - docs/product/user-stories/EP-02-engine-foundation/US-0023-artifact-store-and-sharing.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0030-reviewer-webapp-and-wiki.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0033-workspace-artefacts-browser-m2.md
  - docs/architecture/decisions/0006-spec-driven-sdlc.md
  - docs/architecture/decisions/0012-artifact-storage-and-sharing.md
  - docs/architecture/decisions/0014-orchestration-runtime-langgraph.md
  - docs/architecture/decisions/0016-merge-after-workspace-approval.md
  - docs/architecture/webapp-concept.md
---

## How to read this

Per-milestone scoping doc for **M2** as defined in [`roadmap.md`](../roadmap.md#build-track--milestones). M1 closed the spec-and-design half of the delivery loop in the workspace ([M1 scoping doc](m1-spec-to-design.md)); **M2 closes the build-and-merge half — the MVP**. The roadmap names *what* M2 ships; this doc decomposes it into user stories, defines dependency order, and lists the M2-specific open questions that will surface in implementation.

Epics persist across milestones — `EP-01-delivery-loop` accumulates M2 stories alongside its M1 ones; `EP-02-engine-foundation` and `EP-03-reviewer-surface` likewise.

M2 builds directly on **everything M1 shipped**: the LangGraph runtime, the spec & design agents, the workspace surface for gate decisions. M2 turns that into the rest of the loop — **approved design → implementation on a `maestro/*` branch → PR → green DoD → merge gate in the workspace → maestro executes the merge against the recorded approval event** ([ADR-0016](../architecture/decisions/0016-merge-after-workspace-approval.md)).

## M2 goal

A real intent — already approved through M1's spec and design gates — produces an implementation on a `maestro/*` branch, opens a draft PR, runs the Definition-of-Done gates (with spec-derived tests as the first one), and on a green DoD opens the **merge gate** in the workspace. The architect approves; maestro executes the merge against the recorded approval event; the delivery task is `done` on the observed merge event.

Plus the **artefacts browser (S4)** in the workspace so spec/design/PR/diff/test-report references resolve through one MIT-backed `ArtifactStore` ([ADR-0012](../architecture/decisions/0012-artifact-storage-and-sharing.md)) — short-lived presigned URLs, per-product isolation, never a permanent public link.

## M2 deliverables → user stories

The roadmap's M2 line maps to user stories as follows.

| Roadmap deliverable | Epic | Story |
|---|---|---|
| Builder agent: approved design → implementation on `maestro/*` → draft PR with requirement→change traceability | `EP-01-delivery-loop` | [US-0011 — Implement and open PR](../product/user-stories/EP-01-delivery-loop/US-0011-implement-and-open-pr.md) (L) |
| Test agent: generate + run spec-derived tests as the first DoD gate | `EP-01-delivery-loop` | [US-0014 — Generate spec-derived tests](../product/user-stories/EP-01-delivery-loop/US-0014-generate-spec-derived-tests.md) (L) |
| `ArtifactStore` egress: spec / design / diff / test-report / SBOM stored & shared via presigned URLs (MinIO on ds1 default, AWS S3 per-product opt-in) | `EP-02-engine-foundation` | [US-0023 — Store and share artefacts](../product/user-stories/EP-02-engine-foundation/US-0023-artifact-store-and-sharing.md) (L) |
| Workspace **artefacts browser** (S4 of US-0030): a per-task index of diffs / test reports / SBOMs resolved through the `ArtifactStore` | `EP-03-reviewer-surface` | [US-0033 — Workspace artefacts browser (M2 slice of US-0030, S4)](../product/user-stories/EP-03-reviewer-surface/US-0033-workspace-artefacts-browser-m2.md) (L) |

**Cross-cutting engine work M2 must build** (rides under the stories above, not separate cards yet):

- **LangGraph stage-wiring — build + merge** ([ADR-0014](../architecture/decisions/0014-orchestration-runtime-langgraph.md)). Extends the M1 graph: after the `technical_design` gate approves, the runtime routes to a `build_node` (US-0011), waits on DoD gates, then `interrupt()`s at the `merge_gate`. On approve, the merge node calls the existing `GitHubAdapter.merge` boundary; on approval, the task ends.
- **The merge boundary's other half** — ADR-0016 already refuses to merge without an approval event ([M0 spine](m1-spec-to-design.md) / M1 #4); M2 is when it actually merges. The `merge.executed` event is what marks `done`.
- **DoD orchestration** ([ADR-0006](../architecture/decisions/0006-spec-driven-sdlc.md)): the spec-adherence gate is the test agent (US-0014); the SAST / secret / dependency / license-SBOM floors run in CI. The orchestrator reads CI status (via the GitHub adapter), opens the merge gate only when all are green.
- **Workspace merge-gate page** — the same `decide_gate` endpoint pattern from M1 #4, with `gate.type = "merge"` (the contract already names it forward-compatible). The PR-diff anchor locator (`{path, side, line}`) is the new anchoring shape, also already named in the M1 contract.
- **Engine guardrails** ([US-0024](../product/user-stories/EP-02-engine-foundation/US-0024-engine-hardening-review-gaps.md), Tier 1–2): the refinement-loop cap + drain switch + `ModelClient` budget caps bound runaway cost; prompt provenance lands on every `llm_call` (M7); the register self-deal invariant and dev-stub Access guard close the governance/auth gaps.

**M2 audit-corpus redaction stance (US-0024 M9).** M2 writes PR diffs, intent text, comments and (if content capture is enabled) LLM I/O. Concrete DLP tooling (e.g. Presidio) is M3 (ADR-0009). The **M2 floor** is a minimal, dependency-free secret/email regex (`model.redact.redact`) applied where maestro persists model I/O that could echo a credential — today the `error` field of a failed `llm_call`. Prompt/response *content* stays off by default. Operating rule until the M3 tooling lands: **do not paste live secrets into intent or comments** — the M2 corpus is floor-redacted, not DLP-grade.

## Dependency order

```
M1 closed (LangGraph + spec/design agents + workspace S2/S3)   ← shipped
  ├── ArtifactStore egress (US-0023)                            ← independent; can start day 1
  │     └── Workspace artefacts browser (US-0033 / S4)          ← consumes the egress
  └── LangGraph build-and-merge stage-wiring
        ├── Builder agent (US-0011)                             ← needs design.produced event from M1
        │     ├── PR opened ⇒ DoD gates start
        │     └── Test agent (US-0014)                          ← runs on the open PR
        │           └── On all-green DoD ⇒ merge_gate opens
        └── Workspace merge-gate page                           ← reuses M1's gate-decision endpoint with gate.type=merge
              └── On approve ⇒ GitHubAdapter.merge (ADR-0016 boundary, M0+M1 already proves the refusal half)
                    └── merge.executed event ⇒ task done
```

**Parallel streams:**

- **Engine stream** — LangGraph build + merge stage-wiring against M0 stores with a mocked GitHub client (same pattern as M1 #7).
- **Agent stream** — US-0011 (builder) and US-0014 (test) develop against fixture LLM responses + the existing harness; same shape as the M1 spec/design agents.
- **Surface stream** — US-0033 (the artefacts browser; the M2 slice of US-0030) develops against the M1 contracts + the `ArtifactStore`'s presigned-URL surface.
- **Storage stream** — US-0023 lands the `ArtifactStore` egress (one client, two backends) independently of the rest; the agents consume it as soon as it exists, but a deployment without it can still run M1.
- **Join** — a real intent driven end to end (intent → spec → design → build → PR → green DoD → merge gate → merge executed) is the integration point. **This is the MVP.**

## What M2 does NOT ship

Explicitly carved out — keeps scope tight at review time:

- **Independent reviewer agent (US-0015) + docs agent (US-0016)** — M3. M2's DoD relies on the test agent + the CI floors only. (US-0011 names the independent review as a future DoD gate; that gate doesn't exist yet in M2.)
  - **No independent reading of *intent* in M2 (US-0024 H1).** The test agent (US-0014) derives its tests from the **same** EARS criteria the builder consumed; with no independent reviewer agent (US-0015, M3), the only independent reading of intent before merge is the architect's. M2's exit criteria and the workspace merge affordance SHALL state this plainly ("no independent reviewer agent yet — US-0015 is M3") so auto-eligibility (principle 10) stays tight until it lands. Cheapest interim mitigation: assign the test agent a **different model variant** from the builder (US-0015 AC / US-0024 M3) — this introduces independence the docs don't currently preclude, rather than fixing a documented coupling.
- **The authenticated edge** — M3. M2 still runs behind the dev-stub identity (`MAESTRO_DEV_IDENTITY`, [ADR-0019](../architecture/decisions/0019-workspace-identity-component-auth-google-sso.md)); `component-auth` over the Cloudflare Tunnel/Access lands in M3 alongside the per-participant inbox (S6).
- **Per-participant inbox (S6)** — M3.
- **External / commercial product** — M4. M2 closes the MVP on the dogfood technical product (maestro itself); the first commercial product comes after M3 lands the auth edge.
- **Group-decision semantics** — US-0017; M2 keeps the M1 single-architect assumption.
- **Notification channels** — EP-04 (M3); Slack/Telegram deep-link to a merge gate is part of that slice, not this one.
- **The literal diff-of-artefact view in S2/S3** — already noted in M1 as a small follow-up (read-API `?commit=` extension + `react-diff-viewer-continued`); will land as a small slice independent of M2's critical path.

If any of these creep into an M2 PR, the PR is out of scope — open a follow-up story in the relevant epic instead.

## What M2 proves

- **[ADR-0016](../architecture/decisions/0016-merge-after-workspace-approval.md) (full)** — the merge boundary actually merges: a workspace approval at the merge gate is recorded as an attributed event, and the adapter executes the merge against that event. M0 + M1 proved the *refusal* half (refuse without an approval, refuse with a stale / unauthorised one); M2 proves the *execution* half.
- **[ADR-0014](../architecture/decisions/0014-orchestration-runtime-langgraph.md) (full M1+M2 loop)** — LangGraph carries the task all the way through, with two more `interrupt()` gates (build → DoD wait → merge) on the event-authoritative log.
- **[ADR-0006](../architecture/decisions/0006-spec-driven-sdlc.md) DoD** — the test agent's spec-derived tests **block** the merge gate, not advise it. AI-generated code carries materially higher defect rates ([principle 4](../principles.md)); this is the structural mitigation.
- **[ADR-0012](../architecture/decisions/0012-artifact-storage-and-sharing.md)** — `ArtifactStore` carries diffs / test reports / SBOMs without exposing a long-lived public link or letting artefacts leak across products (presigned + per-product bucket/prefix).

## Definition of "M2 complete"

M2 is complete when, against the **maestro product itself** (the dogfood technical product):

1. A real intent that goes through M1's spec and design gates yields an implementation on a `maestro/*` branch with a draft PR carrying requirement → change traceability.
2. The **test agent** generates and runs at least one test per EARS criterion in the functional spec; the spec-adherence gate goes green on a passing run.
3. With all DoD gates green (spec-adherence + the CI floors), the workspace **merge gate** opens; the architect approves; **maestro executes the merge** against that recorded approval event ([ADR-0016](../architecture/decisions/0016-merge-after-workspace-approval.md)).
4. The delivery task is `done` on the observed `merge.executed` event — never on an agent claim ([US-0011 §notes](../product/user-stories/EP-01-delivery-loop/US-0011-implement-and-open-pr.md)).
5. Spec / design / PR diff / test report / SBOM are addressable through the `ArtifactStore` and browsable in the workspace's S4 view.
6. All of the above is **event-sourced and replayable** — re-running the projection reconstructs the task's full lifecycle (M1 closure + build + DoD + merge).

M2 closure **is** the MVP (adoption rung 2 — *automated loop, dogfood*). M3 (hardening + inbox + auth edge) and M4 (commercial onboarding) build on it.

## Open questions specific to M2

All resolved 2026-05-29 on scoping-doc acceptance; the M2 stories (US-0011, US-0014, US-0023, US-0033) move from `draft → accepted` carrying these decisions as their binding shape.

| Question | Owner | Status |
|---|---|---|
| **DoD orchestration mechanics.** Does the orchestrator poll CI for the floor gates (SAST / secrets / deps / SBOM-license) via the GitHub adapter's `pulls/{n}/checks` shape, or does CI **post** its status into the orchestrator via a webhook ([ADR-0017](../architecture/decisions/0017-github-app-and-webhook-ingestion.md))? The latter is forward-compatible with M3's full webhook ingestion; the former lands faster. | @architect | **Resolved 2026-05-29.** Poll CI via `GitHubAdapter.pulls/{n}/checks`. The merge gate is human-paced — a 30-second status latency is invisible to the architect. Pulling M3's webhook ingestion forward to satisfy forward-compat would expand M2 scope past the MVP boundary; the polling code (~30 lines) is replaced cleanly when ADR-0017's reconciler lands in M3. |
| **Test agent boundary.** The test agent generates tests and runs them; does it **always** run in maestro's runtime, or does it generate test files in the same `maestro/*` commit and let the product's CI run them? The first is more uniform; the second matches the product's existing test framework. | @architect | **Resolved 2026-05-29.** The test agent **commits test files into the `maestro/*` PR; product CI runs them**. Tests are first-class artefacts of the spec — they belong next to the code they verify, code-reviewable as part of the PR, durable across reruns. The spec-adherence DoD gate collapses cleanly into "the test job is green," which Q1's poll already reads. For the M2 dogfood (maestro itself) tests land in `tests/` under the existing pytest config; no new infra. |
| **Builder agent commit shape.** One big commit per delivery task, or multiple commits along the task list ordered by dependency? (US-0011 says "implementation" — leaves it open.) Multi-commit gives a nicer review timeline; one-commit is simpler. | @architect | **Resolved 2026-05-29.** **One commit per task-list entry**, message format `task-{n}: <task title>`. US-0011's "requirement → change traceability" is most legible when the commit graph mirrors the design's task structure — every commit points back to a numbered task, which points back to an EARS criterion. Supports `git bisect` if a later DoD failure isolates to one task. The builder agent SHALL squash iteration noise so the final commit set **is** the task list, not its drafts. |
| **`ArtifactStore` backend at MVP.** MinIO on ds1 is the default per ADR-0007 / ADR-0012; AWS S3 is a per-product opt-in. **Does maestro itself (the M2 dogfood product) run on MinIO or S3?** Either is defensible; the answer drives the M2 deployment runbook. | @architect | **Resolved 2026-05-29.** **MinIO on ds1.** Dogfood the documented default ([ADR-0007](../architecture/decisions/0007-per-product-deployment-targets.md) / [ADR-0012](../architecture/decisions/0012-artifact-storage-and-sharing.md)) — if the default backend doesn't work for maestro's own M2, every onboarded product inherits a broken path. The S3 branch gets exercised at M4 when the first commercial product opts in. **Operational follow-up before real artefacts land:** MinIO durability story (erasure coding + offsite backup) per [`roadmap.md` risks](../roadmap.md#risks-and-constraints). |
| **Merge-gate page shape.** Reuse M1's per-task page with a "merge gate" panel, or a dedicated `/products/{p}/tasks/{t}/merge` page? The latter mirrors a PR-review view; the former keeps the workspace one-page-per-task. | @architect | **Resolved 2026-05-29.** **Reuse M1's per-task page with a "merge gate" panel** alongside the spec / design gate panels. GitHub already has a great PR-review surface; don't recreate it. The workspace's value-add is the *decision event* + the *comment thread anchored to the diff* — same shape as M1's spec/design gates. Preserves the M1 one-page-per-task mental model. |
| **PR-diff anchor locator UX.** The contract already names `{path, side, line}` (workspace-write-api.md §anchor-locators); the comment composer needs to surface a "click a line in the diff" affordance. Tied to the literal diff-of-artefact follow-up — share the same diff component? | @architect | **Resolved 2026-05-29.** **Yes — share the diff component.** Extract the `react-diff-viewer-continued` call site that shipped in PR #45 (the literal diff-of-artefact view at M1 close) into one component, parametrize on data source (artefact-side blob diff vs PR file diff), and add a "click a line → seed anchor `{path, side, line}`" affordance for the comment composer. One diff component, three surfaces (artefact diff, refinement-loop diff, merge-gate PR diff). |
| **US-0033 split.** Split out S4 (artefacts browser) from US-0030 the same way US-0032 was split for S2/S3, or carry US-0030 with a `milestone` span until S4 ships? | @architect | **Resolved 2026-05-29.** **Split out as [US-0033](../product/user-stories/EP-03-reviewer-surface/US-0033-workspace-artefacts-browser-m2.md)**, mirroring the M1 precedent — `accepted` and `done` lifecycle stays clean per slice, and US-0030 keeps its role as the multi-milestone umbrella. |
| **DoD floor failures — how loud?** SAST or a secret-scan failure on a draft PR — does the orchestrator surface that in the workspace task page, or only in the PR? The principle 4 invariant says these gates **block**; the question is where the architect sees the failure first. | @architect | **Resolved 2026-05-29.** **Surface DoD status in the workspace task page** — a panel showing each gate (test-agent, SAST, secrets, deps, license-SBOM) as green / red / pending, with a link out to the PR check for the failure detail on red. The merge-gate panel (Q5) stays disabled (with a tooltip explaining why) until all DoD gates are green. Keeps the workspace canonical for the task's status — consistent with the workspace-first re-baseline. |
