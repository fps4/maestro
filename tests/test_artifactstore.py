"""Tests for the :mod:`storage.artifactstore` Protocol and the in-memory backend.

Lives next to the other engine tests; mocked-LLM / no-network discipline (per ``tests/`` policy in
CODEBASE.md). The MinIO backend tests land in M2 #2 alongside the backend itself.
"""
from __future__ import annotations

import hashlib
import threading
from datetime import datetime, timezone

import pytest

from storage import (
    ArtifactRef,
    ArtifactStore,
    InMemoryArtifactStore,
)


# --- helpers --------------------------------------------------------------------------------------


def _store() -> InMemoryArtifactStore:
    return InMemoryArtifactStore()


# --- Protocol surface ------------------------------------------------------------------------------


def test_in_memory_satisfies_artifact_store_protocol() -> None:
    # Structural-typing check — InMemoryArtifactStore is a usable ArtifactStore at the type level.
    store: ArtifactStore = _store()  # noqa: F841


# --- put: happy path -------------------------------------------------------------------------------


def test_put_returns_ref_with_sha256_size_and_uri() -> None:
    body = b"hello, artefact"
    ref = _store().put("p-alpha", "tasks/T-1/specs/spec.md", body, "text/markdown")

    assert ref.product_id == "p-alpha"
    assert ref.key == "tasks/T-1/specs/spec.md"
    assert ref.sha256 == hashlib.sha256(body).hexdigest()
    assert ref.size == len(body)
    assert ref.content_type == "text/markdown"
    assert ref.storage_uri == "memory://p-alpha/tasks/T-1/specs/spec.md"


def test_put_sets_stored_at_utc() -> None:
    before = datetime.now(timezone.utc)
    ref = _store().put("p-alpha", "k", b"x", "application/octet-stream")
    after = datetime.now(timezone.utc)

    assert ref.stored_at.tzinfo is not None
    assert before <= ref.stored_at <= after


def test_put_returns_a_frozen_dataclass() -> None:
    ref = _store().put("p-alpha", "k", b"x", "application/octet-stream")
    with pytest.raises(Exception):
        ref.key = "other"  # type: ignore[misc]


def test_put_accepts_bytes_like_inputs() -> None:
    store = _store()
    store.put("p-alpha", "a", b"hi", "text/plain")
    store.put("p-alpha", "b", bytearray(b"hi"), "text/plain")
    store.put("p-alpha", "c", memoryview(b"hi"), "text/plain")
    # All three refs should be readable through head.
    assert store.head("p-alpha", "a") is not None
    assert store.head("p-alpha", "b") is not None
    assert store.head("p-alpha", "c") is not None


# --- put: overwrite (S3 semantics) -----------------------------------------------------------------


def test_put_overwrites_on_same_key_with_new_bytes() -> None:
    store = _store()
    first = store.put("p-alpha", "k", b"v1", "text/plain")
    second = store.put("p-alpha", "k", b"v2", "text/plain")

    assert first.sha256 != second.sha256
    assert first.storage_uri == second.storage_uri  # same canonical URI

    head = store.head("p-alpha", "k")
    assert head is not None and head.sha256 == second.sha256
    assert head.size == 2


def test_put_same_bytes_same_key_yields_same_sha256() -> None:
    # Idempotent on content even though the store overwrites — sha256 is content-addressed.
    store = _store()
    a = store.put("p-alpha", "k", b"same", "text/plain")
    b = store.put("p-alpha", "k", b"same", "text/plain")
    assert a.sha256 == b.sha256


# --- put: validation -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_key",
    [
        "",                       # empty
        "/leading-slash",         # leading slash
        "back\\slash",            # backslash
        "nul\x00byte",            # NUL
        "tasks/../escape",        # ``..`` segment
        "..",                     # bare ``..``
        "a" * 1025,               # too long
    ],
)
def test_put_rejects_invalid_key(bad_key: str) -> None:
    with pytest.raises(ValueError):
        _store().put("p-alpha", bad_key, b"x", "text/plain")


@pytest.mark.parametrize(
    "bad_product_id",
    [
        "",                       # empty
        "Has-Caps",               # uppercase
        "has_underscore",         # underscore not allowed
        "has space",              # whitespace
        "a" * 65,                 # too long
        "..",                     # not alnum/dash
    ],
)
def test_put_rejects_invalid_product_id(bad_product_id: str) -> None:
    with pytest.raises(ValueError):
        _store().put(bad_product_id, "k", b"x", "text/plain")


@pytest.mark.parametrize(
    "bad_ct",
    [
        "",                       # empty
        "text",                   # no subtype
        "/markdown",              # missing type
        "text/",                  # missing subtype
        "*/*",                    # wildcard rejected
        "*",                      # wildcard rejected
        "text\nplain",            # control chars
    ],
)
def test_put_rejects_invalid_content_type(bad_ct: str) -> None:
    with pytest.raises(ValueError):
        _store().put("p-alpha", "k", b"x", bad_ct)


