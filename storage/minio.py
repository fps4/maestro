"""The MinIO / S3-compatible backend for :mod:`storage.artifactstore` (M2 #2).

Talks S3 via :mod:`boto3`, with ``endpoint_url`` pointing at MinIO. The same module also serves the
AWS S3 backend (M4 commercial onboarding) — same wire, different ``endpoint_url`` / credentials —
so this code is the **shared** S3-API client for the egress.

Per ADR-0012:
  * MinIO on ds1 is the instance default (the M2 dogfood — Q4 binding decision).
  * A product may opt into AWS S3 at M4 — config, not code.
  * The store is reached **only** through the :class:`storage.ArtifactStore` Protocol (the same
    indirection :mod:`model.ModelClient` enforces for LLM egress, ADR-0002).

The contract is pinned in ``docs/architecture/contracts/artifact-store.md``. This module honours
that contract; it does not re-state it.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from storage.artifactstore import (
    DEFAULT_PRESIGN_TTL_SECONDS,
    ArtifactRef,
    BackendCorrupt,
    BackendUnavailable,
    _validate_content_type,
    _validate_key,
    _validate_product_id,
)

# The S3 user-metadata header that carries our content-addressed digest. boto3 normalises the
# ``x-amz-meta-`` prefix on writes (``Metadata={'sha256': ...}``) and strips it on reads
# (``response['Metadata']['sha256']``). The digest is stored as user metadata, not computed on
# read, so an out-of-band overwrite (someone uploading bytes via mc / aws-cli) is detectable: the
# stored metadata won't match the live bytes if anyone reads + re-hashes. M2 #1 named
# :class:`BackendCorrupt` for this.
_SHA256_META = "sha256"


# --- backend ---------------------------------------------------------------------------------------


class MinIOArtifactStore:
    """An S3-API artefact store backed by MinIO (or AWS S3, same code path).

    Per-product isolation is structural: object keys are namespaced as ``<product_id>/<key>`` inside
    the configured bucket; ``delete_product`` lists + deletes only that prefix. The MinIO admin /
    console is never reached from this code path; ``boto3`` only talks the S3 data plane.

    The client is built **lazily** via the injected factory so tests pass a stubbed client and the
    real boto3 client never instantiates without need.
    """

    _URI_SCHEME = "minio"  # The AWS S3 backend (M4) overrides this to ``"s3"`` via a subclass.

    def __init__(
        self,
        bucket: str,
        *,
        client_factory: Callable[[], Any],
    ) -> None:
        if not isinstance(bucket, str) or not bucket:
            raise ValueError("bucket must be a non-empty string")
        self._bucket = bucket
        self._client_factory = client_factory
        self._client: Any = None

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
        s3_key = self._s3_key(product_id, key)

        # The S3 ``put_object`` is atomic per-object: the new bytes either land in full or the
        # operation fails — no torn writes visible to readers. Returned ``ResponseMetadata`` is
        # ignored; we trust the call's success.
        try:
            self._call(
                "put_object",
                Bucket=self._bucket,
                Key=s3_key,
                Body=body_bytes,
                ContentType=content_type,
                Metadata={_SHA256_META: digest},
            )
        except (BackendUnavailable, ValueError):
            # ``ValueError`` covers both validation and ``ConfigError`` (a ValueError subclass) —
            # neither is a backend-availability problem and the caller should see them as-is.
            raise
        except Exception as e:
            raise BackendUnavailable(f"put_object failed: {e}") from e

        return ArtifactRef(
            product_id=product_id,
            key=key,
            storage_uri=self._uri(product_id, key),
            sha256=digest,
            content_type=content_type,
            size=len(body_bytes),
            stored_at=datetime.now(timezone.utc),
        )

    def head(self, product_id: str, key: str) -> ArtifactRef | None:
        _validate_product_id(product_id)
        _validate_key(key)
        try:
            response = self._call(
                "head_object",
                Bucket=self._bucket,
                Key=self._s3_key(product_id, key),
            )
        except _NotFound:
            return None
        except (BackendUnavailable, ValueError):
            raise
        except Exception as e:
            raise BackendUnavailable(f"head_object failed: {e}") from e

        digest = self._extract_sha256(response, product_id, key)
        return ArtifactRef(
            product_id=product_id,
            key=key,
            storage_uri=self._uri(product_id, key),
            sha256=digest,
            content_type=response.get("ContentType", "application/octet-stream"),
            size=int(response.get("ContentLength", 0)),
            stored_at=self._extract_stored_at(response),
        )

    def exists(self, product_id: str, key: str) -> bool:
        return self.head(product_id, key) is not None

    def delete_product(self, product_id: str) -> int:
        _validate_product_id(product_id)
        prefix = f"{product_id}/"

        # ``list_objects_v2`` returns up to 1000 keys per call; iterate ``ContinuationToken`` until
        # ``IsTruncated`` is false. Per-product purge is rare (offboarding); a single bucket-list
        # walk is acceptable.
        total = 0
        continuation: str | None = None
        while True:
            kwargs: dict[str, Any] = {"Bucket": self._bucket, "Prefix": prefix}
            if continuation is not None:
                kwargs["ContinuationToken"] = continuation
            try:
                page = self._call("list_objects_v2", **kwargs)
            except (BackendUnavailable, ValueError):
                raise
            except Exception as e:
                raise BackendUnavailable(f"list_objects_v2 failed: {e}") from e

            objects = page.get("Contents", []) or []
            if objects:
                # ``delete_objects`` is batched (up to 1000 per call — matches the list page).
                try:
                    response = self._call(
                        "delete_objects",
                        Bucket=self._bucket,
                        Delete={
                            "Objects": [{"Key": o["Key"]} for o in objects],
                            "Quiet": True,
                        },
                    )
                except (BackendUnavailable, ValueError):
                    raise
                except Exception as e:
                    raise BackendUnavailable(f"delete_objects failed: {e}") from e

                # ``Quiet=True`` returns only failures. Per the contract, ``delete_product`` MUST
                # fail closed on any single delete failure.
                errors = response.get("Errors", []) or []
                if errors:
                    # ``total`` reflects what completed before the failure; raise with detail.
                    raise BackendUnavailable(
                        f"delete_objects partial failure under {prefix!r}: "
                        f"{len(errors)} error(s); first={errors[0]!r}"
                    )

                total += len(objects)

            if not page.get("IsTruncated"):
                break
            continuation = page.get("NextContinuationToken")
            if continuation is None:
                # Defensive: a paginator that says ``IsTruncated=True`` but gives no token would
                # loop forever. Surface as a backend error.
                raise BackendUnavailable(
                    "list_objects_v2 returned IsTruncated without NextContinuationToken"
                )

        return total

    def presigned_get(
        self,
        product_id: str,
        key: str,
        *,
        expires_in: int = DEFAULT_PRESIGN_TTL_SECONDS,
    ) -> str:
        """Mint a short-TTL presigned GET URL via S3 ``generate_presigned_url`` (US-0023 AC #3/#4).

        ``generate_presigned_url`` signs **locally** — no network round-trip and no existence check —
        so a fresh URL is minted on every call (an expired link is just re-minted, AC #4). The signed
        URL points at the product-namespaced key inside the configured bucket, so it can only ever
        address this product's object. The MinIO admin/console is never involved — this is the S3
        data plane only (US-0023 AC: never expose the storage console)."""
        _validate_product_id(product_id)
        _validate_key(key)
        if not isinstance(expires_in, int) or expires_in <= 0:
            raise ValueError(f"expires_in must be a positive integer of seconds; got {expires_in!r}")
        try:
            client = self._ensure_client()
            return client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": self._s3_key(product_id, key)},
                ExpiresIn=expires_in,
            )
        except (BackendUnavailable, ValueError):
            raise
        except Exception as e:
            raise BackendUnavailable(f"generate_presigned_url failed: {e}") from e

    # -- internals --

    def _call(self, op: str, **kwargs: Any) -> Any:
        """Dispatch an S3 client call; translate the no-such-key error to :class:`_NotFound`.

        Other client errors propagate as-is; the caller wraps them in :class:`BackendUnavailable`
        with context. Translating here means the per-op handlers above stay readable.
        """
        client = self._ensure_client()
        method = getattr(client, op)
        try:
            return method(**kwargs)
        except Exception as e:  # noqa: BLE001 — botocore exceptions vary; we re-classify
            if _is_not_found(e):
                raise _NotFound() from e
            raise

    def _ensure_client(self) -> Any:
        if self._client is None:
            self._client = self._client_factory()
        return self._client

    def _s3_key(self, product_id: str, key: str) -> str:
        # The bucket is the namespace; the per-product prefix is the isolation primitive.
        return f"{product_id}/{key}"

    def _uri(self, product_id: str, key: str) -> str:
        # ``minio://<bucket>/<product_id>/<key>``. Endpoint deliberately not in the URI — the URI
        # is a *logical* identifier; moving the MinIO endpoint must not invalidate references in
        # the event log (ADR-0008/0009 — references are part of the audit chain).
        return f"{self._URI_SCHEME}://{self._bucket}/{product_id}/{key}"

    def _extract_sha256(self, response: dict, product_id: str, key: str) -> str:
        # boto3 normalises user metadata to lowercase keys in ``response['Metadata']``.
        meta = response.get("Metadata") or {}
        digest = meta.get(_SHA256_META)
        if not digest:
            # An object without the metadata is one this code path did not write — refuse to lie
            # about the digest. Surface as BackendCorrupt so the caller knows the store is in an
            # inconsistent state (manual mc / aws-cli uploads bypass the egress).
            raise BackendCorrupt(
                f"object {self._uri(product_id, key)} is missing the {_SHA256_META!r} "
                f"user-metadata header — it was not written through ArtifactStore"
            )
        return digest

    def _extract_stored_at(self, response: dict) -> datetime:
        # S3 returns ``LastModified`` as a tz-aware datetime (boto3 default). Defensive coercion
        # below — if a backend returns naive, attribute it to UTC.
        last_modified = response.get("LastModified")
        if isinstance(last_modified, datetime):
            if last_modified.tzinfo is None:
                return last_modified.replace(tzinfo=timezone.utc)
            return last_modified
        return datetime.now(timezone.utc)


# --- not-found translation -------------------------------------------------------------------------


class _NotFound(Exception):
    """Internal: the S3 ``404 NoSuchKey`` (or HEAD 404) raised by the client.

    Translated to ``None`` by :meth:`MinIOArtifactStore.head`; not part of the public surface.
    """


def _is_not_found(e: BaseException) -> bool:
    """Recognise the boto3 / botocore not-found shapes across operations.

    boto3 raises:
      * ``s3.exceptions.NoSuchKey`` for ``get_object``;
      * a generic ``ClientError`` with ``response['Error']['Code'] in {"404", "NoSuchKey",
        "NotFound"}`` for ``head_object`` (which doesn't have a body to populate ``NoSuchKey``);
      * occasionally a botocore stub raises with ``Code='NoSuchKey'`` too — same path.

    We pattern-match on the error code; the exception class hierarchy is not stable enough across
    botocore versions to rely on isinstance alone.
    """
    code = _error_code(e)
    return code in {"404", "NoSuchKey", "NotFound"}


def _error_code(e: BaseException) -> str | None:
    response = getattr(e, "response", None)
    if isinstance(response, dict):
        err = response.get("Error")
        if isinstance(err, dict):
            return err.get("Code")
    return None
