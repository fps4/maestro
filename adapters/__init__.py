"""Adapters — maestro's edges to the outside world (GitHub, Slack, Telegram).

Adapters are deterministic I/O, not reasoning: they carry no LLM inference. The github adapter's
merge action is the load-bearing safety boundary (ADR-0016).
"""
