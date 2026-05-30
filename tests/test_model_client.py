"""The single audited LLM egress (US-0021, ADR-0002/0009). LLM mocked — contract layer, no network."""
import pytest

from model.client import CostCapExceeded, ModelClient
from tests.conftest import FakeProvider, _Resp


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


# --- US-0024 M7: prompt provenance on every call ------------------------------------------------

def test_prompt_provenance_is_recorded(audit, model_factory):
    model, _ = model_factory(audit, resp=_Resp(text="ok"))
    model.complete(agent="spec", run_id="r1", tier="standard", prompt="hi",
                   prompt_template_id="spec-agent", prompt_template_version="abc123")
    row = audit.read("r1")[0]
    assert row["prompt_template_id"] == "spec-agent"
    assert row["prompt_template_version"] == "abc123"


def test_prompt_provenance_recorded_even_on_failure(audit, model_factory):
    model, _ = model_factory(audit, error=RuntimeError("boom"))
    with pytest.raises(RuntimeError):
        model.complete(agent="spec", run_id="r2", tier="fast", prompt="hi",
                       prompt_template_id="spec-agent", prompt_template_version="v9")
    row = audit.read("r2")[0]
    assert row["prompt_template_id"] == "spec-agent"
    assert row["prompt_template_version"] == "v9"


# --- US-0024 M9: a provider error that echoes a secret is redacted before it is stored ----------

def test_error_text_is_redacted_before_persistence(audit):
    leak = RuntimeError("auth failed for token sk-ant-SUPERSECRETKEY0123456789 on user a@b.com")
    model = ModelClient(audit, client_factory=lambda: FakeProvider(error=leak))
    with pytest.raises(RuntimeError):
        model.complete(agent="spec", run_id="r3", tier="fast", prompt="hi")
    stored = audit.read("r3")[0]["error"]
    assert "SUPERSECRETKEY" not in stored
    assert "a@b.com" not in stored
    assert "[REDACTED]" in stored


# --- US-0024 H2: budget caps hard-refuse before the provider is hit -----------------------------

def test_per_run_cap_refuses_once_spend_reaches_it(audit):
    provider = FakeProvider(resp=_Resp(text="ok", input_tokens=1000, output_tokens=500))
    model = ModelClient(audit, client_factory=lambda: provider, per_run_usd_cap=1e-9)
    # First call goes through (no prior spend), recording a positive cost.
    model.complete(agent="spec", run_id="r1", tier="standard", prompt="hi")
    assert audit.spend(run_id="r1") > 0
    # The next call on the same run is hard-refused — the provider is not hit a second time.
    before = len(provider.calls)
    with pytest.raises(CostCapExceeded) as ei:
        model.complete(agent="spec", run_id="r1", tier="standard", prompt="again")
    assert ei.value.scope == "per-run"
    assert len(provider.calls) == before                  # no provider call was made


def test_per_run_cap_does_not_affect_a_different_run(audit):
    provider = FakeProvider(resp=_Resp(text="ok", input_tokens=1000, output_tokens=500))
    model = ModelClient(audit, client_factory=lambda: provider, per_run_usd_cap=1e-9)
    model.complete(agent="spec", run_id="r1", tier="standard", prompt="hi")
    # A fresh run has zero recorded spend, so it is not blocked by r1's spend.
    res = model.complete(agent="spec", run_id="r2", tier="standard", prompt="hi")
    assert res.text == "ok"


def test_per_day_cap_from_env_refuses(audit, monkeypatch):
    monkeypatch.setenv("MAESTRO_PER_DAY_USD_CAP", "0.0000001")
    provider = FakeProvider(resp=_Resp(text="ok", input_tokens=1000, output_tokens=500))
    model = ModelClient(audit, client_factory=lambda: provider)   # cap read from env per-call
    model.complete(agent="spec", run_id="r1", tier="standard", prompt="hi")
    with pytest.raises(CostCapExceeded) as ei:
        model.complete(agent="spec", run_id="r2", tier="standard", prompt="hi")  # different run, same day
    assert ei.value.scope == "per-day"


def test_uncapped_by_default(audit):
    provider = FakeProvider(resp=_Resp(text="ok", input_tokens=1000, output_tokens=500))
    model = ModelClient(audit, client_factory=lambda: provider)
    for i in range(3):
        assert model.complete(agent="spec", run_id="r1", tier="standard", prompt="hi").text == "ok"
