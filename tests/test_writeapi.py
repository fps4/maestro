"""The workspace write API service core (workspace-write-api.md) — dispatch + comments + decisions.

Covers the M1 flows:

* ``POST /api/products/{p}/tasks`` — role check (architect-only in M1), validation
  (empty/oversize intent, repo ownership), per-product isolation (404 not 403 for unknown product),
  event emission shape, idempotency contract.
* ``POST /api/products/{p}/tasks/{t}/comments`` — any-participant role; task lookup; per-product
  isolation by product-id mismatch; anchor shape validation; in_reply_to consistency;
  ``comment.posted`` event emission and projection.
* ``POST /api/products/{p}/tasks/{t}/gates/{gate_id}/decisions`` — role authorization via
  :class:`RoutingResolver` (US-0012), required ``Idempotency-Key`` + ``If-Match``, ``gate.decided``
  event shape, ``request_changes`` → ``feedback_bundle.created`` snapshot, terminal effects
  (approve advances stage; reject cancels; request_changes returns to producer).
"""
import pytest

from orchestrator.readapi import NotFound, Unauthenticated
from orchestrator.writeapi import (
    MAX_COMMENT_CHARS,
    MAX_INTENT_CHARS,
    MAX_RATIONALE_CHARS,
    AnchorUnresolved,
    ForbiddenRole,
    GateAlreadyResolved,
    GateStateMoved,
    IdempotencyMismatch,
    ValidationFailed,
)

ARCH = "@arch"
DEV = "@dev"
OUTSIDER = "@nobody"
REPO = "acme/widget"


# --- happy path -----------------------------------------------------------------------------------

def test_dispatch_creates_a_task_with_intake_stage(write_api, events):
    """The architect dispatches against the product; one ``task.dispatched`` event lands; the
    response surfaces the new task id, the targeted repo, the producing event seq, and the href."""
    out = write_api.dispatch_task(ARCH, "maestro", intent="Add CSV export")

    assert out["task_id"] == "run-1"            # deterministic id_factory from conftest
    assert out["product_id"] == "maestro"
    assert out["stage"] == "intake"
    assert out["ref"] == {"repo": REPO, "branch": None, "commit": None}
    assert out["event_seq"] == 1
    assert out["href"] == "/api/products/maestro/tasks/run-1"

    [event] = events.read()
    assert event["type"] == "task.dispatched"
    assert event["run_id"] == "run-1"
    assert event["actor"] == ARCH
    assert event["target"] == "task:run-1"
    assert event["payload"]["task_id"] == "run-1"
    assert event["payload"]["product_id"] == "maestro"
    assert event["payload"]["repo"] == REPO
    assert event["payload"]["intent"] == "Add CSV export"
    assert event["payload"]["attributed_to"] == {
        "email": ARCH, "role": "architect", "product_id": "maestro",
    }


def test_dispatch_advances_the_projection_to_intake(write_api, events):
    """The new ``task.dispatched`` event must map to ``stage=intake`` in the projection (US-0010)."""
    from orchestrator.projection import project_task
    write_api.dispatch_task(ARCH, "maestro", intent="Add CSV export")
    state = project_task(events.read(), "run-1")
    assert state is not None and state.stage == "intake"


def test_dispatch_with_explicit_repo_overrides_the_default(write_api, events):
    """When ``repo`` is given, the writeapi uses it (and validates ownership)."""
    out = write_api.dispatch_task(ARCH, "maestro", intent="Touch X", repo=REPO)
    assert out["ref"]["repo"] == REPO
    assert events.read()[0]["payload"]["repo"] == REPO


# --- role + isolation -----------------------------------------------------------------------------

def test_dispatch_requires_architect_role(write_api):
    """A functional_reviewer is a member of the product but lacks the dispatch authority — 403
    (not 404): the product is visible to them, just not for this write."""
    with pytest.raises(ForbiddenRole):
        write_api.dispatch_task(DEV, "maestro", intent="Try to dispatch")


def test_dispatch_unknown_product_is_404_not_403(write_api):
    """Per-product isolation (ADR-0010/0011) — existence is not revealed to a non-member."""
    with pytest.raises(NotFound):
        write_api.dispatch_task(ARCH, "ghost-product", intent="...")


def test_dispatch_outsider_sees_no_products_as_404(write_api):
    """An outsider (not a participant in *any* product) cannot dispatch into a real product either."""
    with pytest.raises(NotFound):
        write_api.dispatch_task(OUTSIDER, "maestro", intent="...")


