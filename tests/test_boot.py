"""Fail-fast boot + connection checks (US-0001): no partially-connected start."""
import pytest

from orchestrator.boot import StartupError, boot


def test_boot_refuses_when_required_connections_are_missing(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("MAESTRO_MODEL_BASE_URL", raising=False)
    with pytest.raises(StartupError) as ei:
        boot(db_path=":memory:", allow_example_register=True)
    msg = str(ei.value)
    assert "github" in msg and "anthropic" in msg   # the message NAMES the failed connections


def test_boot_succeeds_with_presence_only_creds(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "dummy")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.delenv("MAESTRO_DEV_IDENTITY", raising=False)
    engine = boot(db_path=":memory:", allow_example_register=True)
    assert engine.github is not None                # the adapter is wired
    assert {c.name for c in engine.connections} == {"github", "anthropic", "dev-identity", "slack"}
    assert next(c for c in engine.connections if c.name == "slack").ok is None  # declared, skipped
    # No dev stub configured → the identity probe is declared but skipped (edge-auth path).
    assert next(c for c in engine.connections if c.name == "dev-identity").ok is None


def test_boot_refuses_when_dev_stub_set_outside_dev_env(monkeypatch):
    """US-0024 H7: a dev stub left on in a non-'dev' env (staging, unset, production) fails the
    boot — the stub must never be silently honoured behind the tunnel."""
    monkeypatch.setenv("GITHUB_TOKEN", "dummy")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.setenv("MAESTRO_DEV_IDENTITY", "ghost@example.com")
    monkeypatch.setenv("MAESTRO_ENV", "staging")
    with pytest.raises(StartupError) as ei:
        boot(db_path=":memory:", allow_example_register=True)
    assert "dev-identity" in str(ei.value) and "MAESTRO_ENV" in str(ei.value)


def test_boot_allows_dev_stub_when_env_is_dev(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "dummy")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.setenv("MAESTRO_DEV_IDENTITY", "you@example.com")
    monkeypatch.setenv("MAESTRO_ENV", "dev")
    engine = boot(db_path=":memory:", allow_example_register=True)
    assert next(c for c in engine.connections if c.name == "dev-identity").ok is True


def test_boot_refuses_when_only_one_connection_is_present(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "dummy")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("MAESTRO_MODEL_BASE_URL", raising=False)
    with pytest.raises(StartupError) as ei:
        boot(db_path=":memory:", allow_example_register=True)
    assert "anthropic" in str(ei.value)
    assert "github" not in str(ei.value)            # github passed; only anthropic is named
