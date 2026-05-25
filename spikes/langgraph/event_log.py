"""Append-only event log — maestro's operational source of truth + audit tier (ADR-0008/0009).

Kept SEPARATE from LangGraph's checkpointer: the checkpointer holds execution/recovery state (a
rebuildable cache); this log holds the authoritative domain history. `replay()` folds the log back
into current state (CQRS) — proving the log, not the checkpointer, is the source of truth.
"""
import json
import pathlib
import time


class EventLog:
    def __init__(self, path):
        self.path = pathlib.Path(path)
        self._seq = len(self.read())

    def append(self, run_id: str, actor: str, type: str, payload: dict) -> None:
        self._seq += 1
        rec = {"seq": self._seq, "run_id": run_id, "ts": round(time.time(), 3),
               "actor": actor, "type": type, "payload": payload}
        with self.path.open("a") as fh:
            fh.write(json.dumps(rec) + "\n")

    def read(self) -> list:
        if not self.path.exists():
            return []
        return [json.loads(line) for line in self.path.read_text().splitlines() if line.strip()]


def replay(events: list) -> dict:
    """Reconstruct a delivery task's current state from its events alone — no checkpointer needed."""
    state = {"stage": "intake", "artifacts": [], "decisions": [], "reviews": [], "pr_url": None}
    for e in sorted(events, key=lambda e: e["seq"]):
        t, p = e["type"], e["payload"]
        if t == "spec.drafted":
            state["stage"] = "functional_gate"; state["artifacts"].append("spec")
        elif t == "design.produced":
            state["stage"] = "technical_gate"; state["artifacts"].append("design")
        elif t == "pr.opened":
            state["pr_url"] = p["pr_url"]; state["stage"] = "merge_gate"
        elif t == "review.posted":
            state["reviews"].append({"by": p["by"], "author": p["author"], "findings": p["findings"]})
        elif t == "gate.resolved":
            state["decisions"].append({"gate": p["gate"], **p["decision"]})
        elif t == "task.done":
            state["stage"] = "done"
    return state
