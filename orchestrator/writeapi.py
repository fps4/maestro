"""The workspace write API — the orchestrator's write surface (S2/S3 + M1 dispatch).

This is the **framework-agnostic core** of the contract in
``docs/architecture/contracts/workspace-write-api.md`` (an additive extension of the read API
contract, decided 2026-05-28). Each request becomes **exactly one attributed event** in the event
log (ADR-0008/0009); the workspace holds no authoritative state (ADR-0015). Three endpoint families
ship under M1; this file lands the **dispatch** endpoint first — the workspace "new task" form
(US-0010 Q2 resolution). Comment + gate-decision endpoints follow in subsequent slices.

Shared concerns with the read API (identity header, register-based authorization, isolation-is-404,
error envelope) are imported from :mod:`orchestrator.readapi` so there is one boundary, not two. The
write surface adds **idempotency** (:mod:`orchestrator.idempotency`) and — for later endpoints —
optimistic concurrency on gate decisions via the ``Gate.seq`` projection counter.

It holds no GitHub token and no LLM egress; the HTTP binding lives in :mod:`orchestrator.httpserver`.
"""
import hashlib
import json
import threading
import uuid
from typing import Optional

from orchestrator.eventlog import EventLog
from orchestrator.idempotency import IdempotencyStore
from orchestrator.readapi import APIError, NotFound, Unauthenticated
from orchestrator.register import Register
from orchestrator.routing import RoutingResolver

MAX_INTENT_CHARS = 8000


# --- error classes ---------------------------------------------------------------------------------

class ForbiddenRole(APIError):
    """The caller participates in the product but lacks the role this write requires.

    The **one** place we surface 403 rather than 404 (workspace-write-api.md §endpoints): when the
    resource is visible to the caller but the authority for *this* write is not theirs.
    """
    code = "forbidden_role"
    status = 403


class ValidationFailed(APIError):
    """The request body is malformed for this endpoint (empty intent, oversize, unknown repo, …)."""
    code = "validation_failed"
    status = 422


class IdempotencyMismatch(APIError):
    """The ``Idempotency-Key`` was previously bound to a different request body — clients must mint
    a fresh key for a substantively different request (workspace-write-api.md §idempotency)."""
    code = "idempotency_mismatch"
    status = 409


# --- helpers ----------------------------------------------------------------------------------------

def _default_run_id() -> str:
    """Mint an opaque task id (``run-<8 hex>``). 32 bits is enough collision-resistance at dogfood
    scale; full uuid lands when concurrent dispatch volume warrants."""
    return f"run-{uuid.uuid4().hex[:8]}"


def _canonical(body: dict) -> str:
    """Deterministic serialization for idempotency hashing — matches the eventlog canonical form."""
    return json.dumps(body, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False)


def _hash_request(body: dict) -> str:
    return hashlib.sha256(_canonical(body).encode("utf-8")).hexdigest()


# --- the write API ---------------------------------------------------------------------------------

class WriteAPI:
    """Framework-agnostic core of the write contract. Tested with no sockets, no network, no LLM."""

    ENDPOINT_DISPATCH = "POST /api/products/{p}/tasks"

    def __init__(self, register: Register, events: EventLog, routing: RoutingResolver,
                 idempotency: IdempotencyStore, *, id_factory=None):
        """``id_factory`` is injectable for deterministic tests; production uses :func:`_default_run_id`."""
        self._register = register
        self._events = events
        self._routing = routing
        self._idempotency = idempotency
        self._id_factory = id_factory or _default_run_id
        # One writer lock across request threads — the read API has its own read lock, and SQLite's
        # single-writer model gives us serialization for free; this just keeps the idempotency
        # check-then-insert sequence atomic.
        self._write_lock = threading.Lock()

    # --- endpoints --------------------------------------------------------------------------------

    def dispatch_task(self, identity: str, product_id: str, intent: str, *,
                      repo: Optional[str] = None,
                      idempotency_key: Optional[str] = None) -> dict:
        """``POST /api/products/{product_id}/tasks`` — create a new delivery task (US-0010 Q2).

        Architect-only in M1 (the workspace "new task" form, resolved 2026-05-28). Emits
        ``task.dispatched``; the agent stream picks up from there. Returns the new task's id, its
        initial stage, the targeted ref skeleton, and the producing ``event_seq``.
        """
        product = self._authorize_product(identity, product_id)
        participant = product.participant_for(identity)
        if participant.role != "architect":
            raise ForbiddenRole(
                f"only architects may dispatch a delivery task in M1; you are {participant.role!r}"
            )

        intent = (intent or "").strip()
        if not intent:
            raise ValidationFailed("intent is required")
        if len(intent) > MAX_INTENT_CHARS:
            raise ValidationFailed(
                f"intent exceeds {MAX_INTENT_CHARS} chars ({len(intent)} given)"
            )

        if repo is None:
            if not product.repos:
                raise ValidationFailed(f"product {product_id!r} has no repos to target")
            repo = product.repos[0]
        elif repo not in product.repos:
            raise ValidationFailed(f"repo {repo!r} is not owned by product {product_id!r}")

        request_body = {"intent": intent, "repo": repo}
        request_hash = _hash_request(request_body)

        with self._write_lock:
            # Idempotency replay: a retry with the same key returns the original response unchanged.
            if idempotency_key:
                cached = self._idempotency.lookup(
                    identity, self.ENDPOINT_DISPATCH, idempotency_key,
                )
                if cached is not None:
                    if cached["request_hash"] != request_hash:
                        raise IdempotencyMismatch(
                            f"key {idempotency_key!r} previously bound to a different request body"
                        )
                    return cached["response"]

            task_id = self._id_factory()
            event = self._events.append(
                run_id=task_id,
                actor=participant.handle,
                type="task.dispatched",
                target=f"task:{task_id}",
                payload={
                    "task_id": task_id, "product_id": product.id, "repo": repo,
                    "intent": intent,
                    "attributed_to": {
                        "email": identity, "role": participant.role, "product_id": product.id,
                    },
                },
            )
            response = {
                "task_id": task_id, "product_id": product.id, "stage": "intake",
                "ref": {"repo": repo, "branch": None, "commit": None},
                "event_seq": event["seq"],
                "href": f"/api/products/{product.id}/tasks/{task_id}",
            }
            if idempotency_key:
                self._idempotency.remember(
                    identity, self.ENDPOINT_DISPATCH, idempotency_key,
                    request_hash=request_hash,
                    response=response,
                    event_seq=event["seq"],
                )
            return response

    # --- isolation + identity ---------------------------------------------------------------------

    def _authorize_product(self, identity: str, product_id: str):
        """Same 404-not-403 isolation rule as the read API (ADR-0010/0011). Unknown product to this
        caller → :class:`NotFound`; only when the resource exists *and* is visible to the caller but
        the role for *this* write isn't theirs do we surface 403 (via :class:`ForbiddenRole`)."""
        if not identity:
            raise Unauthenticated("no caller identity")
        product = self._register.product(product_id)
        if product is None or product.participant_for(identity) is None:
            raise NotFound(f"product {product_id!r} not found")
        return product
