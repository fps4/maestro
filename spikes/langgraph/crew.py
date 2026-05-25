"""Bounded-role crew for the spike.

Each agent reasons only through the single ModelClient (ADR-0002). Roles are distinct instances, so
the reviewer ≠ author boundary (ADR-0004) is representable and checkable by id. This is what we want
to confirm fits under a LangGraph runtime: a bounded-role crew + subagent fan-out, not one generalist.
"""
import itertools


class Agent:
    _ids = itertools.count(1)

    def __init__(self, role, model):
        self.id = f"{role}-{next(Agent._ids)}"
        self.role = role
        self.model = model

    def run(self, prompt: str) -> str:
        return self.model.complete(self.role, prompt)


class Crew:
    """One instance per role per run — so builder and reviewer are inherently different agents."""

    def __init__(self, model):
        self.model = model
        self._byrole = {}

    def agent(self, role: str) -> Agent:
        return self._byrole.setdefault(role, Agent(role, self.model))