def test_dispatch_no_identity_is_unauthenticated(write_api):
    with pytest.raises(Unauthenticated):
        write_api.dispatch_task("", "maestro", intent="...")


# --- validation -----------------------------------------------------------------------------------

def test_dispatch_rejects_empty_intent(write_api):
    with pytest.raises(ValidationFailed):
        write_api.dispatch_task(ARCH, "maestro", intent="")
    with pytest.raises(ValidationFailed):
        write_api.dispatch_task(ARCH, "maestro", intent="   \n  ")


def test_dispatch_rejects_oversize_intent(write_api):
    with pytest.raises(ValidationFailed):
        write_api.dispatch_task(ARCH, "maestro", intent="x" * (MAX_INTENT_CHARS + 1))


def test_dispatch_rejects_repo_not_owned_by_product(write_api):
    with pytest.raises(ValidationFailed):
        write_api.dispatch_task(ARCH, "maestro", intent="...", repo="other-org/other-repo")


def test_dispatch_fails_when_product_has_no_repos(events, routing, idempotency):
    """A product with an empty repos tuple can't accept a dispatch (no target)."""
    from orchestrator.register import Participant, Product, Register
    from orchestrator.writeapi import WriteAPI
    register = Register(products={
        "barren": Product(id="barren", name="barren", product_type="technical", visibility="public",
                          repos=(),
                          participants=(Participant(handle="@arch", role="architect"),)),
    })
    api = WriteAPI(register, events, routing, idempotency, id_factory=lambda: "run-X")
    with pytest.raises(ValidationFailed):
        api.dispatch_task("@arch", "barren", intent="...")


# --- idempotency ----------------------------------------------------------------------------------

def test_idempotency_replay_returns_the_same_response(write_api, events):
    """Same ``(participant, endpoint, key)`` + same body → the cached response, no second event."""
    first = write_api.dispatch_task(ARCH, "maestro", intent="Same intent",
                                    idempotency_key="key-A")
    second = write_api.dispatch_task(ARCH, "maestro", intent="Same intent",
                                     idempotency_key="key-A")
    assert first == second
    # Critically: only one event was appended — the second call replayed the cache.
    assert len(events.read()) == 1


def test_idempotency_same_key_different_body_is_409(write_api):
    """Same key + different body → mismatch: the client must mint a fresh key for a different write."""
    write_api.dispatch_task(ARCH, "maestro", intent="First", idempotency_key="key-B")
    with pytest.raises(IdempotencyMismatch):
        write_api.dispatch_task(ARCH, "maestro", intent="Second (different)",
                                idempotency_key="key-B")


def test_idempotency_key_optional(write_api, events):
    """Without an Idempotency-Key, every call is a fresh event — no caching."""
    write_api.dispatch_task(ARCH, "maestro", intent="a")
    write_api.dispatch_task(ARCH, "maestro", intent="b")
    assert len(events.read()) == 2


# --- comment endpoint -----------------------------------------------------------------------------

@pytest.fixture
def dispatched(write_api):
    """A dispatched task to anchor comment tests against — yields the task_id ('run-1')."""
    out = write_api.dispatch_task(ARCH, "maestro", intent="A task to discuss")
    return out["task_id"]


def test_post_comment_appends_event_and_projects(write_api, events, dispatched):
    """Happy path: an unanchored comment lands as a ``comment.posted`` event and shows in the
    projection's ``TaskState.comments``."""
    from orchestrator.projection import project_task
    out = write_api.post_comment(ARCH, "maestro", dispatched, body="A first remark.")

    assert out["comment_id"] == "cmt-1"
    assert out["task_id"] == dispatched
    assert out["attributed_to"] == {"email": ARCH, "role": "architect"}
    assert out["event_seq"] >= 2   # dispatch is seq=1; this comment is seq>=2
    # ISO 8601 UTC, ending in 'Z'
    assert out["created_at"].endswith("Z") and "T" in out["created_at"]

    raw = events.read()
    [comment_evt] = [e for e in raw if e["type"] == "comment.posted"]
    assert comment_evt["payload"]["body"] == "A first remark."
    assert comment_evt["payload"]["anchor"] is None

    state = project_task(raw, dispatched)
    [c] = state.comments
    assert c.comment_id == "cmt-1" and c.body == "A first remark."


