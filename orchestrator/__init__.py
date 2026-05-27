"""The conductor (ADR-0014): sequences the crew, owns task/gate state as an event-sourced log,
resolves reviewer routing, and performs no LLM inference.

This package holds the authoritative layer — the append-only event log and its projection
(ADR-0008/0009). The LangGraph runtime that drives the stages layers on top of it, with the
event log staying the source of truth and the checkpointer a rebuildable cache (ADR-0014).
"""
