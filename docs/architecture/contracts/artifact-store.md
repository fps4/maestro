---
title: "Contract: the ArtifactStore egress"
status: current
last_updated: 2026-05-30
owners: [architect]
maestro:
  feature: artifact-store
  kind: technical_design
  task: US-0023
related:
  - docs/architecture/decisions/0012-artifact-storage-and-sharing.md
  - docs/architecture/decisions/0010-public-engine-private-instance-data.md
  - docs/architecture/decisions/0011-multi-surface-human-control.md
  - docs/architecture/decisions/0008-system-of-record-and-persistence.md
  - docs/architecture/data-model.md
  - docs/product/user-stories/EP-02-engine-foundation/US-0023-artifact-store-and-sharing.md
  - docs/product/user-stories/EP-03-reviewer-surface/US-0033-workspace-artefacts-browser-m2.md
  - docs/roadmap/m2-build-to-merge.md
---

## Purpose

The internal contract for the **single S3-compatible `ArtifactStore`** that owns all artefact bytes
(specs, designs, PR-diff snapshots, test reports, SBOMs). This is the contract
[ADR-0012](../decisions/0012-artifact-storage-and-sharing.md) decided in principle; this doc pins the
Python interface, key/URI shape, per-product isolation rule, configuration resolution, and the
backend-selection contract so the build slices have a fixed target.

It is a **reference** doc (Diátaxis). It defines *the interface*, not the implementation.

Egress reaches the store **only** through the `storage.ArtifactStore` Protocol; no other package
opens an S3 / MinIO client directly — the same indirection `model.ModelClient` enforces for LLM
egress (ADR-0002).

## Scope