def test_post_comment_works_for_a_functional_reviewer(write_api, dispatched):
    """Comments aren't gate decisions — any product participant may comment, including @dev."""
    out = write_api.post_comment(DEV, "maestro", dispatched, body="reviewer chiming in")
    assert out["attributed_to"]["role"] == "functional_reviewer"


def test_post_comment_anchored_to_a_known_artefact_kind(write_api, dispatched):
    """A well-formed anchor on functional_spec with a criterion_id locator is accepted."""
    out = write_api.post_comment(ARCH, "maestro", dispatched, body="AC-3 is missing the empty case",
                                  anchor={
                                      "artefact": {
                                          "kind": "functional_spec",
                                          "ref": {"repo": REPO, "branch": "maestro/us-0042",
                                                  "path": "docs/spec.md", "commit": "abc1234"},
                                      },
                                      "locator": {"criterion_id": "AC-3"},
                                  })
    assert out["comment_id"].startswith("cmt-")


def test_post_comment_rejects_unknown_artefact_kind(write_api, dispatched):
    with pytest.raises(AnchorUnresolved):
        write_api.post_comment(ARCH, "maestro", dispatched, body="x",
                                anchor={"artefact": {"kind": "bogus",
                                                     "ref": {"repo": REPO}},
                                        "locator": {"any": "thing"}})


def test_post_comment_rejects_locator_key_not_allowed_for_kind(write_api, dispatched):
    """``technical_design`` allows only ``heading`` in M1; ``block_id`` is deferred (anchoring open
    question resolution + write-api known-limitation)."""
    with pytest.raises(AnchorUnresolved):
        write_api.post_comment(ARCH, "maestro", dispatched, body="x",
                                anchor={"artefact": {"kind": "technical_design",
                                                     "ref": {"repo": REPO}},
                                        "locator": {"block_id": "b-1"}})


def test_post_comment_rejects_anchor_repo_not_owned_by_product(write_api, dispatched):
    with pytest.raises(AnchorUnresolved):
        write_api.post_comment(ARCH, "maestro", dispatched, body="x",
                                anchor={"artefact": {"kind": "functional_spec",
                                                     "ref": {"repo": "other-org/other-repo"}},
                                        "locator": {"criterion_id": "AC-1"}})


def test_post_comment_in_reply_to_existing(write_api, dispatched):
    """Threaded reply: the parent's comment_id must reference an existing comment on this task."""
    parent = write_api.post_comment(ARCH, "maestro", dispatched, body="parent")
    reply = write_api.post_comment(DEV, "maestro", dispatched, body="reply",
                                    in_reply_to=parent["comment_id"])
    assert reply["comment_id"] != parent["comment_id"]


def test_post_comment_in_reply_to_unknown_is_422(write_api, dispatched):
    with pytest.raises(ValidationFailed):
        write_api.post_comment(ARCH, "maestro", dispatched, body="x", in_reply_to="cmt-nope")


def test_post_comment_rejects_empty_body(write_api, dispatched):
    with pytest.raises(ValidationFailed):
        write_api.post_comment(ARCH, "maestro", dispatched, body="")
    with pytest.raises(ValidationFailed):
        write_api.post_comment(ARCH, "maestro", dispatched, body="   ")


def test_post_comment_rejects_oversize_body(write_api, dispatched):
    with pytest.raises(ValidationFailed):
        write_api.post_comment(ARCH, "maestro", dispatched, body="x" * (MAX_COMMENT_CHARS + 1))


def test_post_comment_unknown_task_is_404(write_api):
    with pytest.raises(NotFound):
        write_api.post_comment(ARCH, "maestro", "run-ghost", body="hello")


def test_post_comment_task_on_different_product_is_404(write_api):
    """A guessed URL must not surface a task belonging to a different product (per-product
    isolation — workspace-write-api.md §isolation)."""
    out = write_api.dispatch_task(ARCH, "maestro", intent="real task")
    # Add an "other" product the architect also participates in, and try the URL with that id.
    from orchestrator.register import Participant, Product, Register
    from orchestrator.writeapi import WriteAPI
    other = Product(id="other", name="other", product_type="technical", visibility="public",
                    repos=("acme/other",),
                    participants=(Participant(handle="@arch", role="architect", slack_user_id="U_ARCH"),))
    register = Register(products={
        # keep the same maestro definition so the dispatched event still resolves
        **write_api._register.products,
        "other": other,
    })
    api = WriteAPI(register, write_api._events, write_api._routing, write_api._idempotency,
                   id_factory=lambda: "run-X", comment_id_factory=lambda: "cmt-X")
    with pytest.raises(NotFound):
        api.post_comment(ARCH, "other", out["task_id"], body="x")


