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

# Which **agent** re-opens which gate via ``agent_response.posted`` (ADR-0022). The agent kind is in
# the event's payload (``payload.agent``), not the type, so this is a separate dispatch from
# ``_GATE_OPENER``: the projection looks up the gate type by the agent's name.
_GATE_REOPENER_BY_AGENT: dict[str, str] = {
    "spec": "functional",
    "design": "technical_design",
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
class AgentResponse:
    """One refinement cycle's closure — projected from ``agent_response.posted`` (ADR-0022).

    The reviewer's next visit on this task defaults to the **diff-of-artefact since their last
    review**, with per-anchor replies inline (workspace-ux-design.md §refinement-loop). This
    record carries everything that view needs: the bundle this responds to, the new artefact ref,
    the summary the reviewer reads first, and the per-anchor address list."""
    bundle_id: str
    task_id: str
    agent: str                          # spec | design
    artefact_kind: str                  # functional_spec | technical_design
    summary_of_changes: str
    addresses: list[dict]               # one per bundle item, in bundle order
    ref: dict                           # {repo, branch, path, commit} of the new commit
    emitted_at: float
    seq: int


@dataclass
class ArtefactPublished:
    """Every artefact commit on a task — projected from producer events (``spec.drafted`` /
    ``design.produced``) and refinement responses (``agent_response.posted``).

    Two `ArtefactPublished` entries for the same `(kind, path)` are adjacent commits the
    workspace's **diff-of-artefact view** renders side-by-side: the previous (the architect's
    last review) vs. the current (the redrafted version). The chain across cycles is the natural
    timeline the reviewer reads."""
    agent: str                          # spec | design
    kind: str                           # functional_spec | technical_design
    feature: Optional[str]
    ref: dict                           # {repo, branch, path, commit}
    via: str                            # "producer" (spec.drafted/design.produced) | "response" (agent_response.posted)
    published_at: float
    seq: int


@dataclass
class StoredArtefact:
    """An artefact whose **bytes live in the `ArtifactStore`** (US-0023/US-0033) — a PR-diff
    snapshot, a test report, an SBOM, or a spec/design copy. Distinct from
    :class:`ArtefactPublished` (which references markdown committed to the *repo* for the
    diff-of-artefact view): this is the per-task **artefacts index** the workspace browser renders,
    each entry resolvable to short-TTL presigned content through the store (US-0033 AC #1/#2).

    Projected from ``artifact.stored`` events. The event log carries ``storage_uri + sha256`` and the
    store key — and **only** those references (ADR-0008/0009); the store holds the bytes."""
    kind: str                           # pr_diff | test_report | sbom | diff_snapshot | functional_spec | technical_design
    key: str                            # the ArtifactStore object key (the read endpoint mints a presigned URL for it)
    name: str                           # display name for the index (defaults to the key's basename)
    product_id: Optional[str]
    storage_uri: str
    sha256: str
    content_type: str
    size: int
    source: Optional[dict]              # what produced it — {event, seq} / {agent} (audit breadcrumb)
    stored_at: float
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
    # One AgentResponse per refinement cycle the crew closed (ADR-0022). Chronological by ``seq``.
    agent_responses: list[AgentResponse] = field(default_factory=list)
    # Every artefact commit on this task — producer events + agent responses — so the workspace
    # can chain adjacent (kind, path) refs into a diff-of-artefact view without re-walking the log.
    artefacts: list[ArtefactPublished] = field(default_factory=list)
    # The per-task artefacts index (US-0033): artefacts whose bytes live in the ArtifactStore,
    # projected from ``artifact.stored`` events, in chronological order. Each is resolvable to
    # short-TTL presigned content through the read API's artefact endpoint.
    stored_artefacts: list[StoredArtefact] = field(default_factory=list)
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
        # Record the producer-event's artefact ref into the chronological artefacts list so the
        # diff-of-artefact view can chain it with the next agent_response.posted (a re-draft after
        # request_changes). Only producer events that carry a ref participate; pr.opened does not
        # produce a spec/design artefact, so it is excluded.
        if etype in ("spec.drafted", "design.produced"):
            t.artefacts.append(ArtefactPublished(
                agent=payload.get("agent") or ("spec" if etype == "spec.drafted" else "design"),
                kind=payload.get("kind")
                     or ("functional_spec" if etype == "spec.drafted" else "technical_design"),
                feature=payload.get("feature"),
                ref=dict(payload.get("ref") or {}),
                via="producer",
                published_at=e["ts"],
                seq=seq,
            ))

    if etype == "artifact.stored":
        # An artefact's bytes landed in the ArtifactStore (US-0033). Record the reference into the
        # per-task artefacts index; the read API mints a presigned URL per request from the key.
        key = payload.get("key") or ""
        t.stored_artefacts.append(StoredArtefact(
            kind=payload.get("kind") or "artefact",
            key=key,
            name=payload.get("name") or key.rsplit("/", 1)[-1] or key,
            product_id=payload.get("product_id"),
            storage_uri=payload.get("storage_uri") or "",
            sha256=payload.get("sha256") or "",
            content_type=payload.get("content_type") or "application/octet-stream",
            size=int(payload.get("size") or 0),
            source=payload.get("source"),
            stored_at=e["ts"],
            seq=seq,
        ))

    if etype == "pr.opened":
        t.pr = {"repo": payload.get("repo"), "number": payload.get("pr_number"),
                "url": payload.get("pr_url"), "draft": payload.get("draft", False)}
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
    elif etype == "agent_response.posted":
        # ADR-0022 closure of one refinement cycle. Three effects:
        # 1. record the response so the workspace can render the diff-of-artefact view + per-
        #    anchor replies inline (US-0031 / US-0032 §refinement-loop step 4);
        # 2. add the new artefact ref to ``artefacts`` so the diff view can chain it with the
        #    immediately-prior ArtefactPublished for the same (kind, path) — without re-walking
        #    the log;
        # 3. re-open the gate (functional for spec, technical_design for design) so the architect
        #    sees a fresh pending state on the new artefact. The opener's seq is this event's seq
        #    — the monotonic counter the workspace round-trips as ``If-Match`` on the next
        #    decision (workspace-write-api.md §optimistic-concurrency).
        t.agent_responses.append(AgentResponse(
            bundle_id=payload.get("bundle_id"),
            task_id=payload.get("task_id") or e["run_id"],
            agent=payload.get("agent"),
            artefact_kind=payload.get("kind"),
            summary_of_changes=payload.get("summary_of_changes", ""),
            addresses=list(payload.get("addresses") or []),
            ref=dict(payload.get("ref") or {}),
            emitted_at=e["ts"],
            seq=seq,
        ))
        t.artefacts.append(ArtefactPublished(
            agent=payload.get("agent"),
            kind=payload.get("kind"),
            feature=payload.get("feature"),
            ref=dict(payload.get("ref") or {}),
            via="response",
            published_at=e["ts"],
            seq=seq,
        ))
        gate_type = _GATE_REOPENER_BY_AGENT.get(payload.get("agent"))
        if gate_type is not None:
            t.open_gates[gate_type] = {
                "gate_id": f"gate-{seq:04x}",
                "type": gate_type,
                "seq": seq,
                "opened_at": e["ts"],
            }
            # The producing stage closes; we're back at the gate for the matching stage.
            stage_by_gate = {
                "functional": "functional_gate",
                "technical_design": "technical_gate",
            }
            t.stage = stage_by_gate.get(gate_type, t.stage)
