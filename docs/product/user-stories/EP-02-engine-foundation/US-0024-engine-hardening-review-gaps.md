---
title: "US-0024: Engine hardening — close the review-validated architecture gaps"
persona: architect
status: draft
complexity: XL
milestone: M2
last_updated: 2026-05-30
prd: docs/product/prd/0001-architect-directed-delivery-loop.md
related:
  - docs/architecture/decisions/0002-claude-api-direct-via-modelclient.md
  - docs/architecture/decisions/0003-split-review-routing-matrix.md
  - docs/architecture/decisions/0009-audit-logging-and-observability.md
  - docs/architecture/decisions/0012-artifact-storage-and-sharing.md
  - docs/architecture/decisions/0016-merge-after-workspace-approval.md
  - docs/architecture/decisions/0017-github-app-and-webhook-ingestion.md
  - docs/architecture/decisions/0019-workspace-identity-component-auth-google-sso.md
  - docs/roadmap/m2-build-to-merge.md
---

## Story

As the architect,
I want the architecture/product gaps surfaced by the 2026-05-30 review (and validated against the current docs + code) tracked as one engineering backlog with explicit acceptance criteria and a sequencing tier,
so that the load-bearing M2 risks (audit-chain durability, governance separation, unauthenticated merge, runaway cost) are closed before more real artefacts land, and the longer-tail items have a home instead of living in a loose review note.

## Context

This story supersedes `REVIEW-NOTES-2026-05-30.md`. Every finding below was re-validated in a second pass against the current docs and, where code exists, against `orchestrator/` directly. The validation verdict is recorded per finding. Three findings from the original review were corrected and are folded in here in their corrected form (H1 softened, M8 softened, M10 reframed); one cross-cutting claim (idempotency) was sharpened.

This is an **umbrella story by deliberate choice** — it is closer to a hardening backlog than a single unit of work. The acceptance criteria are grouped by finding ID and tiered (§Sequencing). Sub-items expected to grow their own ADR or story are flagged inline; when they spin out, replace the AC group here with a pointer.

## Acceptance criteria (EARS)

### Tier 1 — M2 entrance / ship-now (small, code-confirmed, or audit-critical)

**H6 — architect self-deal invariant** *(validated: accurate; confirmed in `orchestrator/register.py`, `orchestrator/routing.py` — no such check exists today)*
- WHEN loading the register, IF a product is `product_type: commercial` and a single Participant holds both `architect` and `functional_reviewer` roles on it, THEN THE SYSTEM SHALL refuse to start and SHALL emit a clear error naming the product and participant.
- THE register loader SHALL cover this invariant with a negative test (commercial product, one human in both roles → startup refused).

**H7 — dev-stub + Access belt-and-braces** *(validated: accurate; confirmed in `orchestrator/httpserver.py:resolve_identity` — stub is returned for any caller whenever `MAESTRO_ENV != "production"`, no Access check)*
- WHERE the dev-stub identity path is active, THE SYSTEM SHALL refuse to start unless **both** `MAESTRO_ENV=dev` **and** either a Cloudflare Access JWT or a local-loopback origin is present, enforced as a startup probe (not only a per-request check).
- WHEN the workspace dispatch / gate-decision endpoint is called without an Access JWT (or loopback) while dev-stub is on, THE SYSTEM SHALL respond `401`. An M2 smoke test SHALL assert this.

**H3 — MinIO durability as an M2 entrance criterion** *(validated: accurate)*
- THE SYSTEM SHALL run the default ds1 MinIO backend with erasure coding and a restorable offsite backup **before** further real artefacts land.
- THE durability story SHALL be proven by a recovery test: destroy the MinIO data volume, restore from backup, and confirm a sampled artefact's recorded `sha256` still resolves to its referenced bytes.

