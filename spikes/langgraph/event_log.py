"""Append-only event log — maestro's operational source of truth (ADR-0008/0009).

Deliberately SEPARATE from LangGraph's checkpointer: the checkpointer holds execution/recovery
state; this log holds domain events (and would be the audit/traceability tier). The spike keeps both
so we can judge whether they coexist cleanly or duplicate responsibility.
"""
import json
import pathlib
import time


class EventLog:
    def __init__(self, path):
        self.path = pathlib.Path(path)
        self._seq = sum(1 for _ in self.path.open()) if self.path.exists() else 0

    def append(self, run_id: str, actor: str, type: str, payload: dict) -> None:
        self._seq += 1
        rec = {"seq": self._seq, "run_id": run_id, "ts": round(time.time(), 3),
               "actor": actor, "type": type, "payload": payload}
        with self.path.open("a") as fh:
            fh.write(json.dumps(rec) + "\n")
