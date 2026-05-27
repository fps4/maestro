"""The single LLM egress (ADR-0002): the only place that calls a model provider.

No other package imports a provider SDK directly — they reach Claude through `ModelClient`.
"""

from model.client import ModelClient, ModelResult

__all__ = ["ModelClient", "ModelResult"]
