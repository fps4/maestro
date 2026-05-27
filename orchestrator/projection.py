"""Project the event log into current state (CQRS read side; ADR-0008).

The event log is authoritative; this reducer folds it into the current ``DeliveryTask`` state so the
orchestrator can rehydrate after a restart (US-0020) — no separate mutable state is trusted. The same
projection underlies the LangGraph checkpointer reconciliation (ADR-0014): the checkpointer is a cache,
this is the truth.

One delivery task corresponds to one ``run_id`` (the correlation id, per data-model.md). The stage
machine mirrors ``DeliveryTask.stage`` in data-model.md; only the transitions the engine emits today
are wired — adding M1/M2 stages is adding cases here, not changing the log.
"""
from dataclasses import dataclass, field
from typing import Optional

# Forward stage transition on a producing event (data-model.md DeliveryTask.stage).
_STAGE_ON: dict[str, str] = {
    "task.created": "intake",
    "spec.drafted": "functional_gate",
    "design.produced": "technical_gate",
    "pr.opened": "merge_gate",
    "merge.executed": "done",
}

# Which stage a request-changes at a gate returns the task to (the producer of the artifact).
_REVISE_STAGE: dict[str, str] = {
    "functional": "intake",
    "technical_design": "design",
    "technical_merge": "build",
}


@dataclass
class GateDecision:
    gate: str
    decision: str            # approve | request_changes | reject
    resolved_by: Optional[str]
    resolved_at: Optional[float]
    seq: int


@dataclass
class TaskState:
    task_id: str             # == run_id
    stage: str = "intake"
    status: str = "active"   # active | blocked | cancelled | done
    branch: Optional[str] = None
    pr: Optional[dict] = None              # {repo, number, url}
    merged: bool = False
    gates: list[GateDecision] = field(default_factory=list)
    # merge-approval events, by their seq, and which have been consumed by a merge.executed (anti-replay).
    merge_approvals: dict[int, dict] = field(default_factory=dict)
    consumed_approvals: set[int] = field(default_factory=set)


def project(events: list[dict]) -> dict[str, TaskState]:
    """Fold every event into a ``{task_id: TaskState}`` map, in chain order."""
    tasks: dict[str, TaskState] = {}
    for e in sorted(events, key=lambda e: e["seq"]):
        run_id = e["run_id"]
        t = tasks.setdefault(run_id, TaskState(task_id=run_id))
        _apply(t, e)
    return tasks


def project_task(events: list[dict], run_id: str) -> Optional[TaskState]:
    """Rehydrate a single task's current state from the log alone."""
    return project([e for e in events if e["run_id"] == run_id]).get(run_id)


def _apply(t: TaskState, e: dict) -> None:
    etype, payload, seq = e["type"], e["payload"], e["seq"]

    if etype in _STAGE_ON:
        t.stage = _STAGE_ON[etype]

    if etype == "pr.opened":
        t.pr = {"repo": payload.get("repo"), "number": payload.get("pr_number"),
                "url": payload.get("pr_url")}
        if payload.get("branch"):
            t.branch = payload["branch"]
    elif etype == "branch.created":
        t.branch = payload.get("branch")
    elif etype == "merge-approval":
        t.merge_approvals[seq] = e
    elif etype == "merge.executed":
        t.merged = True
        t.status = "done"
        consumed = payload.get("approval_seq")
        if consumed is not None:
            t.consumed_approvals.add(consumed)
    elif etype == "gate.resolved":
        decision = payload.get("decision", {})
        verdict = decision.get("decision") if isinstance(decision, dict) else payload.get("verdict")
        gate = payload.get("gate")
        t.gates.append(GateDecision(
            gate=gate,
            decision=verdict,
            resolved_by=(decision.get("by") if isinstance(decision, dict) else payload.get("by")),
            resolved_at=e["ts"],
            seq=seq,
        ))
        if verdict == "reject":
            t.status = "cancelled"
        elif verdict == "request_changes" and gate in _REVISE_STAGE:
            t.stage = _REVISE_STAGE[gate]
            t.status = "active"
    elif etype == "task.blocked":
        t.status = "blocked"