def test_post_comment_outsider_is_404(write_api, dispatched):
    with pytest.raises(NotFound):
        write_api.post_comment(OUTSIDER, "maestro", dispatched, body="x")


def test_post_comment_idempotency_replay(write_api, events, dispatched):
    """Same key + same body → cached response; no second event."""
    before = len(events.read())
    first = write_api.post_comment(ARCH, "maestro", dispatched, body="same",
                                    idempotency_key="ck-1")
    second = write_api.post_comment(ARCH, "maestro", dispatched, body="same",
                                     idempotency_key="ck-1")
    assert first == second
    assert len([e for e in events.read() if e["type"] == "comment.posted"]) == 1
    # Only one new event since `before` (the comment), not two.
    assert len(events.read()) == before + 1


def test_post_comment_idempotency_mismatch_is_409(write_api, dispatched):
    write_api.post_comment(ARCH, "maestro", dispatched, body="one", idempotency_key="ck-2")
    with pytest.raises(IdempotencyMismatch):
        write_api.post_comment(ARCH, "maestro", dispatched, body="two", idempotency_key="ck-2")


# --- gate-decision endpoint ----------------------------------------------------------------------

@pytest.fixture
def gated(write_api, events):
    """A dispatched task with a pending **functional** gate.

    Seeds the opener event the spec agent will emit when US-0010 lands. Tests can decide the gate
    immediately, against the seq of the opener (the projected ``open_gates[type].seq``)."""
    out = write_api.dispatch_task(ARCH, "maestro", intent="Add export to /reports")
    opener = events.append(run_id=out["task_id"], actor="spec-agent",
                           type="spec.drafted", target=f"task:{out['task_id']}",
                           payload={"task_id": out["task_id"], "product_id": "maestro",
                                    "ref": {"repo": REPO, "branch": "maestro/run-1",
                                            "path": "docs/spec.md", "commit": "abc"}})
    return {"task_id": out["task_id"], "opener_seq": opener["seq"],
            "gate_type": "functional", "gate_id": f"gate-{opener['seq']:04x}"}


def test_decide_approve_emits_gate_decided_and_advances_stage(write_api, events, gated):
    """Happy path: architect approves the functional gate on a technical product (US-0012 routing)."""
    from orchestrator.projection import project_task
    out = write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                                decision="approve",
                                rationale="EARS criteria cover the empty-result case.",
                                if_match=gated["opener_seq"],
                                idempotency_key="dk-1")
    assert out["task_id"] == gated["task_id"]
    # M1 simplification: the URL-form gate_id (the slug) is normalised to the deterministic opaque
    # id (gate-<opener_seq:04x>) on the response so a workspace UI sees a stable handle either way.
    assert out["gate_id"] == gated["gate_id"]
    assert out["gate"] == {"type": "functional", "decision": "approve", "seq": out["event_seq"]}
    assert out["attributed_to"] == {"email": ARCH, "role": "architect"}
    assert out["decided_at"].endswith("Z") and "T" in out["decided_at"]
    assert out["feedback_bundle_id"] is None

    [evt] = [e for e in events.read() if e["type"] == "gate.decided"]
    assert evt["payload"]["decision"] == "approve"
    assert evt["payload"]["type"] == "functional"
    assert evt["payload"]["gate_id"] == gated["gate_id"]
    assert evt["payload"]["if_match_seq"] == gated["opener_seq"]
    assert evt["payload"]["attributed_to"] == {
        "email": ARCH, "role": "architect", "product_id": "maestro",
    }

    state = project_task(events.read(), gated["task_id"])
    # The gate closed; the next stage is *not* advanced by this slice (the spec/design pipeline
    # carries that). What the projection asserts: the gate decision is recorded, open_gates is empty.
    assert state.open_gates == {}
    assert [g.gate for g in state.gates] == ["functional"]
    assert state.gates[0].decision == "approve"


def test_decide_accepts_opaque_gate_id_form(write_api, events, gated):
    """The URL may also carry the opaque ``gate-<seq:04x>`` form the projection mints."""
    out = write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_id"],
                                decision="approve", rationale="ok",
                                if_match=gated["opener_seq"],
                                idempotency_key="dk-1b")
    assert out["gate_id"] == gated["gate_id"]