def test_put_rejects_non_bytes_body() -> None:
    with pytest.raises(ValueError):
        _store().put("p-alpha", "k", "a string is not bytes", "text/plain")  # type: ignore[arg-type]


# --- head ------------------------------------------------------------------------------------------


def test_head_returns_ref_after_put() -> None:
    store = _store()
    put_ref = store.put("p-alpha", "k", b"hi", "text/plain")
    head_ref = store.head("p-alpha", "k")

    assert head_ref is not None
    assert head_ref == put_ref


def test_head_returns_none_when_missing() -> None:
    assert _store().head("p-alpha", "absent") is None


def test_head_validates_inputs() -> None:
    store = _store()
    with pytest.raises(ValueError):
        store.head("BAD-CAPS", "k")
    with pytest.raises(ValueError):
        store.head("p-alpha", "")


# --- exists ----------------------------------------------------------------------------------------


def test_exists_after_put_and_after_delete() -> None:
    store = _store()
    assert store.exists("p-alpha", "k") is False
    store.put("p-alpha", "k", b"x", "text/plain")
    assert store.exists("p-alpha", "k") is True
    store.delete_product("p-alpha")
    assert store.exists("p-alpha", "k") is False


def test_contains_works_for_artifact_ref() -> None:
    store = _store()
    ref = store.put("p-alpha", "k", b"x", "text/plain")
    assert ref in store


# --- delete_product (per-product isolation) --------------------------------------------------------


def test_delete_product_only_removes_that_products_objects() -> None:
    store = _store()
    a1 = store.put("p-alpha", "k1", b"a1", "text/plain")
    a2 = store.put("p-alpha", "k2", b"a2", "text/plain")
    b1 = store.put("p-beta",  "k1", b"b1", "text/plain")

    removed = store.delete_product("p-alpha")

    assert removed == 2
    assert store.head("p-alpha", "k1") is None
    assert store.head("p-alpha", "k2") is None
    assert store.head("p-beta",  "k1") is not None  # p-beta untouched
    # The b1 ref still resolves.
    assert store.head("p-beta", "k1") == b1
    # a1, a2 references are now stale but valid value objects.
    assert a1.sha256 != a2.sha256


def test_delete_product_returns_zero_when_no_objects() -> None:
    store = _store()
    assert store.delete_product("p-empty") == 0


def test_delete_product_validates_input() -> None:
    with pytest.raises(ValueError):
        _store().delete_product("BAD")


# --- threading -------------------------------------------------------------------------------------


def test_concurrent_puts_are_safe() -> None:
    # 4 threads × 250 distinct keys; every put must land, and the final store size = 1000.
    store = _store()
    errors: list[BaseException] = []

    def worker(thread_id: int) -> None:
        try:
            for i in range(250):
                store.put(
                    "p-alpha",
                    f"thread-{thread_id}/key-{i:03}",
                    str(i).encode(),
                    "text/plain",
                )
        except BaseException as e:  # pragma: no cover — surfaces threading races
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors
    assert len(store) == 1000


def test_concurrent_puts_to_same_key_yield_one_winner() -> None:
    # Two threads racing on the same key — both must complete cleanly; one body wins.
    store = _store()

    def putter(payload: bytes) -> None:
        for _ in range(50):
            store.put("p-alpha", "race-key", payload, "text/plain")

    t1 = threading.Thread(target=putter, args=(b"value-a",))
    t2 = threading.Thread(target=putter, args=(b"value-b",))
    t1.start(); t2.start()
    t1.join();  t2.join()

    ref = store.head("p-alpha", "race-key")
    assert ref is not None
    # The winner is whichever ran last — either bytes-a or bytes-b. The test asserts only that the
    # store is in a consistent state (no torn writes, no exceptions).
    assert ref.sha256 in {
        hashlib.sha256(b"value-a").hexdigest(),
        hashlib.sha256(b"value-b").hexdigest(),
    }
    assert ref.size == len(b"value-a") == len(b"value-b")


# --- canonical URI shape ---------------------------------------------------------------------------


def test_storage_uri_is_canonical_and_stable() -> None:
    store = _store()
    ref1 = store.put("p-alpha", "nested/path/to/object", b"x", "text/plain")
    ref2 = store.head("p-alpha", "nested/path/to/object")

    assert ref1.storage_uri == "memory://p-alpha/nested/path/to/object"
    assert ref2 is not None and ref2.storage_uri == ref1.storage_uri


def test_different_products_with_same_key_have_distinguishable_uris() -> None:
    store = _store()
    a = store.put("p-alpha", "k", b"x", "text/plain")
    b = store.put("p-beta",  "k", b"x", "text/plain")

    assert a.storage_uri != b.storage_uri
    assert a.sha256 == b.sha256  # content-addressed, same bytes => same digest