| In (M2 #1 + M2 #2 — store half complete, this doc as it lands)           | Out (later slices, extend additively)                                       |
|---|---|
| The `ArtifactStore` Python Protocol (`put`, `head`, `exists`, `delete_product`) | Presigned-URL share path (`presigned_get`) — **M2 #3** with the share half |
| The `ArtifactRef` value type and its canonical `storage_uri` shape       | HTTP read endpoint (`GET /api/products/{p}/artifacts/{key}` → 302 to presigned URL) — **M2 #3** |
| The **in-memory** backend (test fixture + smoke runs) — **M2 #1**        | AWS S3 backend — **M4 commercial onboarding** (same code path, different `endpoint_url`) |
| The **MinIO** backend (the M2 dogfood per Q4) — **M2 #2**                | The `artifact.stored` event wiring — **M2 #3+**, where the spec/design agent first emits an artefact |
| `ArtifactStoreConfig` loader + `make_store` factory — **M2 #2**          | Per-product backend override — **M4** (the first commercial product opting into S3) |
| Per-product isolation (key namespacing + `delete_product` confinement)   | Backup / replication / retention tooling (operational, ADR-0012)            |
| Key/URI validation and overwrite semantics                               |                                                                              |

Per-call cost is computed by the backend; the contract carries `size` and `sha256` only — no cost
model.

## The `ArtifactRef` value type

The reference an `ArtifactStore.put` returns. The event log carries `storage_uri + sha256` and
**only those** (ADR-0008/0009 — the log is authoritative on references; the store holds bytes).

```python
@dataclass(frozen=True)
class ArtifactRef:
    product_id:   str        # the product whose bucket/prefix holds this object
    key:          str        # the per-product object key (path-like; ASCII; no leading slash)
    storage_uri:  str        # canonical, backend-tagged: e.g. "memory://", "s3://...", "minio://..."
    sha256:       str        # hex; lowercase; 64 chars
    content_type: str        # an IANA media type (validated; rejects empty / wildcard)
    size:         int        # bytes; >= 0
    stored_at:    datetime   # UTC, set by the backend at put time
```

`storage_uri` is the **canonical** identifier. Two refs with the same `storage_uri` MUST refer to the
same object on the same backend; two refs with the same `(product_id, key)` on different backends
MUST have distinguishable `storage_uri` values.

## The `ArtifactStore` Protocol

```python
class ArtifactStore(Protocol):
    def put(
        self,
        product_id:   str,
        key:          str,
        body:         bytes,
        content_type: str,
    ) -> ArtifactRef: ...

    def head(self, product_id: str, key: str) -> ArtifactRef | None: ...

    def exists(self, product_id: str, key: str) -> bool: ...

    def delete_product(self, product_id: str) -> int: ...
```

### `put`

- WHEN called with valid args, THE STORE SHALL store `body` under the product's namespace, compute
  `sha256` (hex, lowercase), set `size = len(body)`, set `stored_at` to UTC now, and return an
  `ArtifactRef` carrying all of those plus the canonical `storage_uri`.
- WHEN called with the same `(product_id, key)` as a prior `put` (same product, same key), THE STORE
  SHALL overwrite the prior object (S3 semantics — last write wins). The returned ref reflects the
  new bytes and a new `stored_at`. Callers that need write-once semantics must enforce it above the
  store (key derivation from `sha256`, or an idempotency check via `head` first).
- THE STORE SHALL reject (`ValueError`) any `key` containing `..` segments, a leading `/`, a NUL
  byte, or a backslash; or any `key` longer than 1024 chars; or an empty `key`.
- THE STORE SHALL reject (`ValueError`) any `product_id` that is empty, that contains
  any char outside `[a-z0-9-]`, or that exceeds 64 chars (the same shape as the register's product
  IDs).
- THE STORE SHALL reject (`ValueError`) an empty / wildcard / structurally invalid `content_type`
  (must be `type/subtype` per RFC 6838 shape; `*/*` and `*` are rejected).

### `head`

- WHEN the object exists, THE STORE SHALL return its `ArtifactRef` (same shape `put` returned),
  reading the canonical metadata (sha256, size, content_type, stored_at) from the backend — never a
  cached value from memory unless the backend itself is in-memory.
- WHEN the object does not exist, THE STORE SHALL return `None`. **Existence-is-404 carries through
  to the HTTP edge later** (US-0033 acceptance criteria; ADR-0010/0011), but at this layer the
  contract simply distinguishes "absent" from "present."

### `exists`

A convenience equivalent to `head(...) is not None`. Backends MAY implement it more cheaply (e.g.
S3 `HeadObject` returns metadata anyway, so the in-memory backend's `exists` is just `head` is-not-`None`).

### `delete_product`

- WHEN called, THE STORE SHALL remove **every** object whose `product_id` matches and **no** object
  belonging to any other product (per-product isolation — ADR-0010/0011). Returns the count
  removed. Used for product offboarding; never for individual artefact deletion (the event log
  references them, and ADR-0008 is append-only).
- THE STORE SHALL fail closed: if any single delete fails, the operation raises and the count is the
  number that completed before the failure — there is no "partial success" return value that hides
  failures.

## Per-product isolation

Per-product isolation is enforced at **two layers**, both load-bearing:

1. **Key namespacing.** Every backend MUST namespace objects under the product — e.g. `bucket/<product_id>/<key>` (MinIO/S3) or `(product_id, key)` tuples (in-memory). The store API takes `product_id` as a first-class argument so cross-product reads are *structurally impossible* through the egress (you cannot ask for product B's key while passing product A's id).
2. **`delete_product` is confined.** The per-product purge MUST act only within the product's
   namespace. A `delete_product("A")` SHALL NOT touch a key under product B.

The HTTP edge in later slices adds a third layer (the caller's identity is checked against
participation in `product_id` before any store call) — the store does not itself enforce the
identity boundary, but it makes per-product isolation a property of *every* call by design.

## Backend selection

Per ADR-0012:

| Backend       | When                                                        | Notes                                                                 |
|---|---|---|
| **in-memory** | tests, and any code path that needs an ephemeral store      | M2 #1; not durable, not shared, no presigned URLs. URI: `memory://<product_id>/<key>` |
| **MinIO**     | the instance default — maestro itself runs on this (Q4)     | M2 #2 (shipped via `boto3` against `endpoint_url`); URI: `minio://<bucket>/<product_id>/<key>` — **endpoint is *not* in the URI** so moving the MinIO host doesn't invalidate event-log references |
| **AWS S3**    | a product's per-product opt-in (commercial products at M4)  | shares the same Protocol — backend is configuration, not code; URI: `s3://<bucket>/<product_id>/<key>` |

Backend selection is a **per-instance default + per-product override**, the same shape `deploy_target` uses (ADR-0007). The resolver lives next to the store and is exercised by config tests; the egress is backend-agnostic.

`storage.make_store(config)` is the factory; `storage.load_artifact_store_config(d)` parses an `artifact_store:` block. Per-product override lands at M4 with the first commercial product.

## Configuration

The store reads its config at construction time; no env reads in hot paths. Schema (resolved at M2 #2; pinned here forward-compat):

```yaml
artifact_store:
  backend: in-memory | minio | s3      # default in-memory (tests), minio (the M2 dogfood)
  # backend-specific blocks only when backend is set to that backend:
  minio:
    endpoint:        <host:port>       # ds1 internal address
    bucket:          <bucket>
    access_key_env:  <env var name>    # secrets via env, never inline (ADR-0011 / ADR-0012)
    secret_key_env:  <env var name>
    region:          <region>          # MinIO accepts a synthetic region
  s3:
    bucket:          <bucket>
    region:          <region>
    access_key_env:  <env var name>
    secret_key_env:  <env var name>
```

Per-product overrides live on the product register (`config/products.yaml`) under
`artifact_store: { backend: ..., ... }`, validated against the same schema — same shape as
`deploy_target`.

## Error model

The store raises Python exceptions; HTTP envelope translation belongs in the edge (later slices).

| Exception              | Raised when                                                                | HTTP later   |
|---|---|---|
| `ValueError`           | invalid `product_id`, `key`, `content_type` (validation per `put` rules)   | `422`        |
| `BackendUnavailable`   | the backend cannot be reached (S3 / MinIO network failure)                 | `503`        |
| `BackendCorrupt`       | the backend returns an object whose stored sha256 does not match its body  | `502`        |

`BackendUnavailable` and `BackendCorrupt` are defined here for forward-compat; the in-memory backend
never raises them. They land with the MinIO backend (M2 #2).

## Threading

In-process stores SHALL be safe for concurrent `put` / `head` / `exists` calls. The in-memory
backend protects its dict with a lock; remote backends inherit thread safety from their HTTP client.
Single-instance assumptions are fine through the MVP; cross-instance cache coherence is not in scope.

## What this contract does NOT pin

- The HTTP shape — that comes in the workspace artefacts contract slice (M2 #2/#3, consumed by [US-0033](../../product/user-stories/EP-03-reviewer-surface/US-0033-workspace-artefacts-browser-m2.md)).
- The `artifact.stored` event payload — that comes when the first emitter (the spec / design agent) starts using the store (M2 #2). The shape will name `storage_uri` + `sha256` + `kind` + `task_id` (per `data-model.md`'s Artifact entity).
- Presigned-URL TTL defaults — landed with the share path.
- Backup / replication tooling (operational; ADR-0012 leaves this to the runbook).
