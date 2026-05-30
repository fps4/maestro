"""The ``ArtifactStore`` Protocol + in-memory backend (M2 #1).

This is the **framework-agnostic core** of the contract in
``docs/architecture/contracts/artifact-store.md`` (M2 #1 slice). It pins the Protocol, the
:class:`ArtifactRef` value type, key/URI shape, validation rules, and the per-product isolation
boundary. The in-memory backend is the only backend M2 #1 ships; the MinIO backend (ADR-0012 / Q4 —
the M2 dogfood) and the presigned-URL share path land in M2 #2.

No other package opens an S3 / MinIO client directly — the same indirection :mod:`model.ModelClient`
enforces for LLM egress (ADR-0002). The event log carries ``storage_uri + sha256`` references
(ADR-0008/0009); this module holds the bytes.
"""
from __future__ import annotations

import hashlib
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol

# Default presigned-URL lifetime (the share path, M2 #3). Short by design — a reviewer follows the
# link promptly; an expired link is re-minted on request rather than a long-lived public URL
# (US-0023 AC #4). 15 minutes mirrors the human-paced gate cadence; callers may pass a shorter TTL.
DEFAULT_PRESIGN_TTL_SECONDS = 900

# --- Validation ------------------------------------------------------------------------------------
#
# Per the contract: product_id is the same shape as the register's product IDs (lowercase alnum +
# dash, 1..64); key is path-like ASCII (no leading slash, no `..`, no backslash, no NUL), 1..1024.
# content_type is RFC 6838-shape `type/subtype`; wildcards rejected.

_PRODUCT_ID_RE   = re.compile(r"^[a-z0-9-]{1,64}$")
_CONTENT_TYPE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$")

_KEY_MAX = 1024


def _validate_product_id(product_id: str) -> None:
    if not isinstance(product_id, str) or not _PRODUCT_ID_RE.match(product_id):
        raise ValueError(
            f"product_id must match [a-z0-9-]{{1,64}}; got {product_id!r}"
        )


def _validate_key(key: str) -> None:
    if not isinstance(key, str) or not key:
        raise ValueError("key must be a non-empty string")
    if len(key) > _KEY_MAX:
        raise ValueError(f"key exceeds {_KEY_MAX} chars (got {len(key)})")
    if key.startswith("/"):
        raise ValueError("key must not start with '/'")
    if "\\" in key or "\x00" in key:
        raise ValueError("key must not contain '\\' or NUL")
    # ``..`` as a path segment — both bare and adjacent to a separator.
    for segment in key.split("/"):
        if segment == "..":
            raise ValueError("key must not contain '..' segments")


def _validate_content_type(content_type: str) -> None:
    if not isinstance(content_type, str) or not _CONTENT_TYPE_RE.match(content_type):
        raise ValueError(
            f"content_type must be a valid RFC 6838 media type (no wildcards); got {content_type!r}"
        )
    # Explicit guards for the most-common bad inputs the regex would already reject — clearer error
    # message for the test fixture / caller.
    if "*" in content_type:
        raise ValueError(f"content_type wildcards are rejected; got {content_type!r}")


# --- Exceptions ------------------------------------------------------------------------------------


class BackendUnavailable(RuntimeError):
    """The backend cannot be reached (MinIO/S3 network failure).

    Defined here for forward-compat; the in-memory backend never raises it. M2 #2 lands it with the
    MinIO backend. HTTP edge translation: ``503``.
    """


class BackendCorrupt(RuntimeError):
    """The backend returned an object whose stored sha256 does not match its body.

    Defined here for forward-compat; the in-memory backend never raises it. HTTP edge translation:
    ``502``.
    """


# --- Value type ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ArtifactRef:
    """The reference an :meth:`ArtifactStore.put` returns.

    The event log carries ``storage_uri + sha256`` and **only those** (ADR-0008/0009 — the log is
    authoritative on references; the store holds bytes). Two refs with the same ``storage_uri`` MUST
    refer to the same object on the same backend.
    """

    product_id:   str
    key:          str
    storage_uri:  str
    sha256:       str
    content_type: str
    size:         int
    stored_at:    datetime


# --- Protocol --------------------------------------------------------------------------------------


class ArtifactStore(Protocol):
    """The single S3-compatible artefact-store egress (ADR-0012).

    Per-product isolation is structural: every operation takes ``product_id`` as a first-class
    argument, so cross-product reads are impossible through the egress.
    """

    def put(
        self,
        product_id:   str,
        key:          str,
        body:         bytes,
        content_type: str,
    ) -> ArtifactRef:
        """Store ``body`` under ``(product_id, key)``; return the canonical :class:`ArtifactRef`.

        Overwrites on a same-`(product_id, key)` re-put (S3 semantics — last write wins). Callers
        needing write-once semantics MUST enforce it above the store.
        """
        ...

    def head(self, product_id: str, key: str) -> ArtifactRef | None:
        """Return the ref for ``(product_id, key)`` or ``None`` if absent."""
        ...

    def exists(self, product_id: str, key: str) -> bool:
        """Convenience equivalent to ``head(...) is not None``."""
        ...

    def delete_product(self, product_id: str) -> int:
        """Remove every object whose ``product_id`` matches; return the count removed.

        Per-product isolation MUST hold: no object belonging to any other product is touched. Used
        for product offboarding; never for individual artefact deletion (the event log references
        them, and ADR-0008 is append-only).
        """
        ...

    def presigned_get(
        self,
        product_id: str,
        key: str,
        *,
        expires_in: int = DEFAULT_PRESIGN_TTL_SECONDS,
    ) -> str:
        """Mint a short-TTL, read-only URL for ``(product_id, key)`` (US-0023 AC #3/#4).

        Each call mints a **fresh** URL valid for ``expires_in`` seconds — there is no caching of a
        long-lived link, so an expired URL is re-minted simply by calling again (AC #4). The URL is
        scoped to the one product object; the key is already product-namespaced, so a presigned URL
        can never address another product's bytes.

        Minting is **blind** — it does not check the object exists (S3's ``generate_presigned_url``
        is a local signing op). The HTTP edge that 302s to this URL is responsible for the
        existence-is-404 check via :meth:`head` first (artifact-store contract §head).
        """
        ...


