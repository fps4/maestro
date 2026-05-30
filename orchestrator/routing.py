"""The split-review routing resolver (ADR-0003) — a pure function, never hardcoded.

Resolves ``(product_type, gate_type) → role`` from ``config/reviewers.yaml``, then ``role → the
product's participants holding it``. The merge boundary (ADR-0016) uses this to answer the only
question that authorises a merge: *does the approver hold the gate's role for this product?*

The merge gate is a **technical** gate (it reviews the PR diff — reviewers.yaml ``routing.technical``,
data-model.md). A missing ``product_type`` defaults to ``technical`` (architect reviews everything),
matching the orchestrator's documented failure mode (ADR-0003).
"""
import os
import pathlib
from typing import Optional

import yaml

from orchestrator.register import Participant, Product

DEFAULT_REVIEWERS = "config/reviewers.yaml"

# Which routing key in reviewers.yaml governs each gate (data-model.md gate types).
_GATE_ROUTING_KEY = {
    "functional": "functional",
    "technical_design": "technical",
    "technical_merge": "technical",
    "technical": "technical",
}


class RoutingResolver:
    def __init__(self, matrix: dict):
        self._matrix = matrix

    @classmethod
    def load(cls, path: Optional[str] = None) -> "RoutingResolver":
        chosen = path or os.environ.get("REVIEWERS_CONFIG", DEFAULT_REVIEWERS)
        data = yaml.safe_load(pathlib.Path(chosen).read_text()) or {}
        return cls(data)

    def role_for(self, product_type: Optional[str], gate: str) -> str:
        """Resolve the reviewer role for a gate. Pure: depends only on the loaded matrix."""
        ptype = product_type or self._matrix.get("defaults", {}).get("product_type", "technical")
        key = _GATE_ROUTING_KEY.get(gate)
        if key is None:
            raise ValueError(f"unknown gate type {gate!r}")
        routing = self._matrix.get("routing", {}).get(key, {})
        # Unknown product_type → default to technical (architect reviews everything; ADR-0003).
        return routing.get(ptype, routing.get("technical", "architect"))

    def eligible_deciders(self, product: Product, gate: str) -> list[Participant]:
        """The participants who may decide this gate: holders of the resolved role for the product."""
        role = self.role_for(product.product_type, gate)
        return product.role_holders(role)

    def refinement_cap(self) -> int:
        """Max ``request_changes`` → re-draft cycles allowed on a gate before the task is blocked
        (US-0024 H2). Read from ``gate.max_refinement_iterations``; defaults to 5, floored at 1 so a
        zero/negative misconfiguration can never block a task on its first request_changes."""
        raw = self._matrix.get("gate", {}).get("max_refinement_iterations", 5)
        try:
            return max(1, int(raw))
        except (TypeError, ValueError):
            return 5
