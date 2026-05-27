"""The single ``ModelClient`` — maestro's only LLM egress (ADR-0002).

Every agent reasons through this one client; **no other module imports a provider SDK** (the
``anthropic`` import lives here and nowhere else). It calls the Anthropic API *directly by default* so
native prompt caching, extended thinking, and tool use are preserved — an OpenAI-compat detour would
defeat ADR-0002. Pointing it at a compatible router is a **config** change (``MAESTRO_MODEL_BASE_URL``),
never a code change.

Models are addressed **by tier** (``fast`` | ``standard`` | ``strong``), never by hardcoded name
(standards/patterns.yaml); the tier→model map is overridable by env. Every call — success or failure —
is recorded to the LLM audit (ADR-0009) before its result (or error) is returned.
"""
import os
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional

from model.audit import LLMAudit, LLMCall
from model.pricing import cost_usd

# Tier → default model. Overridable via env so a model bump is config, not code (ADR-0002).
_DEFAULT_TIER_MODELS = {
    "fast": "claude-haiku-4-5",
    "standard": "claude-sonnet-4-6",
    "strong": "claude-opus-4-7",
}
_TIER_ENV = {"fast": "MAESTRO_MODEL_FAST", "standard": "MAESTRO_MODEL_STANDARD",
             "strong": "MAESTRO_MODEL_STRONG"}


@dataclass
class ModelResult:
    text: str
    call: LLMCall          # the audit record for this call
    stop_reason: Optional[str]
    raw: Any = None        # the provider response, for callers needing tool-use blocks etc.


class ModelClient:
    def __init__(self, audit: LLMAudit, client_factory: Optional[Callable[[], Any]] = None):
        """``audit`` is the sink every call is written to. ``client_factory`` builds the provider
        client lazily (injectable for tests so no network/SDK is needed); the default constructs the
        Anthropic SDK honouring ``MAESTRO_MODEL_BASE_URL``."""
        self._audit = audit
        self._client_factory = client_factory or _default_anthropic_factory
        self._client = None

    def model_for(self, tier: str) -> str:
        if tier not in _DEFAULT_TIER_MODELS:
            raise ValueError(f"unknown tier {tier!r}; choose one of {list(_DEFAULT_TIER_MODELS)}")
        return os.environ.get(_TIER_ENV[tier], _DEFAULT_TIER_MODELS[tier])

    def complete(self, agent: str, run_id: str, *, tier: str = "standard",
                 messages: Optional[list[dict]] = None, prompt: Optional[str] = None,
                 system: Optional[str] = None, max_tokens: int = 1024, **kwargs) -> ModelResult:
        """Make one model call and record it. Pass ``**kwargs`` straight through (e.g. ``thinking=``,
        ``tools=``) so native Claude features are preserved. Either ``messages`` or ``prompt``."""
        model = self.model_for(tier)
        if messages is None:
            if prompt is None:
                raise ValueError("provide either messages= or prompt=")
            messages = [{"role": "user", "content": prompt}]

        t0 = time.perf_counter()
        try:
            resp = self._provider().messages.create(
                model=model, max_tokens=max_tokens, messages=messages,
                **({"system": system} if system else {}), **kwargs,
            )
        except Exception as exc:
            # ADR-0021/US-0021: still record the attempt before surfacing the failure.
            latency_ms = int((time.perf_counter() - t0) * 1000)
            self._audit.record(LLMCall(run_id=run_id, agent=agent, model=model, tier=tier,
                                       latency_ms=latency_ms, finish_reason="error", error=str(exc)))
            raise

        latency_ms = int((time.perf_counter() - t0) * 1000)
        usage = _usage(resp)
        call = LLMCall(
            run_id=run_id, agent=agent, model=model, tier=tier,
            input_tokens=usage["input_tokens"], output_tokens=usage["output_tokens"],
            cache_read=usage["cache_read"], cache_write=usage["cache_write"],
            cost_usd=cost_usd(model, usage["input_tokens"], usage["output_tokens"],
                              usage["cache_read"], usage["cache_write"]),
            latency_ms=latency_ms, finish_reason=getattr(resp, "stop_reason", None),
        )
        self._audit.record(call)
        return ModelResult(text=_text(resp), call=call,
                           stop_reason=getattr(resp, "stop_reason", None), raw=resp)

    def _provider(self):
        if self._client is None:
            self._client = self._client_factory()
        return self._client


def _usage(resp: Any) -> dict:
    """Extract token usage with the single cache convention (ADR-0009): ``input_tokens`` is the
    provider's already-uncached count; cache read/write are distinct keys, never folded into input."""
    u = getattr(resp, "usage", None)
    g = (lambda name: getattr(u, name, 0) or 0) if u is not None else (lambda name: 0)
    return {
        "input_tokens": g("input_tokens"),
        "output_tokens": g("output_tokens"),
        "cache_read": g("cache_read_input_tokens"),
        "cache_write": g("cache_creation_input_tokens"),
    }


def _text(resp: Any) -> str:
    content = getattr(resp, "content", None)
    if not content:
        return ""
    parts = [getattr(b, "text", "") for b in content if getattr(b, "type", None) == "text"]
    return "".join(parts)


def _default_anthropic_factory():
    import anthropic  # the ONLY provider-SDK import in maestro (ADR-0002)
    base_url = os.environ.get("MAESTRO_MODEL_BASE_URL")  # optional compatible-router escape hatch
    return anthropic.Anthropic(**({"base_url": base_url} if base_url else {}))
