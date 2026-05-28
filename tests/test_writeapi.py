"""The workspace write API service core (workspace-write-api.md) — dispatch endpoint slice.

Covers the M1 ``POST /api/products/{p}/tasks`` flow: role check (architect-only in M1), validation
(empty/oversize intent, repo ownership), per-product isolation (404 not 403 for unknown product),
event emission shape, and the idempotency contract (replay returns the same response; same key with
a different body → 409).
"""
import pytest

from orchestrator.readapi import NotFound, Unauthenticated
from orchestrator.writeapi import (
    MAX_INTENT_CHARS,
    ForbiddenRole,
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
