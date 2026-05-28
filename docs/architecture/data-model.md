---
title: maestro data model
status: draft
last_updated: 2026-05-28
owners: [architect]
related:
  - docs/architecture/overview.md
  - docs/architecture/decisions/0005-product-domain-model.md
  - docs/architecture/decisions/0008-system-of-record-and-persistence.md
  - docs/architecture/decisions/0009-audit-logging-and-observability.md
  - docs/architecture/decisions/0011-multi-surface-human-control.md
  - docs/architecture/decisions/0012-artifact-storage-and-sharing.md
  - docs/architecture/decisions/0015-reviewer-surfaces-repo-wiki-and-chat-webapp.md
  - docs/architecture/decisions/0016-merge-after-workspace-approval.md
  - docs/architecture/decisions/0019-workspace-identity-component-auth-google-sso.md
  - docs/architecture/decisions/0020-feedback-bundle-payload-shape.md
  - docs/architecture/decisions/0021-plain-language-summary-on-artefacts.md
  - docs/architecture/decisions/0022-agent-response-event.md
  - docs/architecture/contracts/workspace-write-api.md
  - docs/product/prd/0001-architect-directed-delivery-loop.md
---

## Purpose

The core entities maestro reasons about, per [ADR-0005](decisions/0005-product-domain-model.md). This is a conceptual model — *where* state lives (a maestro-owned store, GitHub Issues/Projects + PR state, or a hybrid) is an open PRD-0001 decision and is deliberately not fixed here.

## Entities