**H2 (loop/kill slice) — bounds and a kill switch** *(validated: accurate; cost is recorded, nothing is enforced)*
- WHEN a refinement loop (`request_changes → re-draft → …`) reaches a configurable max-iteration count (default ~5), THE SYSTEM SHALL stop and move the task to `blocked` rather than continue.
- THE orchestrator SHALL expose a single "drain mode" toggle the architect can flip from the workspace that stops new agent work instance-wide.
- *(The cost-cap half of H2 is Tier 2 — see below — and may spin out into its own ADR.)*

### Tier 2 — M2/M3 quality & audit hardening

**H1 — independent intent check is weak through M2** *(validated: partially accurate — corrected)*
- *Correction:* the builder and test agents are distinct, strictly-sequential agents (`orchestrator.md`); the docs are **silent** on whether they share a model/prompt. The fix introduces independence the docs don't currently preclude — it does not undo a documented coupling.
- WHERE the agent config defines the `builder` and `test` roles, THE SYSTEM SHALL permit — and default to — a different model variant for the test agent than the builder, recorded in agent config.
- UNTIL US-0015 (independent reviewer agent) lands, THE M2 exit criteria and the workspace merge affordance SHALL state that no independent reviewer agent exists yet.

**H2 (cost-cap slice) — budget ceilings** *(see H2 above; candidate to extend ADR-0002 or a new ADR)*
- WHEN a call would exceed a configured `per_run_usd_cap` or `per_day_usd_cap`, THE `ModelClient` SHALL hard-refuse the call.
- THE SYSTEM SHALL cap tool calls per agent per run at a configurable limit and SHALL raise a circuit breaker on a >Nσ token-rate anomaly per task.

**M7 — prompt versioning in the audit log** *(validated: accurate; `llm_call` records cost/tokens/cache but not prompt provenance)*
- WHEN recording an `llm_call` audit record, THE SYSTEM SHALL include `prompt_template_id` and `prompt_template_version` (the git SHA of the prompt file).
- Agent prompts SHALL be version-controlled under `standards/` or `agents/` so the version is deterministically sourceable for replay.

**M9 — redaction stance for the M2 corpus** *(validated: accurate; redaction is an AC, tooling is deferred to M3)*
- THE SYSTEM SHALL either apply a minimal regex redaction (secrets + email pattern) before persisting M2 artefacts, **or** the M2 doc SHALL state explicitly that the M2 audit corpus is unredacted and secrets must not be pasted into intent.

**M8 — surface the unindexed set** *(validated: partially accurate — corrected)*
- *Correction:* the read API already carries `unindexed[]` + `reason` (`workspace-read-api.md`); the gap is that **no UI banner is required**, not that the UI hides it.
- THE workspace SHALL display a persistent banner or dedicated panel listing any `unindexed` specs (with the `reason`) on every load, so a duplicate `(feature, kind)` or malformed `maestro:` block is visible to the single human author.

**Cross-cutting (idempotency) — name the dedup contract end-to-end** *(validated: partially accurate — corrected/sharpened)*
- *Correction:* only two of the three idempotency layers are contracted today — the workspace `Idempotency-Key` table (`workspace-write-api.md`) and the LangGraph checkpointer (ADR-0014). **Webhook redelivery dedup (e.g. on `X-GitHub-Delivery`) is not documented** in ADR-0017.
- ADR-0017 SHALL specify a webhook redelivery dedup strategy.
- One engineering note SHALL name the end-to-end event ordering + dedup contract across all three layers.

**Cross-cutting (negative tests) — single-layer boundaries** *(validated: accurate)*
- THE single-layer security boundaries (ADR-0016 merge, ADR-0017 webhook receiver, ADR-0019 auth) SHALL each carry explicit negative/abuse tests asserting the boundary rejects forged/unauthorized input — the tests must exist, not just the boundaries.

### Tier 3 — bookkeeping & doc reconciliation (cheap, do during the next ADR/scoping sweep)

