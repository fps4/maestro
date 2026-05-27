"""The single audited LLM egress (US-0021, ADR-0002/0009). LLM mocked — contract layer, no network."""
import pytest

from tests.conftest import _Resp


def test_successful_call_is_recorded_with_distinct_cache_keys(audit, model_factory):
    model, _ = model_factory(audit, resp=_Resp(text="ok", input_tokens=100, output_tokens=20,
                                                cache_read=40, cache_write=10))
    res = model.complete(agent="spec-1", run_id="r1", tier="standard", prompt="hi")
    assert res.text == "ok"
    rows = audit.read("r1")
    assert len(rows) == 1
    row = rows[0]
    assert (row["input_tokens"], row["output_tokens"]) == (100, 20)
    assert (row["cache_read"], row["cache_write"]) == (40, 10)   # distinct keys, not folded into input
    assert row["cost_usd"] > 0
    assert row["finish_reason"] == "end_turn"
    assert row["error"] is None
    assert row["agent"] == "spec-1"


def test_failed_call_is_still_recorded_then_reraised(audit, model_factory):
    model, _ = model_factory(audit, error=RuntimeError("boom"))
    with pytest.raises(RuntimeError, match="boom"):
        model.complete(agent="spec-1", run_id="r2", tier="fast", prompt="hi")
    rows = audit.read("r2")
    assert len(rows) == 1                       # the attempt is recorded before surfacing (US-0021)
    assert rows[0]["finish_reason"] == "error"
    assert "boom" in rows[0]["error"]


def test_model_is_selected_by_tier_never_hardcoded(audit, model_factory):
    model, _ = model_factory(audit)
    assert model.model_for("fast").startswith("claude-haiku")
    assert model.model_for("standard").startswith("claude-sonnet")
    assert model.model_for("strong").startswith("claude-opus")
    with pytest.raises(ValueError):
        model.model_for("turbo")


def test_tier_model_is_overridable_by_env(audit, model_factory, monkeypatch):
    monkeypatch.setenv("MAESTRO_MODEL_STANDARD", "claude-sonnet-9-9")
    model, _ = model_factory(audit)
    assert model.model_for("standard") == "claude-sonnet-9-9"   # config, not code (ADR-0002)


def test_native_feature_kwargs_pass_through_to_the_provider(audit, model_factory):
    model, provider = model_factory(audit)
    model.complete(agent="a", run_id="r", tier="standard", system="be terse",
                   messages=[{"role": "user", "content": "x"}],
                   max_tokens=256, thinking={"type": "enabled", "budget_tokens": 100})
    sent = provider.calls[-1]
    assert sent["system"] == "be terse"
    assert sent["max_tokens"] == 256
    assert sent["thinking"] == {"type": "enabled", "budget_tokens": 100}   # extended thinking preserved
    assert sent["model"].startswith("claude-sonnet")
