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
    "task.dispatched": "intake",          # workspace "new task" entry point (US-0010 Q2; workspace-write-api.md)
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

# Which event opens which gate (data-model.md GateType). The opener's seq becomes the gate's
# ``open_gates[type].seq`` — the monotonic counter the workspace sends back as ``If-Match`` when it
# decides the gate (workspace-write-api.md §optimistic-concurrency).
_GATE_OPENER: dict[str, str] = {
    "spec.drafted": "functional",
    "design.produced": "technical_design",
    "pr.opened": "technical_merge",
}


@dataclass
class GateDecision:
    gate: str
    decision: str            # approve | request_changes | reject
    resolved_by: Optional[str]
    resolved_at: Optional[float]
    seq: int


@dataclass
class Comment:
    """An anchored human remark on a task (data-model.md). Projected from ``comment.posted`` events.

    Append-only: every event is immutable; supersession is by a new comment, not an edit. Anchored
    where possible (workspace-ux-design.md P4); ``anchor`` is None for free-floating fallback.
    """
    comment_id: str
    author: Optional[str]
    body: str
    anchor: Optional[dict]
    in_reply_to: Optional[str]
    created_at: float
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
    comments: list[Comment] = field(default_factory=list)
    # Currently-pending gates by type: ``{type: {gate_id, seq, opened_at}}``. An entry appears when a
    # producing event lands (``spec.drafted`` / ``design.produced`` / ``pr.opened``) and is popped on
    # the first ``gate.decided`` for that type — so a request-changes that re-opens the producing
    # stage will repopulate the entry when the next opener event lands (workspace-write-api.md).
    open_gates: dict[str, dict] = field(default_factory=dict)
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

    if etype in _GATE_OPENER:
        gate_type = _GATE_OPENER[etype]
        # Gate id: opaque from the opener's seq so it's deterministic and content-addressed. The
        # workspace round-trips this as ``{gate_id}`` in decision URLs; for M1 the gate type slug is
        # accepted too (workspace-write-api.md §gate-id-shape) — same gate either way.
        t.open_gates[gate_type] = {
            "gate_id": f"gate-{seq:04x}",
            "type": gate_type,
            "seq": seq,
            "opened_at": e["ts"],
        }

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
    elif etype in ("gate.resolved", "gate.decided"):
        # Two event shapes flow through the same projection. ``gate.resolved`` was M0's legacy form
        # (decision nested under ``payload.decision`` with ``by``); ``gate.decided`` is the M1
        # workspace-write-api form (decision is a flat string, attribution is ``attributed_to``).
        decision_field = payload.get("decision")
        if isinstance(decision_field, dict):
            verdict = decision_field.get("decision")
            resolver = decision_field.get("by")
        else:
            verdict = decision_field or payload.get("verdict")
            resolver = (payload.get("attributed_to") or {}).get("email") or payload.get("by")
        gate = payload.get("gate") or payload.get("type")
        t.gates.append(GateDecision(
            gate=gate,
            decision=verdict,
            resolved_by=resolver,
            resolved_at=e["ts"],
            seq=seq,
        ))
        # Close the open gate of this type — the next opener (after a request-changes redraft) will
        # repopulate ``open_gates`` from scratch with a fresh ``seq``.
        t.open_gates.pop(gate, None)
        if verdict == "reject":
            t.status = "cancelled"
        elif verdict == "request_changes" and gate in _REVISE_STAGE:
            t.stage = _REVISE_STAGE[gate]
            t.status = "active"
    elif etype == "task.blocked":
        t.status = "blocked"
    elif etype == "comment.posted":
        # Comments don't advance state — they're a parallel narrative on the task.
        t.comments.append(Comment(
            comment_id=payload.get("comment_id"),
            author=payload.get("attributed_to", {}).get("email") or e.get("actor"),
            body=payload.get("body", ""),
            anchor=payload.get("anchor"),
            in_reply_to=payload.get("in_reply_to"),
            created_at=e["ts"],
            seq=seq,
        ))
