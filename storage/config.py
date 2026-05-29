"""Configuration loading and the :func:`make_store` factory (M2 #2).

Backend selection is **per-instance default + per-product override** (per ADR-0012). This module
holds the instance-default plumbing; per-product overrides ride on the product register and land
when the first commercial product opts in (M4).

The config schema is pinned in ``docs/architecture/contracts/artifact-store.md`` §configuration.
Credentials are **never** in the YAML — only env-var *names*, read at construction time.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Callable, Literal

from storage.artifactstore import ArtifactStore, InMemoryArtifactStore

# A backend literal is the only enum-like value in the schema. Keep it as a Literal so a typo in
# the YAML surfaces at load time, not at runtime when the wrong backend tries to start.
Backend = Literal["in-memory", "minio", "s3"]
_VALID_BACKENDS: tuple[str, ...] = ("in-memory", "minio", "s3")

_DEFAULT_REGION = "us-east-1"  # MinIO accepts a synthetic region; S3 requires a real one in M4.


# --- typed config ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class MinIOConfig:
    """Connection parameters for the MinIO / S3-API backend.

    ``access_key_env`` and ``secret_key_env`` are **env-var names**, not credentials. The factory
    reads the env at client-construction time so a process restart with rotated env picks up the
    new secret without a config change (matches ADR-0012's "credentials as secrets" rule).
    """

    endpoint:       str
    bucket:         str
    access_key_env: str
    secret_key_env: str
    region:         str = _DEFAULT_REGION


@dataclass(frozen=True)
class ArtifactStoreConfig:
    """The resolved ``artifact_store:`` block from the instance config.

    ``backend`` is always set; the backend-specific block (``minio``) is set iff that backend is
    selected. Loader keeps these invariants — readers can trust them.
    """

    backend: Backend
    minio:   MinIOConfig | None = None
    # ``s3`` block lands in M4 (commercial onboarding); same shape as MinIOConfig minus endpoint.


# --- loader ----------------------------------------------------------------------------------------


class ConfigError(ValueError):
    """Surfaced at load time when the YAML / dict shape is wrong.

    Kept distinct from generic ``ValueError`` so the boot path can render a clean error message
    (``"artifact_store config: ..."``) without swallowing unrelated value errors from the rest of
    the engine.
    """


def load_artifact_store_config(d: dict[str, Any] | None) -> ArtifactStoreConfig:
    """Parse + validate an ``artifact_store:`` block.

    Defaults to ``backend: in-memory`` when ``d`` is ``None`` or absent (the dev / test default).
    A real deployment is expected to set ``backend: minio`` explicitly.
    """
    if d is None:
        return ArtifactStoreConfig(backend="in-memory")

    if not isinstance(d, dict):
        raise ConfigError(f"artifact_store config must be a mapping; got {type(d).__name__}")

    backend = d.get("backend", "in-memory")
    if backend not in _VALID_BACKENDS:
        raise ConfigError(
            f"artifact_store.backend must be one of {list(_VALID_BACKENDS)}; got {backend!r}"
        )

    if backend == "in-memory":
        return ArtifactStoreConfig(backend="in-memory")

    if backend == "minio":
        minio_block = d.get("minio")
        if not isinstance(minio_block, dict):
            raise ConfigError("artifact_store.minio block is required when backend is 'minio'")
        return ArtifactStoreConfig(backend="minio", minio=_parse_minio(minio_block))

    # s3 backend deferred to M4. Refuse loudly rather than silently degrade.
    raise ConfigError(
        f"artifact_store.backend {backend!r} is not supported yet; "
        f"MinIO is the M2 backend (ADR-0012 / m2-build-to-merge.md Q4)"
    )


def _parse_minio(d: dict[str, Any]) -> MinIOConfig:
    required = ("endpoint", "bucket", "access_key_env", "secret_key_env")
    missing = [k for k in required if not d.get(k)]
    if missing:
        raise ConfigError(
            f"artifact_store.minio is missing required keys: {missing}"
        )
    for k in required:
        if not isinstance(d[k], str):
            raise ConfigError(f"artifact_store.minio.{k} must be a string; got {type(d[k]).__name__}")

    region = d.get("region", _DEFAULT_REGION)
    if not isinstance(region, str) or not region:
        raise ConfigError("artifact_store.minio.region must be a non-empty string")

    return MinIOConfig(
        endpoint=d["endpoint"],
        bucket=d["bucket"],
        access_key_env=d["access_key_env"],
        secret_key_env=d["secret_key_env"],
        region=region,
    )


# --- factory ---------------------------------------------------------------------------------------


def make_store(
    config: ArtifactStoreConfig,
    *,
    client_factory: Callable[[MinIOConfig], Any] | None = None,
) -> ArtifactStore:
    """Build the configured :class:`ArtifactStore` backend.

    For ``minio``, ``client_factory`` is the boto3-client constructor; the default reads the
    env-var-named credentials and builds a real client. Tests pass a stubbed factory.
    """
    if config.backend == "in-memory":
        return InMemoryArtifactStore()

    if config.backend == "minio":
        assert config.minio is not None  # loader invariant
        from storage.minio import MinIOArtifactStore  # lazy: boto3 only imported when used

        factory = client_factory or _default_boto3_factory
        return MinIOArtifactStore(
            bucket=config.minio.bucket,
            client_factory=lambda: factory(config.minio),  # type: ignore[arg-type]
        )

    raise ConfigError(f"unsupported backend {config.backend!r}")


def _default_boto3_factory(minio: MinIOConfig) -> Any:
    """Construct a real boto3 S3 client pointed at MinIO.

    Lazy import of ``boto3`` keeps it out of the import graph for any code path that doesn't reach
    the MinIO backend (tests, in-memory deployments). Reads credentials from env at call time so a
    secret rotation only needs a process restart, not a config edit.
    """
    import boto3  # type: ignore[import-untyped]

    access_key = os.environ.get(minio.access_key_env)
    secret_key = os.environ.get(minio.secret_key_env)
    if not access_key or not secret_key:
        raise ConfigError(
            f"artifact_store.minio: credentials not set in env "
            f"({minio.access_key_env}, {minio.secret_key_env})"
        )

    endpoint = minio.endpoint
    if not endpoint.startswith(("http://", "https://")):
        # MinIO on the lab network is reached over plain http; production is https. Default to
        # https for safety — explicit ``http://`` in config opts in to plaintext.
        endpoint = f"https://{endpoint}"

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=minio.region,
    )
