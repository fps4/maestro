"""The single S3-compatible ``ArtifactStore`` egress (ADR-0012).

All artefact bytes (specs, designs, PR-diff snapshots, test reports, SBOMs) reach storage **only**
through the :class:`ArtifactStore` Protocol exported here — the same indirection
:mod:`model.ModelClient` enforces for LLM egress (ADR-0002). The event log carries
``storage_uri + sha256`` references (ADR-0008/0009); the store holds the bytes.

The contract is pinned in ``docs/architecture/contracts/artifact-store.md``.

M2 #1 ships the Protocol, the :class:`ArtifactRef` value type, and the in-memory backend used by
tests and any ephemeral path. M2 #2 adds the MinIO backend (the M2 dogfood default, Q4) + the config
loader. M2 #3 adds the **presigned-URL share path** (``presigned_get``) on both backends — the
short-TTL, per-product read link the workspace artefacts browser (US-0033) resolves to.
"""

from storage.artifactstore import (
    DEFAULT_PRESIGN_TTL_SECONDS,
    ArtifactRef,
    ArtifactStore,
    BackendCorrupt,
    BackendUnavailable,
    InMemoryArtifactStore,
)
from storage.config import (
    ArtifactStoreConfig,
    Backend,
    ConfigError,
    MinIOConfig,
    load_artifact_store_config,
    make_store,
)
from storage.minio import MinIOArtifactStore

__all__ = [
    "DEFAULT_PRESIGN_TTL_SECONDS",
    "ArtifactRef",
    "ArtifactStore",
    "ArtifactStoreConfig",
    "Backend",
    "BackendCorrupt",
    "BackendUnavailable",
    "ConfigError",
    "InMemoryArtifactStore",
    "MinIOArtifactStore",
    "MinIOConfig",
    "load_artifact_store_config",
    "make_store",
]