# --- In-memory backend -----------------------------------------------------------------------------


@dataclass(frozen=True)
class _StoredObject:
    """The in-memory backend's per-object record."""

    body:         bytes
    content_type: str
    sha256:       str
    stored_at:    datetime


class InMemoryArtifactStore:
    """An in-process, ephemeral :class:`ArtifactStore` for tests and any path that needs one.

    Not durable, not shared across processes. Its :meth:`presigned_get` returns a **synthetic**
    (non-fetchable) URL so the HTTP 302 edge is testable offline; the MinIO backend mints real ones.

    Thread-safe: every mutating / reading op holds an internal lock for the duration of the call.
    Lock granularity is "the whole store" — fine through the MVP (single-process orchestrator); a
    backend-per-product or per-bucket lock can come if contention shows up.
    """

    _URI_SCHEME = "memory"

    def __init__(self) -> None:
        # ``(product_id, key) -> _StoredObject``. A single dict means ``delete_product`` is O(n) over
        # the store; fine at any size the in-memory backend will ever see.
        self._objects: dict[tuple[str, str], _StoredObject] = {}
        self._lock = threading.Lock()

    # -- ArtifactStore --

    def put(
        self,
        product_id:   str,
        key:          str,
        body:         bytes,
        content_type: str,
    ) -> ArtifactRef:
        _validate_product_id(product_id)
        _validate_key(key)
        _validate_content_type(content_type)
        if not isinstance(body, (bytes, bytearray, memoryview)):
            raise ValueError(f"body must be bytes-like; got {type(body).__name__}")
        body_bytes = bytes(body)

        digest = hashlib.sha256(body_bytes).hexdigest()
        stored_at = datetime.now(timezone.utc)

        with self._lock:
            self._objects[(product_id, key)] = _StoredObject(
                body=body_bytes,
                content_type=content_type,
                sha256=digest,
                stored_at=stored_at,
            )

        return ArtifactRef(
            product_id=product_id,
            key=key,
            storage_uri=self._uri(product_id, key),
            sha256=digest,
            content_type=content_type,
            size=len(body_bytes),
            stored_at=stored_at,
        )

    def head(self, product_id: str, key: str) -> ArtifactRef | None:
        _validate_product_id(product_id)
        _validate_key(key)
        with self._lock:
            obj = self._objects.get((product_id, key))
        if obj is None:
            return None
        return ArtifactRef(
            product_id=product_id,
            key=key,
            storage_uri=self._uri(product_id, key),
            sha256=obj.sha256,
            content_type=obj.content_type,
            size=len(obj.body),
            stored_at=obj.stored_at,
        )

    def exists(self, product_id: str, key: str) -> bool:
        _validate_product_id(product_id)
        _validate_key(key)
        with self._lock:
            return (product_id, key) in self._objects

    def delete_product(self, product_id: str) -> int:
        _validate_product_id(product_id)
        with self._lock:
            keys = [k for k in self._objects if k[0] == product_id]
            for k in keys:
                # Atomic against concurrent put (we hold the lock); concurrent ``put`` to the same
                # ``(product_id, key)`` mid-delete will simply re-add the object after the delete
                # completes — the semantic is "purge what existed when delete_product was called."
                del self._objects[k]
        return len(keys)

    def presigned_get(
        self,
        product_id: str,
        key: str,
        *,
        expires_in: int = DEFAULT_PRESIGN_TTL_SECONDS,
    ) -> str:
        """A **synthetic** presigned URL for the in-memory backend — there is no real HTTP object
        server, so the URL is not fetchable, but it carries the same shape the edge relies on (a
        product-scoped path plus an ``expires`` deadline) so the HTTP 302 path is testable offline.

        Minting is blind (matches the S3 backend); the edge checks existence via :meth:`head`."""
        _validate_product_id(product_id)
        _validate_key(key)
        if not isinstance(expires_in, int) or expires_in <= 0:
            raise ValueError(f"expires_in must be a positive integer of seconds; got {expires_in!r}")
        deadline = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        return f"{self._uri(product_id, key)}?expires={int(deadline.timestamp())}"

    # -- internal --

    def _uri(self, product_id: str, key: str) -> str:
        # Canonical in-memory URI: backend://<product_id>/<key>. Two refs with the same URI refer
        # to the same in-process object; URIs minted by a different ``InMemoryArtifactStore``
        # instance do NOT collide for resolution purposes (the URI is bound to *this* store
        # instance), but they are textually identical — a deliberate trade-off since the in-memory
        # backend is per-process and never persists.
        return f"{self._URI_SCHEME}://{product_id}/{key}"

    # -- introspection (in-memory only — handy for tests and `repr`) --

    def __len__(self) -> int:
        with self._lock:
            return len(self._objects)

    def __contains__(self, ref: object) -> bool:
        if isinstance(ref, ArtifactRef):
            return self.exists(ref.product_id, ref.key)
        return False