| Entity | Description | Key fields |
|--------|-------------|-----------|
| **Product** | The unit of work. Holds the charter, one `product_type`, and visibility. | `id`, `name`, `product_type` (commercial \| technical), `visibility` (private \| public), `deploy_target`, `functional_channel` (surface + bot ref + group; ADR-0011) |
| **Repository** | A GitHub repo. Linked to products many-to-many. | `id`, `full_name`, `default_branch` |
| **Participant** | A human. Linked to products via a role. | `id`, `handle`, `name`, `email` (workspace identity via `component-auth` + Google SSO — ADR-0019; primary identity for authz + attribution), `slack_user_id`, `telegram_user_id` (notification-surface identity — ADR-0011) |
| **ProductRepo** | Join: which repos a product owns (a repo may serve >1 product). | `product_id`, `repo_id` |
| **Membership** | Join: a participant's role in a product. | `product_id`, `participant_id`, `role` (architect \| functional_reviewer \| stakeholder \| …) |
| **Feature** | One functional spec + technical design. May produce changes across several repos. | `id`, `product_id`, `spec`, `design`, `state` |
| **Requirement** | One acceptance criterion (EARS) within a Feature's functional spec. | `id`, `feature_id`, `text` |
| **DeliveryTask** | One unit of implementation work; **targets** a repo (owned by the Feature, not the repo). | `id`, `feature_id`, `target_repo_id`, `stage`, `status`, `branch`, `pr_url` |
| **PullRequest** | The GitHub PR. Mirrors GitHub state; the merge *decision* stays human, and maestro executes the merge against the recorded approval (ADR-0016). | `task_id`, `repo_id`, `pr_number`, `state`, `merged` |
| **Gate** | A pending or resolved human decision, **decided in the workspace** (ADR-0015 / ADR-0016). Routing to a role+product audience per US-0012; notifications on Slack/Telegram per EP-04 (M3). | `id`, `task_id`, `type` (functional \| technical \| merge), `reviewer_role`, `status`, `feedback_bundle_id?`, `seq` (monotonic projection counter for `If-Match` optimistic concurrency — workspace-write-api), `resolved_by` (the deciding participant), `resolved_at` |
| **Comment** | A human's anchored remark on a task or gate's artefact (workspace S2 — US-0032). Anchored where possible (a spec criterion id, a design heading) per [`workspace-ux-design.md`](workspace-ux-design.md) P4; unanchored as fallback. Append-only — events are immutable (ADR-0008). | `id`, `task_id`, `author_participant_id`, `anchor?` (`{artefact: {kind, ref}, locator}`), `body`, `in_reply_to?`, `created_at` |
| **FeedbackBundle** | Server-side projection at `request_changes` time (ADR-0020): the open anchored comments + the decider's rationale, snapshotted so the agent's input is replay-correct. **Snapshot, not editable** — supersession is by a new bundle on the next cycle. | `id`, `task_id`, `gate_id`, `artefact` (`{kind, ref}`), `rationale` (the decider's text + provenance for unanchored comments), `items[]` (`{anchor, comments[], suggested_change?}`), `attributed_to` (the decider), `decided_at` |
| **AgentResponse** | Close-of-cycle event the spec/design agent emits after re-drafting in response to a `FeedbackBundle` (ADR-0022). **1:1 with bundle**; every item gets a reply (trichotomy: addressed \| deferred \| rejected). | `id`, `bundle_id`, `task_id`, `agent` (spec \| design), `artefact.ref` (the **new** commit), `summary_of_changes` (≤ 120 words), `addresses[]` (`{comment_id, action, note, ref_section?}`), `emitted_at`, `attributed_to` (`{agent, run_id, model}`) |
| **Trace** | First-class link: requirement → task → PR/commit. | `requirement_id`, `task_id`, `pr_id` |
| **Event** | An append-only record of a state change or agent/human action — the operational **source of truth**; current state is a projection of these (ADR-0008/0009). | `id`, `run_id`, `seq`, `timestamp`, `actor`, `type`, `target`, `payload`, `prev_hash` |
| **LLMCall** | One `ModelClient` call — the LLM-call audit record (OTel GenAI; ADR-0009). | `id`, `run_id`, `agent`, `model`, `input_tokens`, `output_tokens`, `cache_read`, `cache_write`, `cost`, `latency_ms` |
| **Artifact** | A stored work product (spec/design export, diff snapshot, test report, SBOM). Bytes live in the `ArtifactStore`; the event log holds the reference (ADR-0012). | `id`, `product_id`, `task_id?`, `kind`, `storage_uri`, `sha256`, `created_at` |

## Relationships

```mermaid
flowchart LR
  P["Product"] --- PR1["ProductRepo (M:N)"] --- R["Repository"]
  P --- M["Membership (role, M:N)"] --- PA["Participant"]
  P -->|has many| F["Feature"]
  F -->|has many| REQ["Requirement (EARS)"]
  F -->|has many| DT["DeliveryTask"]
  DT -->|targets| R
  DT -->|has one| PRq["PullRequest"]
  DT -->|has many| GA["Gate"]
  DT -->|has many| C["Comment"]
  GA -->|on request_changes| FB["FeedbackBundle"]
  FB -->|includes| C
  FB -->|1:1| AR["AgentResponse"]
  REQ -. "Trace" .-> DT -. "Trace" .-> PRq
```

## State — DeliveryTask.stage

| Stage | Meaning | Advances on |
|-------|---------|-------------|
| `intake` | Created from a workspace **"new task"** dispatch (US-0010, M1) — `maestro` CLI seed is the equivalent ops back-door, same event | functional spec produced |
| `functional_gate` | Spec awaiting functional review | reviewer approves |
| `design` | Producing technical design + tasks | design produced |
| `technical_gate` | Design awaiting architect review | architect approves |
| `build` | Implementing on a `maestro/*` branch | DoD gates green, PR opened |
| `merge_gate` | PR awaiting technical review of the diff | architect approves; maestro merges (ADR-0016) |
| `done` | Merge observed | terminal |
| `blocked` | Request-changes or rejection at any gate | returns to the relevant stage |

`status` (e.g. `active`, `blocked`, `cancelled`, `done`) is orthogonal to `stage`.

## Persistence (where each entity lives)

Per [ADR-0008](decisions/0008-system-of-record-and-persistence.md) and [ADR-0009](decisions/0009-audit-logging-and-observability.md):

| Group | Home | Authority |
|-------|------|-----------|
| Product, Repository, Participant, ProductRepo, Membership | **git-tracked config** (`config/products.yaml`), loaded into the store read-only at boot | the register; changing it is a reviewed PR |
| Feature, Requirement, DeliveryTask, Gate, Comment, FeedbackBundle, AgentResponse, Trace | **maestro-owned, event-sourced store** — current state is a projection of the `Event` log | maestro |
| PullRequest, branches, commits, CI checks | **GitHub**, mirrored into the store read-only via webhooks | GitHub |
| Event, LLMCall | append-only **audit tier** (immutable; WORM + hash-chained) | maestro |
| Artifact (bytes) | **S3-compatible object store** — MinIO on ds1 by default, AWS S3 per-product opt-in (ADR-0012); per-product bucket/prefix | the store holds bytes; the event log holds the reference |

A single `run_id` (correlation ID) threads `Event`, `LLMCall`, and operational logs for a delivery task, so any run is reconstructible end to end.

## Known limitations

- v1 realises one `DeliveryTask → one target repo`; a Feature producing coordinated PRs across multiple repos is modelled but built later (ADR-0005).
- Gate routing resolves `(product, gate) → role → audience` from `config/reviewers.yaml` + the register at gate-creation time; any role-holder in that audience may decide in the workspace (ADR-0015 / ADR-0016), quorum 1 (ADR-0011, US-0017 lifts quorum > 1 post-M1). If config or roster changes mid-task, in-flight gates keep their already-resolved audience.
- A `Gate.seq` advances monotonically per gate and is the workspace's `If-Match` precondition on a decision (workspace-write-api §optimistic-concurrency). M1 assumes a single deciding role-holder per gate; multi-role-holder races land with US-0017.
- A `FeedbackBundle` is a snapshot at decision time; it is immutable. The agent's `AgentResponse` is 1:1 with a bundle. Comments marked `addressed` or `deferred` are closed for re-bundling; `rejected` comments stay open (ADR-0020 §composition-rule + ADR-0022).
- If maestro syncs to GitHub, prefer issue-fields/sub-issues (which travel with the issue) over GitHub Project custom fields (which do not) — the maestro store is authoritative.
