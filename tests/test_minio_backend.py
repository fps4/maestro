"""Tests for :class:`storage.minio.MinIOArtifactStore` using the boto3 ``Stubber``.

The stubber lets us drive the backend against scripted S3 responses — no network, no real MinIO.
The contract tests (``test_artifactstore.py``) cover the behavioural shape; this file covers
backend-specific concerns (S3 wire shape, error translation, prefix-bound delete_product).

A real-MinIO integration test ships as :func:`test_smoke_minio_if_endpoint_set` — opt-in via
``MAESTRO_TEST_MINIO_ENDPOINT``; skipped in CI.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import os
from typing import Any

import pytest

boto3 = pytest.importorskip("boto3")
from botocore.stub import Stubber  # noqa: E402

from storage import (
    BackendCorrupt,
    BackendUnavailable,
)
from storage.minio import MinIOArtifactStore


# --- helpers --------------------------------------------------------------------------------------


def _client() -> Any:
    """A boto3 S3 client wired to nowhere — the stubber intercepts all calls."""
    return boto3.client(
        "s3",
        region_name="us-east-1",
        aws_access_key_id="test",
        aws_secret_access_key="test",
        endpoint_url="https://stub.invalid",
    )


def _store_with_client(client: Any, bucket: str = "maestro-artefacts") -> MinIOArtifactStore:
    return MinIOArtifactStore(bucket=bucket, client_factory=lambda: client)


# --- put --------------------------------------------------------------------------------------------


def test_put_sends_correct_s3_call_and_returns_ref() -> None:
    client = _client()
    body = b"hello, artefact"
    stubber = Stubber(client)
    stubber.add_response(
        "put_object",
        service_response={"ETag": '"abc"'},
        expected_params={
            "Bucket":      "maestro-artefacts",
            "Key":         "p-alpha/tasks/T-1/specs/spec.md",
            "Body":        body,
            "ContentType": "text/markdown",
            "Metadata":    {"sha256": hashlib.sha256(body).hexdigest()},
        },
    )

    with stubber:
        store = _store_with_client(client)
        ref = store.put("p-alpha", "tasks/T-1/specs/spec.md", body, "text/markdown")

    assert ref.product_id == "p-alpha"
    assert ref.key == "tasks/T-1/specs/spec.md"
    assert ref.storage_uri == "minio://maestro-artefacts/p-alpha/tasks/T-1/specs/spec.md"
    assert ref.sha256 == hashlib.sha256(body).hexdigest()
    assert ref.size == len(body)
    assert ref.content_type == "text/markdown"


def test_put_translates_client_failure_to_backend_unavailable() -> None:
    client = _client()
    stubber = Stubber(client)
    stubber.add_client_error(
        "put_object",
        service_error_code="ServiceUnavailable",
        service_message="boom",
        http_status_code=503,
        expected_params={
            "Bucket":      "maestro-artefacts",
            "Key":         "p-alpha/k",
            "Body":        b"x",
            "ContentType": "text/plain",
            "Metadata":    {"sha256": hashlib.sha256(b"x").hexdigest()},
        },
    )

    with stubber:
        store = _store_with_client(client)
        with pytest.raises(BackendUnavailable, match="put_object failed"):
            store.put("p-alpha", "k", b"x", "text/plain")


# --- head -------------------------------------------------------------------------------------------


def test_head_returns_ref_with_metadata() -> None:
    client = _client()
    body = b"hello"
    digest = hashlib.sha256(body).hexdigest()
    last_modified = dt.datetime(2026, 5, 29, 12, 0, 0, tzinfo=dt.timezone.utc)

    stubber = Stubber(client)
    stubber.add_response(
        "head_object",
        service_response={
            "ContentType":   "text/markdown",
            "ContentLength": len(body),
            "LastModified":  last_modified,
            "Metadata":      {"sha256": digest},
        },
        expected_params={
            "Bucket": "maestro-artefacts",
            "Key":    "p-alpha/k",
        },
    )

    with stubber:
        store = _store_with_client(client)
        ref = store.head("p-alpha", "k")

    assert ref is not None
    assert ref.sha256 == digest
    assert ref.size == len(body)
    assert ref.content_type == "text/markdown"
    assert ref.stored_at == last_modified


def test_head_returns_none_on_404() -> None:
    client = _client()
    stubber = Stubber(client)
    stubber.add_client_error(
        "head_object",
        service_error_code="404",
        http_status_code=404,
        expected_params={"Bucket": "maestro-artefacts", "Key": "p-alpha/missing"},
    )

    with stubber:
        store = _store_with_client(client)
        assert store.head("p-alpha", "missing") is None


def test_head_translates_unrelated_error_to_backend_unavailable() -> None:
    client = _client()
    stubber = Stubber(client)
    stubber.add_client_error(
        "head_object",
        service_error_code="InternalError",
        http_status_code=500,
        expected_params={"Bucket": "maestro-artefacts", "Key": "p-alpha/k"},
    )

    with stubber:
        store = _store_with_client(client)
        with pytest.raises(BackendUnavailable, match="head_object failed"):
            store.head("p-alpha", "k")


def test_head_raises_backend_corrupt_on_missing_sha256_metadata() -> None:
    # An object written outside the egress (manual mc / aws-cli upload) has no sha256 meta. Refuse
    # to lie about the digest.
    client = _client()
    stubber = Stubber(client)
    stubber.add_response(
        "head_object",
        service_response={
            "ContentType":   "text/plain",
            "ContentLength": 5,
            "LastModified":  dt.datetime.now(dt.timezone.utc),
            "Metadata":      {},  # no sha256
        },
        expected_params={"Bucket": "maestro-artefacts", "Key": "p-alpha/k"},
    )

    with stubber:
        store = _store_with_client(client)
        with pytest.raises(BackendCorrupt, match="sha256"):
            store.head("p-alpha", "k")


def test_exists_is_head_isnotnone() -> None:
    client = _client()
    stubber = Stubber(client)
    # First exists() call: 404 → False
    stubber.add_client_error(
        "head_object",
        service_error_code="NoSuchKey",
        http_status_code=404,
        expected_params={"Bucket": "maestro-artefacts", "Key": "p-alpha/k"},
    )
    # Second exists() call: success → True
    stubber.add_response(
        "head_object",
        service_response={
            "ContentType":   "text/plain",
            "ContentLength": 1,
            "LastModified":  dt.datetime.now(dt.timezone.utc),
            "Metadata":      {"sha256": hashlib.sha256(b"x").hexdigest()},
        },
        expected_params={"Bucket": "maestro-artefacts", "Key": "p-alpha/k"},
    )

    with stubber:
        store = _store_with_client(client)
        assert store.exists("p-alpha", "k") is False
        assert store.exists("p-alpha", "k") is True


# --- delete_product (the prefix-bounded purge) ------------------------------------------------------


def test_delete_product_lists_and_deletes_under_product_prefix() -> None:
    client = _client()
    stubber = Stubber(client)
    # One list page with two keys; one delete batch; IsTruncated=False so loop exits.
    stubber.add_response(
        "list_objects_v2",
        service_response={
            "IsTruncated": False,
            "Contents": [
                {"Key": "p-alpha/a"},
                {"Key": "p-alpha/sub/b"},
            ],
        },
        expected_params={"Bucket": "maestro-artefacts", "Prefix": "p-alpha/"},
    )
    stubber.add_response(
        "delete_objects",
        service_response={"Deleted": [{"Key": "p-alpha/a"}, {"Key": "p-alpha/sub/b"}]},
        expected_params={
            "Bucket": "maestro-artefacts",
            "Delete": {
                "Objects": [{"Key": "p-alpha/a"}, {"Key": "p-alpha/sub/b"}],
                "Quiet":   True,
            },
        },
    )

    with stubber:
        store = _store_with_client(client)
        removed = store.delete_product("p-alpha")

    assert removed == 2


def test_delete_product_paginates_until_not_truncated() -> None:
    client = _client()
    stubber = Stubber(client)

    # Page 1 (truncated)
    stubber.add_response(
        "list_objects_v2",
        service_response={
            "IsTruncated":            True,
            "NextContinuationToken":  "TOKEN-2",
            "Contents":               [{"Key": "p-alpha/p1-a"}],
        },
        expected_params={"Bucket": "maestro-artefacts", "Prefix": "p-alpha/"},
    )
    stubber.add_response(
        "delete_objects",
        service_response={"Deleted": [{"Key": "p-alpha/p1-a"}]},
        expected_params={
            "Bucket": "maestro-artefacts",
            "Delete": {"Objects": [{"Key": "p-alpha/p1-a"}], "Quiet": True},
        },
    )
    # Page 2 (last)
    stubber.add_response(
        "list_objects_v2",
        service_response={
            "IsTruncated": False,
            "Contents":    [{"Key": "p-alpha/p2-a"}, {"Key": "p-alpha/p2-b"}],
        },
        expected_params={
            "Bucket":            "maestro-artefacts",
            "Prefix":            "p-alpha/",
            "ContinuationToken": "TOKEN-2",
        },
    )
    stubber.add_response(
        "delete_objects",
        service_response={"Deleted": [{"Key": "p-alpha/p2-a"}, {"Key": "p-alpha/p2-b"}]},
        expected_params={
            "Bucket": "maestro-artefacts",
            "Delete": {
                "Objects": [{"Key": "p-alpha/p2-a"}, {"Key": "p-alpha/p2-b"}],
                "Quiet":   True,
            },
        },
    )

    with stubber:
        store = _store_with_client(client)
        removed = store.delete_product("p-alpha")

    assert removed == 3


def test_delete_product_returns_zero_when_no_objects() -> None:
    client = _client()
    stubber = Stubber(client)
    stubber.add_response(
        "list_objects_v2",
        service_response={"IsTruncated": False, "Contents": []},
        expected_params={"Bucket": "maestro-artefacts", "Prefix": "p-empty/"},
    )

    with stubber:
        store = _store_with_client(client)
        assert store.delete_product("p-empty") == 0


def test_delete_product_fails_closed_on_partial_failure() -> None:
    client = _client()
    stubber = Stubber(client)
    stubber.add_response(
        "list_objects_v2",
        service_response={
            "IsTruncated": False,
            "Contents":    [{"Key": "p-alpha/a"}, {"Key": "p-alpha/b"}],
        },
        expected_params={"Bucket": "maestro-artefacts", "Prefix": "p-alpha/"},
    )
    # ``delete_objects`` with ``Quiet=True`` returns only failures in ``Errors``.
    stubber.add_response(
        "delete_objects",
        service_response={
            "Errors": [
                {"Key": "p-alpha/b", "Code": "InternalError", "Message": "boom"},
            ],
        },
        expected_params={
            "Bucket": "maestro-artefacts",
            "Delete": {
                "Objects": [{"Key": "p-alpha/a"}, {"Key": "p-alpha/b"}],
                "Quiet":   True,
            },
        },
    )

    with stubber:
        store = _store_with_client(client)
        with pytest.raises(BackendUnavailable, match="partial failure"):
            store.delete_product("p-alpha")


def test_delete_product_raises_on_truncated_without_token() -> None:
    # Defensive: a misbehaving S3 implementation could say ``IsTruncated=True`` with no token.
    # The backend must not loop forever on this.
    client = _client()
    stubber = Stubber(client)
    stubber.add_response(
        "list_objects_v2",
        service_response={"IsTruncated": True, "Contents": []},  # no NextContinuationToken
        expected_params={"Bucket": "maestro-artefacts", "Prefix": "p-alpha/"},
    )

    with stubber:
        store = _store_with_client(client)
        with pytest.raises(BackendUnavailable, match="IsTruncated without NextContinuationToken"):
            store.delete_product("p-alpha")


# --- per-product isolation (URI + key prefix) -------------------------------------------------------


def test_uri_carries_bucket_and_product_id_not_endpoint() -> None:
    # Stability: moving the MinIO endpoint must not invalidate references in the event log.
    client = _client()
    stubber = Stubber(client)
    stubber.add_response(
        "put_object",
        service_response={"ETag": '"x"'},
        expected_params={
            "Bucket":      "maestro-artefacts",
            "Key":         "p-alpha/k",
            "Body":        b"x",
            "ContentType": "text/plain",
            "Metadata":    {"sha256": hashlib.sha256(b"x").hexdigest()},
        },
    )

    with stubber:
        ref = _store_with_client(client).put("p-alpha", "k", b"x", "text/plain")

    assert ref.storage_uri == "minio://maestro-artefacts/p-alpha/k"
    assert "stub.invalid" not in ref.storage_uri  # no endpoint leakage


# --- validation passthrough (the M2 #1 rules carry into the MinIO backend) -------------------------


def test_put_rejects_invalid_key_before_calling_backend() -> None:
    # If validation passes through, the stubber would see no call — confirms egress is rejected
    # at the Protocol boundary.
    client = _client()
    stubber = Stubber(client)  # no expected calls

    with stubber:
        store = _store_with_client(client)
        with pytest.raises(ValueError):
            store.put("p-alpha", "../escape", b"x", "text/plain")


def test_delete_product_validates_product_id() -> None:
    client = _client()
    stubber = Stubber(client)

    with stubber:
        store = _store_with_client(client)
        with pytest.raises(ValueError):
            store.delete_product("BAD-CAPS")


# --- bucket validation -----------------------------------------------------------------------------


def test_constructor_rejects_empty_bucket() -> None:
    with pytest.raises(ValueError, match="bucket"):
        MinIOArtifactStore(bucket="", client_factory=_client)  # type: ignore[arg-type]


# --- lazy client construction ---------------------------------------------------------------------


def test_client_is_built_lazily() -> None:
    # The factory is not called until the first real op — keeps the in-process startup cheap and
    # lets tests construct the store without the env credentials check.
    calls: list[int] = []

    def factory() -> Any:
        calls.append(1)
        return _client()

    store = MinIOArtifactStore(bucket="b", client_factory=factory)
    assert calls == []  # constructor didn't reach the factory


# --- opt-in smoke test against a real MinIO --------------------------------------------------------


@pytest.mark.skipif(
    not os.environ.get("MAESTRO_TEST_MINIO_ENDPOINT"),
    reason="set MAESTRO_TEST_MINIO_ENDPOINT (+ ACCESS_KEY / SECRET_KEY / BUCKET) to run",
)
def test_smoke_minio_if_endpoint_set() -> None:
    # The architect's local smoke path against the ds1 MinIO. Round-trips one object end to end.
    endpoint   = os.environ["MAESTRO_TEST_MINIO_ENDPOINT"]
    access_key = os.environ["MAESTRO_TEST_MINIO_ACCESS_KEY"]
    secret_key = os.environ["MAESTRO_TEST_MINIO_SECRET_KEY"]
    bucket     = os.environ["MAESTRO_TEST_MINIO_BUCKET"]

    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="us-east-1",
    )
    store = MinIOArtifactStore(bucket=bucket, client_factory=lambda: client)

    body = io.BytesIO(b"smoke test artefact").getvalue()
    ref = store.put("p-smoke", "smoke.txt", body, "text/plain")
    try:
        head = store.head("p-smoke", "smoke.txt")
        assert head is not None
        assert head.sha256 == ref.sha256
        assert head.size == len(body)
    finally:
        # Best-effort cleanup; if it fails, the next run will sweep via delete_product.
        store.delete_product("p-smoke")
