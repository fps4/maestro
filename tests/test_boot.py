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
    engine = boot(db_path=":memory:", allow_example_register=True)
    assert engine.github is not None                # the adapter is wired
    assert {c.name for c in engine.connections} == {"github", "anthropic", "slack"}
    assert next(c for c in engine.connections if c.name == "slack").ok is None  # declared, skipped


def test_boot_refuses_when_only_one_connection_is_present(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "dummy")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("MAESTRO_MODEL_BASE_URL", raising=False)
    with pytest.raises(StartupError) as ei:
        boot(db_path=":memory:", allow_example_register=True)
    assert "anthropic" in str(ei.value)
    assert "github" not in str(ei.value)            # github passed; only anthropic is named