**M10 — resolve US-0017's status** *(validated: INACCURATE as originally framed — corrected)*
- *Correction:* US-0017 does **not** encode chat as the decision surface; it explicitly defers surface routing to US-0012, which states gates are decided in the workspace and Slack/Telegram are notification-only. There is no contract contradiction. The only residue is that US-0017 is still `status: draft` and unmilestoned.
- US-0017 SHALL be moved out of `draft` — either rewritten as "decide a gate from a notification deep-link (workspace)" or closed with a pointer to US-0030 / US-0032.

**Cross-cutting (ADR status) — proposed → accepted sweep** *(validated: accurate — 0011, 0017, 0018, 0019, 0021, 0023 are all `proposed`; 0011 is foundational to 0015/0017/0019)*
- THE load-bearing ADRs (0011, 0017, 0018, 0019, 0021, 0023) SHALL be moved to `accepted`, or the bits later ADRs contradict SHALL be rewritten. ADR-0011 is sequenced first.

**Cross-cutting (roadmap honesty)** *(validated: accurate)*
- THE roadmap SHALL state plainly that the "product = many repos + many participants" differentiator is single-repo/single-architect through ≥M3, so dogfood expectations are calibrated.

**M3 — name the reviewer model-separation gap** *(validated: accurate; pairs with H1)*
- THE docs SHALL state that reviewer ≠ author (ADR-0004) buys independence of process, not of judgement; H1's model-variant assignment, if it lands, improves this for free.

### Tier 4 — deferred-by-design (define the flow or write the explicit placeholder; later milestones)

**H4 — triage/queueing UX** *(validated: accurate; inbox S6 is M3, no gate-age/batch/snooze UX in M2)*
- THE SYSTEM SHALL either pull a degraded "open-gates list" with prominent `gate_open_age` into M2, decide what `on_timeout: escalate` means while no second human exists, **or** the roadmap SHALL state the adopted scale is `~1 product, ≤3 in-flight tasks` until M3.

**H5 — post-merge revert flow** *(validated: accurate; no revert task kind defined anywhere)*
- THE SYSTEM SHALL define an explicit `revert_task` kind (workspace affordance → `maestro/revert-*` branch → single-gate flow → `revert.requested`/`revert.executed` events linked to the original `merge.executed`), **or** the roadmap SHALL carry an explicit "manual until M5" placeholder.

**M1 — irreconcilable-bundle action** *(validated: accurate; trichotomy has no conflict action)*
- THE `agent_response` event SHALL gain a fourth action `escalate_to_reviewer` with a required `conflict_note`, **or** the workspace SHALL warn at bundle-creation when anchored comments materially conflict.

**M2 — recovery from `blocked`** *(validated: accurate; `reject` is terminal, only response is "notify in Slack")*
- THE SYSTEM SHALL define `task.resumed` from `blocked` as an attributed event, **or** the docs SHALL state explicitly that `blocked` is terminal and the architect re-files from scratch.

**M4 — docs-agent ↔ knowledge-agent dependency** *(validated: accurate; docs agent is M3, knowledge agent is M4)*
- WHEN the M3 scoping doc opens, it SHALL record the docs-agent dependency on the knowledge index and decide whether to land a minimal index in M3 or accept a heuristic.

**M5 — bootstrap DoD CI on a new product** *(validated: accurate; onboarding is manual, no automation story)*
- THE onboarding flow SHALL lay down `.github/workflows/dod.yml` (+ Renovate/scanner config) as a template, tracked as a story under EP-00 or EP-02.

**M6 — pin the hallucinated-dependency tool** *(validated: accurate; named as a DoD floor, no tool named)*
- THE hallucinated-dependency floor SHALL name a concrete tool (or ship one: parse manifests, hit the registry index, fuzzy-match against the top-1k popular packages for typosquat).

## Out of scope

- The independent reviewer agent itself (US-0015, M3) — Tier 1/2 only adds an interim flag and model-variant hook around its absence.
- The S6 inbox build (US-003x) — H4 here is the degraded interim or an explicit scope statement.
- Concrete tool/library selection beyond what each AC pins (redaction lib, metrics backend) where ADR-0009 already defers it.