def test_decide_reject_cancels_the_task(write_api, events, gated):
    from orchestrator.projection import project_task
    out = write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                                decision="reject",
                                rationale="Scope is out of bounds for this milestone.",
                                if_match=gated["opener_seq"],
                                idempotency_key="dk-2")
    assert out["gate"]["decision"] == "reject"
    state = project_task(events.read(), gated["task_id"])
    assert state.status == "cancelled"


def test_decide_request_changes_returns_stage_and_emits_bundle(write_api, events, gated):
    """``request_changes`` returns the stage to the producer (``intake`` for functional) and emits
    a ``feedback_bundle.created`` event snapshotting the open anchored comments (ADR-0020)."""
    from orchestrator.projection import project_task
    # An anchored architect comment on the gated functional spec (the bundle should include it).
    write_api.post_comment(ARCH, "maestro", gated["task_id"],
                           body="AC-3 is missing the empty-result case.",
                           anchor={"artefact": {"kind": "functional_spec",
                                                "ref": {"repo": REPO, "branch": "maestro/run-1",
                                                        "path": "docs/spec.md", "commit": "abc"}},
                                   "locator": {"criterion_id": "AC-3"}},
                           idempotency_key="ck-rc-1")
    # An unanchored comment (per ADR-0020 §composition-rule, excluded from items[] — rolled into
    # rationale by the agent boundary, not here).
    write_api.post_comment(ARCH, "maestro", gated["task_id"], body="Loose remark.",
                           idempotency_key="ck-rc-2")
    # A comment anchored to a DIFFERENT artefact kind (technical_design) — must be excluded.
    write_api.post_comment(ARCH, "maestro", gated["task_id"], body="design note",
                           anchor={"artefact": {"kind": "technical_design",
                                                "ref": {"repo": REPO, "branch": "maestro/run-1",
                                                        "path": "docs/design.md", "commit": "abc"}},
                                   "locator": {"heading": "overview"}},
                           idempotency_key="ck-rc-3")

    out = write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                                decision="request_changes",
                                rationale="Address AC-3 and re-publish.",
                                if_match=gated["opener_seq"],
                                idempotency_key="dk-rc")
    assert out["feedback_bundle_id"] is not None and out["feedback_bundle_id"].startswith("fb-")

    raw = events.read()
    [decided] = [e for e in raw if e["type"] == "gate.decided"]
    [bundle] = [e for e in raw if e["type"] == "feedback_bundle.created"]
    assert decided["payload"]["feedback_bundle_id"] == out["feedback_bundle_id"]
    assert bundle["payload"]["bundle_id"] == out["feedback_bundle_id"]
    assert bundle["payload"]["gate"] == {"id": gated["gate_id"], "type": "functional"}
    assert bundle["payload"]["rationale"] == "Address AC-3 and re-publish."
    # Only the functional_spec-anchored comment is in items[] — unanchored is excluded; the
    # technical_design-anchored comment is wrong-kind for a functional gate.
    [item] = bundle["payload"]["items"]
    assert item["anchor"]["locator"] == {"criterion_id": "AC-3"}
    assert item["suggested_change"] is None

    state = project_task(raw, gated["task_id"])
    assert state.stage == "intake"            # request_changes returns to the spec producer
    assert state.open_gates == {}              # the open gate closed; next spec.drafted re-opens


def test_decide_unknown_decision_is_422(write_api, gated):
    with pytest.raises(ValidationFailed):
        write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                              decision="defer", if_match=gated["opener_seq"],
                              idempotency_key="dk-bad")


def test_decide_request_changes_requires_rationale(write_api, gated):
    with pytest.raises(ValidationFailed):
        write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                              decision="request_changes",
                              if_match=gated["opener_seq"], idempotency_key="dk-r1")
    with pytest.raises(ValidationFailed):
        write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                              decision="reject", rationale="   ",
                              if_match=gated["opener_seq"], idempotency_key="dk-r2")


def test_decide_oversize_rationale_is_422(write_api, gated):
    with pytest.raises(ValidationFailed):
        write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                              decision="approve",
                              rationale="x" * (MAX_RATIONALE_CHARS + 1),
                              if_match=gated["opener_seq"], idempotency_key="dk-ros")


