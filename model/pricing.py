"""Price card — turns token counts into a USD cost for the per-call audit (ADR-0009).

Prices are USD per 1M tokens. Cache-accounting convention (one, to avoid the known Anthropic
double-count, ADR-0009): ``input_tokens`` is the count of *uncached* input tokens only; cached reads
and writes are billed separately at their own rates and are NEVER also counted in ``input_tokens``.
The provider's ``input_tokens`` already excludes cache reads, so we pass it through as-is.

This is a starting card; keep it in config/secrets later. Models are addressed by tier elsewhere —
this maps the resolved model id to its rate.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Rate:
    input: float          # per 1M uncached input tokens
    output: float         # per 1M output tokens
    cache_write: float    # per 1M cache-write tokens
    cache_read: float     # per 1M cache-read tokens


# Indicative rates (USD / 1M tokens). Update from the live price card; unknown models fall back below.
_CARD: dict[str, Rate] = {
    "claude-opus-4-7":    Rate(input=15.0, output=75.0, cache_write=18.75, cache_read=1.50),
    "claude-sonnet-4-6":  Rate(input=3.0,  output=15.0, cache_write=3.75,  cache_read=0.30),
    "claude-haiku-4-5":   Rate(input=0.80, output=4.0,  cache_write=1.0,   cache_read=0.08),
}

_FALLBACK = Rate(input=3.0, output=15.0, cache_write=3.75, cache_read=0.30)


def cost_usd(model: str, input_tokens: int, output_tokens: int,
             cache_read: int = 0, cache_write: int = 0) -> float:
    """Compute call cost. ``input_tokens`` must be uncached-only (cache reads counted separately)."""
    r = _CARD.get(model, _FALLBACK)
    total = (
        input_tokens * r.input
        + output_tokens * r.output
        + cache_write * r.cache_write
        + cache_read * r.cache_read
    ) / 1_000_000
    return round(total, 6)