## Notes

**Provenance.** Findings carried IDs H1–H7 / M1–M10 / cross-cutting in `REVIEW-NOTES-2026-05-30.md`. Validation outcome: 14 of 17 accurate as written; H1 and M8 partially accurate (softened above); M10 inaccurate as framed (reframed to a bookkeeping item); the idempotency cross-cutting claim sharpened (webhook dedup is the genuinely missing layer). H6 and H7 were strengthened by code inspection — both gaps are present in `orchestrator/` today, not merely in the docs.

## Sequencing

1. **Tier 1** — H6, H7 (one-file code changes + negative tests), H3 (operational, days), H2 loop-bound + drain toggle. These gate "more real artefacts on MinIO" and "unauthenticated merge."
2. **Tier 2** — H1 model-variant + exit-criteria flag, H2 cost caps (likely its own ADR), M7 prompt versioning, M9 redaction stance, M8 unindexed banner, idempotency note + webhook dedup, negative-test sweep.
3. **Tier 3** — M10 / ADR status sweep / roadmap honesty / M3 naming — bundle into the next doc-maintenance PR.
4. **Tier 4** — H4, H5, M1, M2, M4, M5, M6 — define-or-placeholder at the milestone each belongs to.

## Implementation status

- **Tier 1 — shipped** (PR #50, merged): H6 register self-deal invariant, H7 dev-stub + Access belt-and-braces, H2 refinement-loop cap + drain switch. H3 (MinIO durability) remains an ops task on ds1.
- **Tier 2 (audit/egress slice) — shipped** (this PR): H2 `ModelClient` budget caps (per-run / per-day, env-config, hard-refuse) + ADR-0002 extension; M7 prompt provenance (`prompt_template_id` + git-blob-SHA `prompt_template_version`) on every `llm_call` + schema migration; M9 minimal secret/email redaction floor applied to persisted error text + the M2 corpus stance.
- **Tier 2 (remaining), documented** — H1 model-variant + the M2 "no independent reviewer yet" exit-criteria flag (US-0015 AC + m2-build-to-merge.md); M8 unindexed-banner UI requirement (ADR-0018 consequence — frontend deferred); idempotency engineering note ([`idempotency-and-ordering.md`](../../../architecture/idempotency-and-ordering.md)) + ADR-0017 `X-GitHub-Delivery` webhook dedup. The negative-test sweep for the single-layer boundaries remains an open testing task (the Tier-1 boundaries already carry their negative tests).
- **Tier 3 — shipped (docs):** all six `proposed` ADRs (0011/0017/0018/0019/0021/0023) flipped to `accepted`; M10 — US-0017 reframed to notification + deep-link (a real contradiction after all: its prior AC put approve/reject controls in-group, against ADR-0015/US-0012); roadmap honesty paragraphs (adopted-scale envelope + differentiator-is-vapourware-until-M4); M3 reviewer-independence note (process not judgement) in US-0015.
- **Tier 4 — shipped (doc decisions + placeholders):** H4 adopted-scale constraint + M4 docs/knowledge-agent dependency (roadmap risks); M1 `escalate_to_reviewer` action decision (ADR-0022); M2 `task.resumed`-from-blocked recovery AC (US-0020); new draft stories — H5 revert flow ([US-0018](../EP-01-delivery-loop/US-0018-revert-a-merged-pr.md)), M5 DoD-CI bootstrap ([US-0002](../EP-00-platform-scaffold/US-0002-bootstrap-dod-ci-on-a-product.md)), M6 hallucinated-dependency check ([US-0025](US-0025-hallucinated-dependency-check.md)).
- **Remaining code (deferred, step-by-step):** M8 frontend banner, H1 model-variant config in the prompt files, the negative-test sweep, and every Tier-4 feature's implementation at its milestone. No further feature code is in scope until each is picked up individually.