def test_decide_requires_idempotency_key(write_api, gated):
    with pytest.raises(ValidationFailed):
        write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                              decision="approve", if_match=gated["opener_seq"])


def test_decide_requires_if_match(write_api, gated):
    with pytest.raises(ValidationFailed):
        write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                              decision="approve", idempotency_key="dk-no-im")


def test_decide_stale_if_match_is_409_gate_state_moved(write_api, gated):
    with pytest.raises(GateStateMoved):
        write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                              decision="approve",
                              if_match=gated["opener_seq"] - 1, idempotency_key="dk-stale")


def test_decide_already_resolved_is_409(write_api, gated):
    """After a terminal decision, a second decision attempt on the same opening gets 409 —
    distinguishing 'gate gone' from 'gate never existed' (workspace-write-api.md §POST-decisions)."""
    write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                          decision="approve",
                          if_match=gated["opener_seq"], idempotency_key="dk-first")
    with pytest.raises(GateAlreadyResolved):
        write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                              decision="approve",
                              if_match=gated["opener_seq"], idempotency_key="dk-second")


def test_decide_no_pending_gate_is_404(write_api, dispatched):
    """A dispatched task with no opener has no pending gate of any type — 404, not 409."""
    with pytest.raises(NotFound):
        write_api.decide_gate(ARCH, "maestro", dispatched, "functional",
                              decision="approve", if_match=99, idempotency_key="dk-none")


def test_decide_wrong_role_is_403(write_api, gated):
    """@dev is functional_reviewer, not architect; reviewers.yaml routes a TECHNICAL product's
    functional gate to architect, so @dev's attempt is 403 (the resource is visible — they're a
    participant — but the decision authority is not theirs)."""
    with pytest.raises(ForbiddenRole):
        write_api.decide_gate(DEV, "maestro", gated["task_id"], gated["gate_type"],
                              decision="approve",
                              if_match=gated["opener_seq"], idempotency_key="dk-dev")


def test_decide_unknown_product_is_404(write_api, gated):
    with pytest.raises(NotFound):
        write_api.decide_gate(ARCH, "ghost", gated["task_id"], gated["gate_type"],
                              decision="approve",
                              if_match=gated["opener_seq"], idempotency_key="dk-ghost")


def test_decide_unknown_task_is_404(write_api):
    with pytest.raises(NotFound):
        write_api.decide_gate(ARCH, "maestro", "run-no-such", "functional",
                              decision="approve", if_match=1, idempotency_key="dk-ut")


def test_decide_outsider_is_404(write_api, gated):
    with pytest.raises(NotFound):
        write_api.decide_gate(OUTSIDER, "maestro", gated["task_id"], gated["gate_type"],
                              decision="approve",
                              if_match=gated["opener_seq"], idempotency_key="dk-out")


def test_decide_idempotency_replay_returns_cached(write_api, events, gated):
    """Same (participant, endpoint, key) + same body → same response; only one gate.decided event."""
    first = write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                                  decision="approve", rationale="green",
                                  if_match=gated["opener_seq"], idempotency_key="dk-rep")
    second = write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                                   decision="approve", rationale="green",
                                   if_match=gated["opener_seq"], idempotency_key="dk-rep")
    assert first == second
    assert len([e for e in events.read() if e["type"] == "gate.decided"]) == 1


def test_decide_idempotency_mismatch_is_409(write_api, gated):
    write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                          decision="approve", rationale="green",
                          if_match=gated["opener_seq"], idempotency_key="dk-mm")
    with pytest.raises(IdempotencyMismatch):
        write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                              decision="reject", rationale="actually no",
                              if_match=gated["opener_seq"], idempotency_key="dk-mm")


def test_decide_request_changes_with_no_anchored_comments_emits_empty_items(write_api, events,
                                                                            gated):
    """A request-changes with no anchored comments produces a bundle with ``items: []``. The
    rationale alone is the hand-off; no item is fabricated."""
    out = write_api.decide_gate(ARCH, "maestro", gated["task_id"], gated["gate_type"],
                                decision="request_changes",
                                rationale="Re-do AC-3 wording.",
                                if_match=gated["opener_seq"], idempotency_key="dk-rc-empty")
    [bundle] = [e for e in events.read() if e["type"] == "feedback_bundle.created"]
    assert bundle["payload"]["items"] == []
    assert out["feedback_bundle_id"] is not None
