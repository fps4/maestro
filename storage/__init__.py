"""The single S3-compatible ``ArtifactStore`` egress (ADR-0012).

All artefact bytes (specs, designs, PR-diff snapshots, test reports, SBOMs) reach storage **only**
through the :class:`ArtifactStore` Protocol exported here — the same indirection
:mod:`model.ModelClient` enforces for LLM egress (ADR-0002). The event log carries
``storage_uri + sha256`` references (ADR-0008/0009); the store holds the bytes.

The contract is pinned in ``docs/architecture/contracts/artifact-store.md``.

M2 #1 ships the Protocol, the :class:`ArtifactRef` value type, and the in-memory backend used by
tests and any ephemeral path. The MinIO backend (the M2 dogfood default, Q4) and the presigned-URL
share path land in M2 #2.
"""

from storage.artifactstore import (
    ArtifactRef,
    ArtifactStore,
    BackendCorrupt,
    BackendUnavailable,
    InMemoryArtifactStore,
)

__all__ = [
    "ArtifactRef",
    "ArtifactStore",
    "BackendCorrupt",
    "BackendUnavailable",
    "InMemoryArtifactStore",
]
