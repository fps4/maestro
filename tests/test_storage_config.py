"""Tests for :mod:`storage.config` (loader + ``make_store`` factory)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from storage import (
    ArtifactStoreConfig,
    ConfigError,
    InMemoryArtifactStore,
    MinIOConfig,
    load_artifact_store_config,
    make_store,
)
from storage.minio import MinIOArtifactStore


# --- load_artifact_store_config -------------------------------------------------------------------


def test_load_returns_in_memory_default_when_block_absent() -> None:
    assert load_artifact_store_config(None) == ArtifactStoreConfig(backend="in-memory")


def test_load_returns_in_memory_when_explicit() -> None:
    cfg = load_artifact_store_config({"backend": "in-memory"})
    assert cfg == ArtifactStoreConfig(backend="in-memory")


def test_load_parses_minio_block() -> None:
    cfg = load_artifact_store_config({
        "backend": "minio",
        "minio": {
            "endpoint":       "ds1.local:9000",
            "bucket":         "maestro-artefacts",
            "access_key_env": "MINIO_ACCESS_KEY",
            "secret_key_env": "MINIO_SECRET_KEY",
            "region":         "lab-1",
        },
    })
    assert cfg.backend == "minio"
    assert cfg.minio == MinIOConfig(
        endpoint="ds1.local:9000",
        bucket="maestro-artefacts",
        access_key_env="MINIO_ACCESS_KEY",
        secret_key_env="MINIO_SECRET_KEY",
        region="lab-1",
    )


def test_load_defaults_minio_region() -> None:
    cfg = load_artifact_store_config({
        "backend": "minio",
        "minio": {
            "endpoint":       "ds1.local:9000",
            "bucket":         "b",
            "access_key_env": "K",
            "secret_key_env": "S",
        },
    })
    assert cfg.minio is not None
    assert cfg.minio.region == "us-east-1"


@pytest.mark.parametrize(
    "missing",
    ["endpoint", "bucket", "access_key_env", "secret_key_env"],
)
def test_load_rejects_minio_missing_required(missing: str) -> None:
    block = {
        "endpoint":       "ds1.local:9000",
        "bucket":         "b",
        "access_key_env": "K",
        "secret_key_env": "S",
    }
    del block[missing]
    with pytest.raises(ConfigError, match=missing):
        load_artifact_store_config({"backend": "minio", "minio": block})


def test_load_rejects_minio_block_when_backend_is_minio_but_block_absent() -> None:
    with pytest.raises(ConfigError, match="minio block is required"):
        load_artifact_store_config({"backend": "minio"})


def test_load_rejects_unknown_backend() -> None:
    with pytest.raises(ConfigError, match="must be one of"):
        load_artifact_store_config({"backend": "rocks"})


def test_load_rejects_s3_backend_until_m4() -> None:
    with pytest.raises(ConfigError, match="not supported yet"):
        load_artifact_store_config({"backend": "s3"})


def test_load_rejects_non_mapping() -> None:
    with pytest.raises(ConfigError, match="must be a mapping"):
        load_artifact_store_config([])  # type: ignore[arg-type]


def test_load_rejects_non_string_minio_fields() -> None:
    with pytest.raises(ConfigError, match="endpoint must be a string"):
        load_artifact_store_config({
            "backend": "minio",
            "minio": {
                "endpoint":       9000,  # bad
                "bucket":         "b",
                "access_key_env": "K",
                "secret_key_env": "S",
            },
        })


def test_artifact_store_config_is_frozen() -> None:
    cfg = ArtifactStoreConfig(backend="in-memory")
    with pytest.raises(Exception):
        cfg.backend = "minio"  # type: ignore[misc]


# --- make_store -----------------------------------------------------------------------------------


def test_make_store_returns_in_memory_for_default() -> None:
    store = make_store(ArtifactStoreConfig(backend="in-memory"))
    assert isinstance(store, InMemoryArtifactStore)


def test_make_store_returns_minio_with_injected_client_factory() -> None:
    minio_cfg = MinIOConfig(
        endpoint="ds1.local:9000",
        bucket="maestro-artefacts",
        access_key_env="K",
        secret_key_env="S",
    )
    cfg = ArtifactStoreConfig(backend="minio", minio=minio_cfg)

    # ``client_factory`` is called with the resolved MinIOConfig — capture the call.
    captured: list[MinIOConfig] = []

    def factory(mc: MinIOConfig) -> Any:
        captured.append(mc)
        return _DummyS3Client()

    store = make_store(cfg, client_factory=factory)
    assert isinstance(store, MinIOArtifactStore)

    # The factory isn't called until the client is needed (lazy). Exercise it via head.
    store.head("p-alpha", "k")
    assert captured == [minio_cfg]


def test_make_store_minio_raises_when_default_factory_env_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # The default factory reads credentials from env at call time; with no env, it raises
    # ConfigError on first use — not at make_store time (lazy).
    monkeypatch.delenv("FAKE_ACCESS", raising=False)
    monkeypatch.delenv("FAKE_SECRET", raising=False)
    cfg = ArtifactStoreConfig(
        backend="minio",
        minio=MinIOConfig(
            endpoint="ds1.local:9000",
            bucket="b",
            access_key_env="FAKE_ACCESS",
            secret_key_env="FAKE_SECRET",
        ),
    )
    store = make_store(cfg)
    with pytest.raises(ConfigError, match="credentials not set in env"):
        store.head("p-alpha", "k")  # triggers lazy client construction


# --- helpers --------------------------------------------------------------------------------------


@dataclass
class _DummyS3Client:
    """A no-op client just so make_store + ``head`` don't crash; head is expected to 404."""

    def head_object(self, **kwargs: Any) -> Any:  # noqa: D401
        raise _DummyClientError({"Error": {"Code": "404"}})


class _DummyClientError(Exception):
    def __init__(self, response: dict[str, Any]) -> None:
        self.response = response
